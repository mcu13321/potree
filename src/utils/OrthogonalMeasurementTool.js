import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";
import {Measure} from "./Measure.js";
import {Utils} from "../utils.js";
import {pickOrthogonalSurface, pickOrthogonalPoint, projectOrthogonalEndpoint} from "./OrthogonalSurface.js";

// Cursor fitting and axis-constrained geometry have independent validity rules.
export class OrthogonalMeasurementTool extends EventDispatcher {
	constructor(viewer) {
		super();
		this.viewer = viewer;
		this.active = false;
		this.editingEnabled = true;
		this.draft = null;
		this.edit = null;
		this.mouse = null;
		this.lastSampleKey = null;
		// Render disks before the overlay clears scene depth, so they remain attached to visible surfaces.
		this.scene = new THREE.Scene();
		this.circles = [0, 1].map(() => {
			const circle = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
				color: 0xffffff, opacity: 0.35, transparent: true, side: THREE.DoubleSide,
				depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
			}));
			circle.visible = false;
			circle.raycast = () => {};
			this.scene.add(circle);
			return circle;
		});
		this.listeners = [];
		const listen = (target, type, callback, capture = false) => {
			target.addEventListener(type, callback, capture);
			this.listeners.push(() => target.removeEventListener(type, callback, capture));
		};
		const canvas = viewer.renderer.domElement;
		listen(canvas, "mousemove", event => {
			this.mouse = viewer.inputHandler.getEventLocalPosition(event);
			// Hide old feedback immediately; the next viewer frame resolves the newest pointer.
			if (this.active) this.invalidate();
		});
		listen(canvas, "mouseleave", () => {this.mouse = null; this.invalidate();});
		listen(canvas, "mousedown", event => {
			if (this.active) this.down = {button: event.button, position: viewer.inputHandler.getEventLocalPosition(event)};
		});
		listen(canvas, "mouseup", event => this.onMouseUp(event));
		// Capture the release before InputHandler clears its marker drag state.
		listen(canvas.ownerDocument, "mouseup", event => {
			if (!this.edit) return;
			const {measurement, index} = this.edit;
			const end = viewer.inputHandler.getEventLocalPosition(event);
			if (event.button !== 0 || !end || event.target !== canvas) {this.cancelEdit(); return;}
			this.handleMarkerDrop({drag: {object: measurement.spheres[index], end}}, measurement);
		}, true);
		listen(canvas.ownerDocument.defaultView, "blur", () => {this.cancelEdit(); this.mouse = null; this.invalidate();});
		listen(canvas, "contextmenu", event => {
			// Right-click discards the current marker while preserving the selected tool.
			if (this.active || this.edit) {event.preventDefault(); this.cancelDraft();}
		});
		listen(canvas.ownerDocument, "keydown", event => {
			if (event.key === "Escape" && (this.active || this.edit)) {this.stopInsertion(); event.preventDefault();}
		});
		listen(viewer, "update", () => this.update());
		listen(viewer, "render.pass.scene", () => {
			if (this.circles.some(circle => circle.visible)) viewer.renderer.render(this.scene, viewer.scene.getActiveCamera());
		});
		listen(viewer, "cancel_insertions", () => this.stopInsertion());
		const removed = ({measurement}) => {
			if (this.edit?.measurement === measurement) this.cancelEdit();
			if (this.draft === measurement) this.draft = null;
		};
		const rebased = ({delta}) => {
			// Rebase the rollback snapshot before restoring a cancelled edit transaction.
			this.edit?.points.forEach(point => point.add(delta));
			this.stopInsertion();
		};
		let scene = viewer.scene;
		const bindScene = target => {
			target.addEventListener("measurement_removed", removed);
			target.addEventListener("pointcloud_offset_changed", rebased);
		};
		const unbindScene = target => {
			target.removeEventListener("measurement_removed", removed);
			target.removeEventListener("pointcloud_offset_changed", rebased);
		};
		bindScene(scene);
		listen(viewer, "scene_changed", () => {
			// A scene replacement must remove the draft from its original owner as well.
			const draft = this.draft;
			this.stopInsertion();
			if (draft && scene !== viewer.scene) scene.removeMeasurement(draft);
			unbindScene(scene);
			scene = viewer.scene;
			bindScene(scene);
		});
		this.listeners.push(() => unbindScene(scene));
	}

	startInsertion() {
		this.stopInsertion(false);
		this.viewer.measuringTool.stopInsertion();
		this.viewer.axisLineMarkerTool?.stopInsertion?.();
		this.active = true;
		this.viewer.scene.dispatchEvent({type: "measurement_selected", measurement: null});
	}

	stopInsertion(notify = true) {
		const wasActive = this.active;
		this.active = false;
		this.cancelDraft();
		if (wasActive && notify) this.dispatchEvent({type: "orthogonal_deactivated"});
	}

	// Reset only the current transaction so the next left-click can place a new first point.
	cancelDraft() {
		this.down = null;
		this.cancelEdit();
		if (this.draft) {
			this.viewer.scene.removeMeasurement(this.draft);
			this.viewer.scene.dispatchEvent({type: "measurement_selected", measurement: null});
		}
		this.draft = null;
		this.invalidate();
	}

	invalidate() {
		this.lastSampleKey = null;
		this.surface = null;
		this.circles.forEach(circle => {circle.visible = false;});
		// Keep the existing line visible between pointer samples, including temporary misses.
	}

	showCircle(index, position, direction) {
		const circle = this.circles[index];
		const camera = this.viewer.scene.getActiveCamera();
		const canvas = this.viewer.renderer.domElement;
		const projected = Utils.projectedRadius(1, camera, camera.position.distanceTo(position), canvas.clientWidth, canvas.clientHeight);
		circle.position.copy(position);
		circle.scale.setScalar(12 / projected);
		// Use the real plane normal; restored references can fall back to their locked world axis.
		const normal = typeof direction === "string" ? new THREE.Vector3() : direction.clone().normalize();
		if (typeof direction === "string") normal[direction] = 1;
		circle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
		circle.visible = true;
	}

	update() {
		if (!this.active || this.edit || !this.mouse) return;
		const camera = this.viewer.scene.getActiveCamera();
		const canvas = this.viewer.renderer.domElement;
		// Unchanged views need no repeated GPU readback; camera, LOD and clipping still invalidate it.
		const key = JSON.stringify([
			this.mouse.x, this.mouse.y, canvas.clientWidth, canvas.clientHeight, Boolean(this.draft),
			camera.matrixWorld.elements, camera.projectionMatrix.elements,
			this.viewer.scene.pointclouds.map(cloud => [
				cloud.uuid, cloud.visible, cloud.matrixWorld.elements,
				cloud.visibleNodes?.map(node => node.geometryNode?.name),
				cloud.material.version, cloud.material.clipTask, cloud.material.clipMethod,
				cloud.material.clipBoxes?.map(box => box.inverse?.elements),
				cloud.material.clipPolygons?.map(polygon => polygon.markers?.map(marker => marker.position.toArray())),
				cloud.material.classificationTexture?.version,
				['uFilterReturnNumberRange', 'uFilterNumberOfReturnsRange', 'uFilterGPSTimeClipRange', 'uFilterPointSourceIDClipRange']
					.map(name => cloud.material.uniforms?.[name]?.value),
			]),
		]);
		if (key === this.lastSampleKey) return;
		this.refresh(this.mouse);
		this.lastSampleKey = key;
	}

	refresh(mouse) {
		this.invalidate();
		// Lock the first normal once; every later hit only supplies the projected coordinate.
		const surface = this.draft ? pickOrthogonalPoint(this.viewer, mouse) : pickOrthogonalSurface(this.viewer, mouse);
		// Plane fitting controls only the cursor disk, never target projection or confirmation.
		const cursorSurface = this.draft && surface
			? pickOrthogonalSurface(this.viewer, mouse, {requireAxisAlignment: false, point: surface}) : surface;
		this.surface = surface;
		if (this.draft) this.showCircle(0, this.draft.points[0].position, this.draft.orthogonalStartNormal);
		if (cursorSurface) this.showCircle(1, cursorSurface.position, cursorSurface.normal);
		if (surface && this.draft) {
			const end = projectOrthogonalEndpoint(this.draft.points[0].position, surface.position, this.draft.orthogonalAxis);
			this.draft.setPosition(1, end);
			this.draft.showEdges = true;
			this.draft.showDistances = true;
			this.draft.spheres[1].visible = true;
		}
		return surface;
	}

	onMouseUp(event) {
		if (!this.active || !this.down) return;
		const down = this.down;
		this.down = null;
		const mouse = this.viewer.inputHandler.getEventLocalPosition(event);
		if (!mouse || down.button !== event.button || !this.viewer.inputHandler.isTapGesture("mouse", down.position, mouse)) return;
		// Some browsers dispatch contextmenu before mouseup; both paths are idempotent.
		if (event.button === 2) {this.cancelDraft(); return;}
		if (event.button !== 0 || event.detail > 1) return;
		// Re-pick at commit time so an old hover can never authorize a click.
		const surface = this.refresh(mouse);
		if (!surface) return;
		if (!this.draft) {
			const measurement = new Measure(this.viewer);
			measurement.name = "orthogonal";
			measurement.orthogonalAxis = surface.axis;
			// Preserve the fitted first-plane orientation separately from the snapped measuring axis.
			measurement.orthogonalStartNormal = surface.normal.clone();
			measurement.closed = false;
			measurement.maxMarkers = 2;
			measurement.addMarker(surface.position.clone());
			measurement.addMarker(surface.position.clone());
			this.draft = measurement;
			this.viewer.scene.addMeasurement(measurement);
			this.showCircle(0, surface.position, surface.normal);
			this.circles[1].visible = false;
			this.viewer.scene.dispatchEvent({type: "measurement_selected", measurement});
		} else if (this.draft.points[0].position.distanceTo(this.draft.points[1].position) > 1e-9) {
			const measurement = this.draft;
			measurement.finished = true;
			this.draft = null;
			this.viewer.scene.addMeasurement2platform(measurement);
			measurement.dispatchEvent({type: "measure_finished", measurement});
			this.viewer.scene.dispatchEvent({type: "measurement_selected", measurement: null});
			this.invalidate();
		}
	}

	handleMarkerDrag(event, measurement) {
		if (!this.editingEnabled || this.active || this.viewer.inputHandler.measurementReadonly || !measurement.finished ||
			this.viewer.measuringTool.eventMeasurement || this.viewer.axisLineMarkerTool?.activeMarker) return;
		const index = measurement.spheres.indexOf(event.drag.object);
		if (index < 0) return;
		if (!this.edit) {
			this.edit = {measurement, index, points: measurement.points.map(point => point.position.clone()), valid: false};
		}
		if (this.edit.measurement !== measurement || this.edit.index !== index) return;
		// Editing the start still validates its plane; the end accepts any visible point.
		const surface = index === 0 ? pickOrthogonalSurface(this.viewer, event.drag.end) : pickOrthogonalPoint(this.viewer, event.drag.end);
		const cursorSurface = index === 1 && surface
			? pickOrthogonalSurface(this.viewer, event.drag.end, {requireAxisAlignment: false, point: surface}) : surface;
		const axis = measurement.orthogonalAxis;
		this.edit.valid = Boolean(surface) && (index === 1 || surface.axis === axis);
		this.circles.forEach(circle => {circle.visible = false;});
		if (cursorSurface) this.showCircle(1, cursorSurface.position, cursorSurface.normal);
		if (!this.edit.valid) return;
		const [start, end] = this.edit.points;
		const nextStart = index === 0 ? surface.position : start;
		const nextEnd = projectOrthogonalEndpoint(nextStart, index === 0 ? end : surface.position, axis);
		this.edit.valid = nextStart.distanceTo(nextEnd) > 1e-9;
		if (!this.edit.valid) return;
		measurement.setPosition(0, nextStart.clone());
		measurement.setPosition(1, nextEnd);
		// The reference disk also retains the actual start-plane normal when available.
		this.showCircle(0, nextStart, index === 0 ? surface.normal : (measurement.orthogonalStartNormal ?? axis));
	}

	handleMarkerDrop(event, measurement) {
		this.handleMarkerDrag(event, measurement);
		if (!this.edit || this.edit.measurement !== measurement) return;
		if (!this.edit.valid) {this.cancelEdit(); return;}
		if (this.edit.index === 0) measurement.orthogonalStartNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.circles[1].quaternion);
		this.edit = null;
		this.invalidate();
		this.viewer.scene.dispatchEvent({type: "orthogonal_measurement_updated", measurement});
	}

	cancelEdit() {
		if (this.edit) {
			const {measurement, points} = this.edit;
			points.forEach((point, index) => measurement.setPosition(index, point));
			this.edit = null;
			// Prevent another mousemove from restarting an edit after Escape or a scene switch.
			this.viewer.inputHandler.endDragging?.();
			this.viewer.inputHandler.isMeasurementEdit = false;
			if (this.viewer.controls) this.viewer.controls.enabled = true;
		}
		this.circles.forEach(circle => {circle.visible = false;});
	}

	dispose() {
		this.stopInsertion();
		this.listeners.forEach(remove => remove());
		this.circles.forEach(circle => {circle.parent?.remove(circle); circle.geometry.dispose(); circle.material.dispose();});
	}
}
