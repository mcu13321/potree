import * as THREE from "../../libs/three.js/build/three.module.js";
import {captureAlignmentPose, restoreAlignmentPose, applyAlignmentLocalMatrix, getAlignmentWorldCenter, getAlignmentViewNormal, alignmentPlanePoint, alignmentRotationMatrix} from "./PointCloudAlignmentTransform.js";

/** A fixed-size DOM ring shares the real label center and never enters WebGL captures. */
export class PointCloudAlignmentGizmo {
	constructor(tool) {
		this.tool = tool;
		this.viewer = tool.viewer;
		this.labels = tool.labels;
		this.cloud = tool.activePointCloud;
		// Keep the 2px ring inside its 180px bounds and arrows 2px outside the center label.
		const diameter = 180, center = diameter / 2;
		const labelRadius = parseFloat(this.labels.labels.get(this.cloud)?.style.width ?? "40") / 2;
		// Keep each arrow shaft 18px long without changing the gap beside the label.
		const arrowStart = center + labelRadius + 2, arrowEnd = arrowStart + 18;
		this.element = document.createElement("div");
		this.element.className = "potree-point-cloud-alignment-gizmo";
		Object.assign(this.element.style, {position: "absolute", width: `${diameter}px`, height: `${diameter}px`, transform: "translate(-50%, -50%)", pointerEvents: "none", display: "none"});
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		svg.setAttribute("viewBox", `0 0 ${diameter} ${diameter}`);
		Object.assign(svg.style, {width: `${diameter}px`, height: `${diameter}px`, overflow: "visible", pointerEvents: "none"});
		// Retain both the visible ring and its hit area so translation hides rotation input too.
		this.rotationRings = [];
		for (const [width, color, interactive] of [[2, "#1c7efd", false], [12, "transparent", true]]) {
			const circle = document.createElementNS(ns, "circle");
			for (const [key, value] of Object.entries({cx: center, cy: center, r: center - 1, fill: "none", stroke: color, "stroke-width": width})) circle.setAttribute(key, String(value));
			if (interactive) {
				circle.classList.add("potree-point-cloud-alignment-ring");
				circle.setAttribute("aria-label", "Rotate active point cloud");
				Object.assign(circle.style, {pointerEvents: "stroke", cursor: "grab", touchAction: "none"});
			}
			svg.appendChild(circle);
			this.rotationRings.push(circle);
		}
		// Retain direction paths so each gesture can emphasize only its own controls.
		this.directionArrows = [];
		for (const angle of [0, 90, 180, 270]) {
			const arrow = document.createElementNS(ns, "path");
			for (const [key, value] of Object.entries({d: `M${arrowStart} ${center}H${arrowEnd}M${arrowEnd - 6} ${center - 6}L${arrowEnd} ${center}L${arrowEnd - 6} ${center + 6}`, transform: `rotate(${angle} ${center} ${center})`, stroke: "#1c7efd", "stroke-width": "2", fill: "none", "pointer-events": "none"})) arrow.setAttribute(key, value);
			svg.appendChild(arrow);
			this.directionArrows.push(arrow);
		}
		this.element.appendChild(svg);
		// A screen-facing handle travels on the ring centerline and shares its rotation input.
		this.ringCenter = center;
		this.ringRadius = center - 1;
		this.rotationHandle = document.createElement("div");
		this.rotationHandle.className = "potree-point-cloud-alignment-ring potree-point-cloud-alignment-rotation-handle";
		this.rotationHandle.setAttribute("aria-label", "Rotate active point cloud");
		// Start at the rightmost point of the orbit before the first rotation gesture.
		Object.assign(this.rotationHandle.style, {position: "absolute", width: "32px", height: "32px", boxSizing: "border-box", borderRadius: "50%", border: "2px solid #fff", background: "#1c7efd", color: "#fff", boxShadow: "0 0 8px rgba(28, 126, 253, 0.35)", display: "flex", alignItems: "center", justifyContent: "center", transform: "translate(-50%, -50%)", pointerEvents: "auto", cursor: "grab", touchAction: "none", userSelect: "none", left: `${center + this.ringRadius}px`, top: `${center}px`});
		const icon = document.createElementNS(ns, "svg");
		icon.setAttribute("viewBox", "0 0 24 24");
		icon.setAttribute("aria-hidden", "true");
		Object.assign(icon.style, {width: "22px", height: "22px", pointerEvents: "none"});
		const loop = document.createElementNS(ns, "path");
		for (const [key, value] of Object.entries({d: "M19.5 8A8 8 0 1 0 20 12M15 8H20V3", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"})) loop.setAttribute(key, value);
		icon.appendChild(loop);
		this.rotationHandle.appendChild(icon);
		this.element.appendChild(this.rotationHandle);
		this.labels.layer.appendChild(this.element);
		// Capture before label selection and stop compatibility mouse/touch events at the layer.
		this.onInput = event => this.handleInput(event);
		this.inputEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "mousedown", "mouseup", "mousemove", "touchstart", "touchmove", "touchend", "click", "dblclick", "wheel", "contextmenu"];
		for (const type of this.inputEvents) this.labels.layer.addEventListener(type, this.onInput, {capture: true, passive: false});
		this.onUpdate = () => this.update();
		this.onCancel = () => this.cancelGesture();
		// View changes refresh idle handles too, even when no gesture needs cancellation.
		this.onViewChanged = () => { this.cancelGesture(); this.update(); };
		this.viewer.addEventListener("render.pass.end", this.onUpdate);
		this.viewer.addEventListener("view_mode_changed", this.onViewChanged);
		window.addEventListener("blur", this.onCancel);
	}

	/** Only a paired source in a settled axis view exposes transform handles. */
	update() {
		const label = this.labels.labels.get(this.cloud);
		// Rotation is restricted to top view; axis-plane translation remains available elsewhere.
		const rotationAllowed = this.viewer.getViewMode?.() === "top";
		const rotationChanged = this.rotationAllowed !== rotationAllowed;
		this.rotationAllowed = rotationAllowed;
		const normal = getAlignmentViewNormal(this.viewer.getViewMode?.());
		this.available = Boolean(!this.tool.disposed && this.tool.active2PointCloud && this.labels.visible && label?.style.display === "flex" && normal && !this.viewer.viewModeController?.transition);
		this.element.style.display = this.available ? "block" : "none";
		if (this.available) {
			this.element.style.left = label.style.left;
			this.element.style.top = label.style.top;
		}
		if (this.gesture) {
			const gesture = this.gesture;
			const camera = this.tool.scene.getActiveCamera();
			const rect = this.viewer.renderer.domElement.getBoundingClientRect();
			this.cloud.parent?.updateWorldMatrix(true, false);
			const parent = this.cloud.parent?.matrixWorld ?? new THREE.Matrix4();
			if (!this.available || (gesture.operation === "rotate" && !rotationAllowed) || camera !== gesture.camera || !camera.projectionMatrix.equals(gesture.projection) || !camera.matrixWorld.equals(gesture.cameraWorld) || !parent.equals(gesture.parent) || ["left", "top", "width", "height"].some(key => rect[key] !== gesture.rect[key])) this.cancelGesture();
		}
		if (rotationChanged) this.updateGestureAppearance();
	}

	/** Give the primary its transform gesture without releasing the alignment selection lock. */
	handleInput(event) {
		const label = this.labels.labels.get(this.cloud);
		const source = event.target.closest?.(".potree-point-cloud-label") === label;
		const ring = Boolean(event.target.closest?.(".potree-point-cloud-alignment-ring"));
		if ((!source && !ring) || !this.tool.active2PointCloud) return;
		event.stopImmediatePropagation();
		event.preventDefault();
		if (event.type === "pointerdown") {
			if (this.gesture) { this.cancelGesture(); return; }
			if (event.button === 0) this.startGesture(event, ring ? "rotate" : "translate");
		} else if (event.type === "pointermove") {
			this.moveGesture(event);
		} else if (event.type === "pointerup") {
			if (this.gesture?.id === event.pointerId) { this.moveGesture(event); this.finishGesture(false); }
		} else if (event.type === "pointercancel" || event.type === "lostpointercapture") {
			this.cancelGesture();
		}
	}

	/** Project the pointer radially onto the screen-space ring, including off-ring captured moves. */
	positionRotationHandle(event) {
		const rect = this.viewer.renderer.domElement.getBoundingClientRect();
		const x = event.clientX - rect.left - parseFloat(this.element.style.left);
		const y = event.clientY - rect.top - parseFloat(this.element.style.top);
		const distance = Math.hypot(x, y);
		if (!Number.isFinite(distance) || distance < 1e-6) return;
		this.rotationHandle.style.left = `${this.ringCenter + this.ringRadius * x / distance}px`;
		this.rotationHandle.style.top = `${this.ringCenter + this.ringRadius * y / distance}px`;
	}

	/** Emphasize the active operation and restore the original idle appearance on every exit. */
	updateGestureAppearance() {
		const translating = this.gesture?.operation === "translate";
		const rotating = this.gesture?.operation === "rotate";
		// SVG strokes need drop shadows to follow their shape instead of a rectangular box.
		const shadow = "drop-shadow(0px 0px 8px #1c7efd) drop-shadow(0px 0px 4px #1c7efd66)";
		for (const ring of this.rotationRings) ring.style.display = translating ? "none" : "";
		// Other views keep a decorative circle but expose no rotation hit area or badge.
		this.rotationRings[1].style.display = translating || !this.rotationAllowed ? "none" : "";
		// Preserve the transparent hit area's width and the handle's orbit radius.
		this.rotationRings[0].setAttribute("stroke-width", rotating ? "4" : "2");
		this.rotationRings[0].style.filter = rotating ? shadow : "";
		this.rotationHandle.style.display = translating || !this.rotationAllowed ? "none" : "flex";
		for (const arrow of this.directionArrows) {
			arrow.style.display = rotating ? "none" : "";
			arrow.setAttribute("stroke-width", translating ? "3" : "2");
			arrow.style.filter = translating ? shadow : "";
		}
	}

	/** Freeze the plane, camera and local/world baselines for a single gesture. */
	startGesture(event, operation) {
		this.update();
		// Guard the operation as well as the DOM, including direct or stale pointer input.
		if (!this.available || (operation === "rotate" && !this.rotationAllowed)) return;
		const normal = getAlignmentViewNormal(this.viewer.getViewMode());
		const center = getAlignmentWorldCenter(this.cloud);
		const camera = this.tool.scene.getActiveCamera();
		const rect = this.viewer.renderer.domElement.getBoundingClientRect();
		if (!center) return;
		const start = alignmentPlanePoint(camera, rect, event.clientX, event.clientY, center, normal);
		const parent = this.cloud.parent?.matrixWorld.clone() ?? new THREE.Matrix4();
		if (!start || Math.abs(parent.determinant()) < 1e-15 || (operation === "rotate" && start.lengthSq() < 1e-16)) return;
		const controls = this.viewer.fjdCameraControls;
		controls?.stop?.();
		if (controls?.getRigidPose) controls.setRigidPose(controls.getRigidPose(false), false);
		this.gesture = {
			id: event.pointerId, element: event.target, operation, start, last: start.clone().normalize(), angle: 0,
			x: event.clientX, y: event.clientY, moved: false, center, normal, camera, rect: {left: rect.left, top: rect.top, width: rect.width, height: rect.height},
			parent, inverseParent: parent.clone().invert(), world: this.cloud.matrixWorld.clone(), pose: captureAlignmentPose(this.cloud),
			projection: camera.projectionMatrix.clone(), cameraWorld: camera.matrixWorld.clone(), controls, controlsEnabled: controls?.enabled, inputEnabled: this.viewer.inputHandler?.enabled,
		};
		if (controls) controls.enabled = false;
		if (this.viewer.inputHandler) this.viewer.inputHandler.enabled = false;
		this.updateGestureAppearance();
		// Track only rotation gestures; translating the source carries the entire gizmo instead.
		if (operation === "rotate") {
			this.positionRotationHandle(event);
			this.rotationHandle.style.cursor = "grabbing";
		}
		try { event.target.setPointerCapture?.(event.pointerId); } catch { /* Detached/synthetic pointers do not own native capture. */ }
		this.tool.dispatchTransform(operation, "start");
	}

	/** Resolve every move against the frozen baseline, with unwrapped signed ring angles. */
	moveGesture(event) {
		this.update();
		const gesture = this.gesture;
		if (!gesture || gesture.id !== event.pointerId) return;
		// Even sub-threshold moves update the handle without introducing transform jitter.
		if (gesture.operation === "rotate") this.positionRotationHandle(event);
		if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 3) return;
		const point = alignmentPlanePoint(gesture.camera, gesture.rect, event.clientX, event.clientY, gesture.center, gesture.normal);
		if (!point) return;
		let delta;
		if (gesture.operation === "translate") {
			const offset = point.clone().sub(gesture.start);
			delta = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
		} else {
			if (point.lengthSq() < 1e-16) return;
			const next = point.normalize();
			gesture.angle += Math.atan2(gesture.normal.dot(new THREE.Vector3().crossVectors(gesture.last, next)), gesture.last.dot(next));
			gesture.last.copy(next);
			delta = alignmentRotationMatrix(gesture.center, gesture.normal, gesture.angle);
		}
		gesture.moved = true;
		applyAlignmentLocalMatrix(this.cloud, gesture.inverseParent.clone().multiply(delta).multiply(gesture.world), gesture.pose.matrixAutoUpdate);
		this.tool.dispatchTransform(gesture.operation, "change");
		this.labels.update();
	}

	/** Release pointer and camera ownership on all paths, restoring only the cancelled gesture. */
	finishGesture(cancelled, updateLabels = true) {
		const gesture = this.gesture;
		if (!gesture) return;
		this.gesture = null;
		this.updateGestureAppearance();
		// Preserve the last orbit position after release while restoring the idle cursor.
		this.rotationHandle.style.cursor = "grab";
		if (cancelled) restoreAlignmentPose(this.cloud, gesture.pose);
		if (gesture.controls) gesture.controls.enabled = gesture.controlsEnabled;
		if (this.viewer.inputHandler) this.viewer.inputHandler.enabled = gesture.inputEnabled;
		try { gesture.element.releasePointerCapture?.(gesture.id); } catch { /* Native capture may already have been released. */ }
		this.tool.dispatchTransform(gesture.operation, cancelled ? "cancel" : "end");
		if (updateLabels) this.labels.update();
	}

	/** Cancellation preserves completed gestures and rolls back only the in-flight gesture. */
	cancelGesture() { this.finishGesture(true); }

	/** No global listener, pointer capture or disabled camera state may outlive the tool. */
	dispose() {
		// Membership cleanup may already be in progress; do not recursively update locked labels.
		this.finishGesture(true, false);
		for (const type of this.inputEvents) this.labels.layer.removeEventListener(type, this.onInput, true);
		this.viewer.removeEventListener("render.pass.end", this.onUpdate);
		this.viewer.removeEventListener("view_mode_changed", this.onViewChanged);
		window.removeEventListener("blur", this.onCancel);
		this.element.remove();
	}
}
