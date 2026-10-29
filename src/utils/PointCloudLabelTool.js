import * as THREE from "../../libs/three.js/build/three.module.js";

import {setPointCloudLabelAppearance, isPointCloudRuntimeHidden} from "./PointCloudLabelAppearance.js";

/** Display selectable, fixed-size labels at default centers or explicit host anchors. */
export class PointCloudLabelTool {
	constructor(viewer) {
		this.viewer = viewer;
		this.visible = true;
		// Connection visibility is independent of labels and defaults to the existing behavior.
		this.connectionsVisible = true;
		this.disposed = false;
		this.labels = new Map();
		this.connections = [];
		this.connectionProjections = new Map();
		this.activePointCloud = null;
		// Custom anchors are opt-in and remain owned by this tool, never by cloud metadata.
		this.anchorResolver = null;
		this.appearanceClouds = new Set();
		this.cloudByElement = new WeakMap();
		this.box = new THREE.Box3();
		this.center = new THREE.Vector3();
		this.projected = new THREE.Vector3();
		this.layer = document.createElement("div");
		this.layer.className = "potree-point-cloud-labels";
		this.layer.setAttribute("role", "group");
		this.layer.setAttribute("aria-label", "Point cloud labels");
		// A viewport-aligned layer avoids changing the render area's positioning styles.
		Object.assign(this.layer.style, {
			position: "fixed", overflow: "hidden", pointerEvents: "none", zIndex: "10",
		});
		const area = viewer.renderArea;
		(area?.appendChild ? area : area[0]).appendChild(this.layer);
		this.onUpdate = () => this.update();
		this.onSceneChanged = () => { this.setScene(viewer.scene); this.update(); };
		this.onCloudChanged = () => this.update();
		// Delegate input so membership changes cannot leave listeners on removed labels.
		this.onLabelInput = event => this.handleLabelInput(event);
		this.inputEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "keydown", "keyup"];
		for (const type of this.inputEvents) this.layer.addEventListener(type, this.onLabelInput);
		this.setScene(viewer.scene);
		viewer.addEventListener("update", this.onUpdate);
		// Rendering may resize the canvas and update projection after the update event.
		viewer.addEventListener("render.pass.end", this.onUpdate);
		viewer.addEventListener("scene_changed", this.onSceneChanged);
		this.update();
	}

	/** Set one scene member active; null releases selection without changing base settings. */
	setActivePointCloud(pointcloud) {
		if (this.disposed) return this;
		if (this.scene !== this.viewer.scene) this.setScene(this.viewer.scene);
		if (pointcloud !== null && !this.scene?.pointclouds.includes(pointcloud)) {
			throw new RangeError("Active point cloud must belong to the current scene");
		}
		if (this.activePointCloud === pointcloud) return this;
		// Alignment locks the primary even for programmatic selection changes.
		if (this.alignmentTool) throw new Error("Active point cloud is locked during alignment");
		const previousPointcloud = this.activePointCloud;
		this.activePointCloud = pointcloud;
		this.syncAppearance();
		this.viewer.dispatchEvent({type: "active_pointcloud_changed", pointcloud, previousPointcloud});
		return this;
	}

	/** Read the sole active identity without creating an implicit selection. */
	getActivePointCloud() {
		return this.activePointCloud;
	}

	/** Own appearance only while an active member exists, including newly added clouds. */
	syncAppearance() {
		const clouds = new Set(this.scene?.pointclouds ?? []);
		for (const cloud of this.appearanceClouds) {
			if (!this.activePointCloud || !clouds.has(cloud)) {
				setPointCloudLabelAppearance(cloud, null);
				this.appearanceClouds.delete(cloud);
			}
		}
		if (this.activePointCloud) {
			for (const cloud of clouds) {
				const role = cloud === this.activePointCloud ? true : cloud === this.alignmentTool?.active2PointCloud ? "secondary" : false;
				setPointCloudLabelAppearance(cloud, role);
				this.appearanceClouds.add(cloud);
			}
		}
		// Once paired, only the primary label may own input, including during idle time between presses.
		const paired = Boolean(this.alignmentTool?.active2PointCloud);
		if (paired && this.gesture) {
			const {element, id} = this.gesture;
			this.gesture = null;
			this.suppressPointerClick = true;
			// Release a pending ordinary-label capture before disabling the chosen reference button.
			try { if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id); } catch { /* Native capture may already have ended. */ }
		}
		for (const [cloud, element] of this.labels) {
			const active = cloud === this.activePointCloud;
			const secondary = cloud === this.alignmentTool?.active2PointCloud;
			// Pointer pass-through lets an overlapping primary or rotation handle receive the actual press.
			element.disabled = paired ? !active : active && Boolean(this.alignmentTool);
			element.style.pointerEvents = paired && !active ? "none" : "auto";
			element.style.cursor = paired && active ? "move" : "pointer";
			// Selection changes interaction and ARIA state while retaining one shared label palette.
			element.setAttribute("aria-pressed", String(active || secondary));
		}
	}

	/** Isolate button input from camera/tools and reject dragged or cancelled gestures. */
	handleLabelInput(event) {
		const element = event.target.closest?.(".potree-point-cloud-label");
		const cloud = this.cloudByElement.get(element);
		if (this.disposed || !this.visible || !cloud || !this.labels.has(cloud)) return;
		event.stopPropagation();
		// The gizmo capture handler owns paired input; synthetic label events cannot change the reference.
		if (this.alignmentTool?.active2PointCloud) { event.preventDefault(); return; }
		if (event.type === "pointerdown") {
			this.suppressPointerClick = event.button !== 0 || Boolean(this.gesture);
			if (this.suppressPointerClick) { this.gesture = null; return; }
			this.gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, element};
			element.setPointerCapture?.(event.pointerId);
		} else if (event.type === "pointermove" || event.type === "pointerup") {
			const gesture = this.gesture;
			if (gesture?.id === event.pointerId) {
				this.suppressPointerClick ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5;
			}
			if (event.type === "pointerup") this.gesture = null;
		} else if (event.type === "pointercancel") {
			this.suppressPointerClick = true;
			this.gesture = null;
		} else if (event.type === "click") {
			// Keyboard activation has detail zero and follows the native button behavior.
			if (event.detail === 0 || !this.suppressPointerClick) {
				if (this.alignmentTool) {
					if (cloud !== this.activePointCloud) this.alignmentTool.setActive2PointCloud(cloud);
				} else this.setActivePointCloud(cloud);
			}
			this.gesture = null;
		}
	}


 /** Display host-owned pairs; relationships are never inferred or persisted inside Potree. */
 setConnections(pairs) {
  if (this.disposed) return this;
  if (!Array.isArray(pairs)) throw new TypeError("Connections must be an array of source/target point-cloud pairs");
  if (!this.connectionLayer && pairs.length === 0) return this;
  const ns = "http://www.w3.org/2000/svg";
  if (!this.connectionLayer) {
   this.connectionLayer = document.createElementNS(ns, "svg");
   this.connectionLayer.classList.add("potree-point-cloud-label-connections");
   this.connectionLayer.setAttribute("aria-hidden", "true");
   Object.assign(this.connectionLayer.style, {position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none"});
   // Paint edges beneath the actual buttons and leave all input to existing tools.
   this.layer.prepend(this.connectionLayer);
  }
  this.connectionLayer.replaceChildren();
  this.connections = [];
  for (const {source, target} of pairs) {
   if (!source || !target || source === target) continue;
   const element = document.createElementNS(ns, "line");
   // Match relationship edges to the shared point-cloud label background.
   element.setAttribute("stroke", "#1c7efd");
   element.setAttribute("stroke-width", "2");
   element.setAttribute("pointer-events", "none");
   this.connectionLayer.appendChild(element);
   this.connections.push({source, target, element});
  }
  this.update();
  return this;
 }


 /** Clip world-center segments before division, including near/far and camera-plane crossings. */
 projectClippedConnection(source, target, rect) {
  const sourceProjection = this.connectionProjections.get(source), targetProjection = this.connectionProjections.get(target);
  const a = sourceProjection?.clip, b = targetProjection?.clip;
  if (!a || !b || ![sourceProjection.depth, targetProjection.depth, ...a.toArray(), ...b.toArray()].every(Number.isFinite)) return null;
  // Clip camera-space depth as well for orthographic projections with negative near distances.
  const fromDepth = sourceProjection.depth - 1e-9, toDepth = targetProjection.depth - 1e-9;
  if (fromDepth < 0 && toDepth < 0) return null;
  let first = fromDepth < 0 ? fromDepth / (fromDepth - toDepth) : 0;
  let last = toDepth < 0 ? fromDepth / (fromDepth - toDepth) : 1;
  // Homogeneous half-spaces avoid infinite or inverted segments when one endpoint is behind the camera.
  for (const axis of ["x", "y", "z"]) {
   for (const sign of [-1, 1]) {
    const from = a.w + sign * a[axis], to = b.w + sign * b[axis];
    if (from < 0 && to < 0) return null;
    if (from < 0) first = Math.max(first, from / (from - to));
    else if (to < 0) last = Math.min(last, from / (from - to));
    if (first > last) return null;
   }
  }
  const from = a.clone().lerp(b, first), to = a.clone().lerp(b, last);
  if (from.w <= 1e-12 || to.w <= 1e-12) return null;
  const screen = point => ({
   x: Math.max(0, Math.min(rect.width, (point.x / point.w + 1) * rect.width / 2)),
   y: Math.max(0, Math.min(rect.height, (1 - point.y / point.w) * rect.height / 2)),
  });
  return {a: screen(from), b: screen(to)};
 }

 /** Draw the visible segment even when its endpoint buttons are outside the viewport. */
 updateConnections(rect = this.viewer.renderer.domElement.getBoundingClientRect()) {
  if (!this.connectionLayer) return;
  const aligning = Boolean(this.alignmentTool && !this.alignmentTool.disposed);
  this.connectionLayer.style.display = this.visible && this.connectionsVisible && !aligning ? "block" : "none";
  for (const {source, target, element} of this.connections) {
   element.style.display = "none";
   if (aligning || !this.visible || !this.connectionsVisible || rect.width <= 0 || rect.height <= 0) continue;
   const segment = this.projectClippedConnection(source, target, rect);
   if (!segment) continue;
   const a = this.labels.get(source), b = this.labels.get(target);
   const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y, length = Math.hypot(dx, dy);
   // Trim only actual visible circles; clipped viewport endpoints have no label radius.
   const ar = a?.style.display === "flex" ? parseFloat(a.style.width) / 2 : 0;
   const br = b?.style.display === "flex" ? parseFloat(b.style.width) / 2 : 0;
   if (![segment.a.x, segment.a.y, segment.b.x, segment.b.y, ar, br].every(Number.isFinite) || length <= ar + br) continue;
   for (const [key, value] of Object.entries({x1: segment.a.x + dx * ar / length, y1: segment.a.y + dy * ar / length, x2: segment.b.x - dx * br / length, y2: segment.b.y - dy * br / length})) element.setAttribute(key, String(value));
   element.style.display = "";
  }
 }

	/** Toggle all relationship edges without deleting pairs or changing the label preference. */
	setConnectionsVisible(visible) {
		if (this.disposed) return this;
		this.connectionsVisible = Boolean(visible);
		this.update();
		return this;
	}

	/** Set display text without consuming a number; null restores automatic numbering. */
	setLabel(pointcloud, text) {
		if (this.disposed) return;
		if (text === null) this.texts.delete(pointcloud);
		else this.texts.set(pointcloud, String(text));
		this.update();
		return this;
	}

	/** Hide immediately while retaining numbering and the caller's visibility preference. */
	setVisible(visible) {
		if (this.disposed) return;
		// Hiding labels cancels transforms without clearing the alignment pair.
		if (!visible) this.alignmentTool?.gizmo?.cancelGesture();
		this.gesture = null;
		this.visible = Boolean(visible);
		this.layer.style.display = this.visible ? "" : "none";
		if (this.visible) this.update();
		return this;
	}

	// BEGIN point-cloud label anchor API
	/** Set a world-space resolver; null restores bounding-box centers without changing cloud poses. */
	setAnchorResolver(resolver) {
		if (this.disposed) return this;
		if (resolver !== null && typeof resolver !== "function") throw new TypeError("Anchor resolver must be a function or null");
		if (this.anchorResolver === resolver) return this;
		// Roll back the current press before its frozen plane or rotation pivot can change.
		this.alignmentTool?.gizmo?.cancelGesture();
		this.gesture = null;
		this.anchorResolver = resolver;
		this.update();
		return this;
	}

	/** Resolve one finite world anchor for labels, relationship endpoints and alignment pivots. */
	getWorldAnchor(pointcloud, target = new THREE.Vector3()) {
		if (this.disposed || !pointcloud) return null;
		// Do not recursively update octree nodes, whose matrices belong to the point renderer.
		pointcloud.updateWorldMatrix(true, false);
		if (this.anchorResolver) {
			try {
				const anchor = this.anchorResolver(pointcloud, target.set(NaN, NaN, NaN));
				if (!anchor || ![anchor.x, anchor.y, anchor.z].every(Number.isFinite)) return null;
				target.copy(anchor);
			} catch { return null; /* Invalid host data hides only this cloud's UI. */ }
		} else {
			// Keep the legacy world-box center unless the host explicitly supplies a resolver.
			const bounds = pointcloud.pcoGeometry?.tightBoundingBox ?? pointcloud.boundingBox ?? pointcloud.pcoGeometry?.boundingBox;
			if (!bounds || bounds.isEmpty()) return null;
			this.box.copy(bounds).applyMatrix4(pointcloud.matrixWorld).getCenter(target);
		}
		return [target.x, target.y, target.z].every(Number.isFinite) ? target : null;
	}
	// END point-cloud label anchor API

	/** Reconcile membership and project using CSS pixels, independent of device pixel ratio. */
	update() {
		if (this.disposed) return;
		// Release alignment locks before original scene/member cleanup can change active.
		this.alignmentTool?.reconcile();
		if (this.scene !== this.viewer.scene) this.setScene(this.viewer.scene);
		const clouds = new Set(this.scene?.pointclouds ?? []);
		// Removing the active identity releases overrides without choosing another cloud.
		if (this.activePointCloud && !clouds.has(this.activePointCloud)) this.setActivePointCloud(null);
		for (const [cloud, element] of this.labels) {
			if (!clouds.has(cloud)) { element.remove(); this.labels.delete(cloud); }
		}
		for (const cloud of clouds) {
			if (!this.numbers.has(cloud)) this.numbers.set(cloud, this.nextNumber++);
			if (!this.labels.has(cloud)) this.createLabel(cloud);
			const element = this.labels.get(cloud);
			element.textContent = this.texts.get(cloud) ?? String(this.numbers.get(cloud)).padStart(2, "0");
			element.setAttribute("aria-label", `Select point cloud ${element.textContent}`);
		}
		this.syncAppearance();
		if (!this.visible) { this.alignmentTool?.gizmo?.update(); return; }
		const rect = this.viewer.renderer.domElement.getBoundingClientRect();
		Object.assign(this.layer.style, {
			left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
		});
		const camera = this.scene?.getActiveCamera();
		camera?.updateWorldMatrix(true, false);
		this.connectionProjections.clear();
		for (const [cloud, element] of this.labels) {
			element.style.display = "none";
			// A custom anchor may be valid even when no bounding box is available.
			if (!camera || rect.width <= 0 || rect.height <= 0) continue;
			// Parent visibility and transforms are resolved without writing object poses.
			let hidden = false;
			for (let parent = cloud; parent; parent = parent.parent) hidden ||= parent.visible === false;
			if (hidden || isPointCloudRuntimeHidden(cloud)) continue;
			// Resolve once so label positions and clipped relationship endpoints cannot diverge.
			if (!this.getWorldAnchor(cloud, this.center)) continue;
			this.projected.copy(this.center).applyMatrix4(camera.matrixWorldInverse);
			// Keep valid object centers for line clipping even when their labels are culled.
			if (this.connections.length) this.connectionProjections.set(cloud, {clip: new THREE.Vector4(this.projected.x, this.projected.y, this.projected.z, 1).applyMatrix4(camera.projectionMatrix), depth: -this.projected.z});
			if (this.projected.z >= 0) continue;
			this.projected.applyMatrix4(camera.projectionMatrix);
			const {x, y, z} = this.projected;
			if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 1 || Math.abs(y) > 1 || Math.abs(z) > 1) continue;
			element.style.left = `${(x + 1) * rect.width / 2}px`;
			element.style.top = `${(1 - y) * rect.height / 2}px`;
			element.style.display = "flex";
		}
		this.alignmentTool?.gizmo?.update();
		this.updateConnections(rect);
	}

	/** Release only this tool's DOM, listeners and identity records. */
	dispose() {
		if (this.disposed) return;
		// Release alignment before clearing the primary selection.
		this.alignmentTool?.dispose(false);
		// Release runtime appearance before marking the tool inert.
		this.setActivePointCloud(null);
		this.disposed = true;
		for (const type of this.inputEvents) this.layer.removeEventListener(type, this.onLabelInput);
		this.gesture = null;
		this.unbindScene();
		this.viewer.removeEventListener("update", this.onUpdate);
		this.viewer.removeEventListener("render.pass.end", this.onUpdate);
		this.viewer.removeEventListener("scene_changed", this.onSceneChanged);
		this.layer.remove();
		this.labels.clear();
		this.connections = [];
		this.connectionProjections.clear();
		this.connectionLayer = null;
		this.numbers = new WeakMap();
		this.texts = new WeakMap();
		this.scene = null;
		// Release host closures when the label lifecycle ends.
		this.anchorResolver = null;
	}

	/** A scene switch starts a fresh sequence and discards scene-specific overrides. */
	setScene(scene) {
		// Scene-specific host pairs cannot leak into a replacement scene.
		this.connections = [];
		this.connectionProjections.clear();
		this.connectionLayer?.replaceChildren();
		this.alignmentTool?.dispose(false);
		// Clear directly to avoid recursing through the public scene-membership guard.
		const previousPointcloud = this.activePointCloud;
		this.activePointCloud = null;
		this.syncAppearance();
		if (previousPointcloud) this.viewer.dispatchEvent({type: "active_pointcloud_changed", pointcloud: null, previousPointcloud});
		this.gesture = null;
		this.unbindScene();
		for (const element of this.labels.values()) element.remove();
		this.labels.clear();
		this.numbers = new WeakMap();
		this.texts = new WeakMap();
		this.nextNumber = 1;
		this.scene = scene;
		scene?.addEventListener("pointcloud_added", this.onCloudChanged);
		scene?.addEventListener("pointcloud_removed", this.onCloudChanged);
	}

	/** Remove subscriptions from the actual previously bound scene. */
	unbindScene() {
		this.scene?.removeEventListener("pointcloud_added", this.onCloudChanged);
		this.scene?.removeEventListener("pointcloud_removed", this.onCloudChanged);
	}

	/** Use the same 40px blue circle and white border for every selection state. */
	createLabel(cloud) {
		const element = document.createElement("button");
		element.type = "button";
		this.cloudByElement.set(element, cloud);
		element.className = "potree-point-cloud-label";
		Object.assign(element.style, {
			position: "absolute", width: "40px", height: "40px", boxSizing: "border-box",
			border: "2px solid #ffffff", borderRadius: "50%", background: "#1c7efd",
			boxShadow: "0 0 8px rgba(71, 163, 255, 0.4)", color: "#ffffff",
			font: "600 14px sans-serif", alignItems: "center", justifyContent: "center",
			transform: "translate(-50%, -50%)", pointerEvents: "auto", userSelect: "none",
			padding: "0", cursor: "pointer", touchAction: "none",
		});
		this.layer.appendChild(element);
		this.labels.set(cloud, element);
	}
}
