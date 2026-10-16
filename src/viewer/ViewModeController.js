import {Vector3, Quaternion, Matrix4, Sphere} from "../../libs/three.js/build/three.module.js";

// Camera back and screen-up axes follow Potree's existing six-face convention.
const AXIS_VIEW_BASES = Object.freeze({
	top: {back: [0, 0, 1], up: [0, 1, 0]},
	bottom: {back: [0, 0, -1], up: [0, 1, 0]},
	left: {back: [-1, 0, 0], up: [0, 0, 1]},
	right: {back: [1, 0, 0], up: [0, 0, 1]},
	front: {back: [0, -1, 0], up: [0, 0, 1]},
	back: {back: [0, 1, 0], up: [0, 0, 1]},
});

/** Opt-in axis constraints; construction does not modify the default Viewer. */
export class ViewModeController {
	constructor(viewer) {
		this.viewer = viewer;
		this.mode = "3d";
		this.savedInputs = null;
		this.lockedQuaternion = null;
		this.transition = null;
		this.onUpdateStart = (event) => this.enforceOrientation(event);
		// The core skips document listeners for a disabled first finger; keep pinch and release reachable.
		this.onTouchStart = (event) => {
			if (event.pointerType === "touch" && this.mode !== "3d" && this.viewer.fjdCameraControls.enabled) {
				this.viewer.fjdCameraControls._addDocumentPointerListeners();
			}
		};
	}

	/** Switch modes without changing the caller's projection preference. */
	setMode(mode, options = {}) {
		if (mode !== "3d" && !Object.prototype.hasOwnProperty.call(AXIS_VIEW_BASES, mode)) {
			throw new RangeError(`Unknown view mode: ${mode}`);
		}
		if (mode === this.mode) {
			if (options.animate === false) this.finishTransition();
			return;
		}
		// A new request replaces the current transition at its visible pose, never its old endpoint.
		this.cancelTransition();
		const previousMode = this.mode;
		const controls = this.viewer.fjdCameraControls;
		if (!controls) throw new Error("View modes require fjdCameraControls.");
		this.viewer.setControls(controls);
		// Cancel inertia and active pointer gestures before changing input policy.
		controls.stop();
		// stop() cancels transitions only; reapply the visible pose to clear gesture inertia as well.
		controls.setRigidPose(controls.getRigidPose(false), false);
		const from = controls.getRigidPose(false);
		controls.disconnect();
		controls.connect(this.viewer.renderArea);
		if (mode === "3d") {
			controls.mouseButtons.left = this.savedInputs.left;
			controls.touches.one = this.savedInputs.one;
			this.savedInputs = null;
			this.lockedQuaternion = null;
			this.viewer.removeEventListener("update_start", this.onUpdateStart);
			this.viewer.renderArea.removeEventListener("pointerdown", this.onTouchStart);
		} else {
			if (!this.savedInputs) {
				this.savedInputs = {left: controls.mouseButtons.left, one: controls.touches.one};
				this.viewer.addEventListener("update_start", this.onUpdateStart);
			}
			// Disabling these gestures also avoids the core's fixed left-drag rotation path.
			controls.mouseButtons.left = controls.constructor.ACTION.NONE;
			controls.touches.one = controls.constructor.ACTION.NONE;
		}
		this.mode = mode;
		if (mode !== "3d") {
			// Re-register after connect so the core always handles pointerdown before this bridge.
			this.viewer.renderArea.removeEventListener("pointerdown", this.onTouchStart);
			this.viewer.renderArea.addEventListener("pointerdown", this.onTouchStart);
			const fitted = this.fit();
			const duration = Number.isFinite(options.duration) ? Math.max(0, options.duration) : 350;
			if (fitted && options.animate !== false && duration > 0) {
				this.startTransition(from, controls.getRigidPose(false), duration);
			}
		}
		this.viewer.dispatchEvent({type: "view_mode_changed", mode, previousMode});
	}

	/** Refit visible clouds in the selected mode; empty scenes retain a valid constraint. */
	fit(options = {}) {
		// Explicit refits and projection changes take ownership of the camera immediately.
		this.cancelTransition();
		if (this.mode === "3d") {
			if (this.getBounds().isEmpty()) return false;
			this.viewer.setTopView4CameraControls(true, options);
			return true;
		}
		const controls = this.viewer.fjdCameraControls;
		this.viewer.syncControlsContext(controls);
		const basis = AXIS_VIEW_BASES[this.mode];
		const back = new Vector3().fromArray(basis.back);
		const up = new Vector3().fromArray(basis.up);
		const right = new Vector3().crossVectors(up, back).normalize();
		this.lockedQuaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
		const box = this.getBounds();
		if (box.isEmpty()) {
			controls.setRigidPose({quaternion: this.lockedQuaternion}, false);
			return false;
		}
		if (this.mode === "top") {
			// Reuse the original top-view fit, including its XRAY distance bookkeeping.
			this.viewer.setTopView4CameraControls(false, options);
			controls.getQuaternion(this.lockedQuaternion, true);
			return true;
		}
		const camera = controls.camera;
		const size = box.getSize(new Vector3());
		const center = box.getCenter(new Vector3());
		const projectedSize = (axis) => Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
		const width = projectedSize(right);
		const height = projectedSize(up);
		const depth = projectedSize(back);
		// Match the legacy top-view padding, or honor an explicit viewport occupancy.
		const occupancy = options.viewportOccupancy;
		const padding = Number.isFinite(occupancy) && occupancy > 0 && occupancy <= 1 ? 1 / occupancy : 1.05;
		let distance;
		let zoom = 1;
		if (camera.isPerspectiveCamera) {
			const halfFov = camera.fov * Math.PI / 360;
			distance = depth / 2 + Math.max(height, width / Math.max(camera.aspect, Number.EPSILON)) * padding / (2 * Math.tan(halfFov));
			distance = Math.max(distance, depth / 2 + camera.near * 2, controls.minDistance, Number.EPSILON);
		} else {
			zoom = Math.min(
				(camera.right - camera.left) / Math.max(width * padding, Number.EPSILON),
				(camera.top - camera.bottom) / Math.max(height * padding, Number.EPSILON),
			);
			zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, zoom));
			distance = depth / 2 + Math.max(depth, 1);
		}
		controls.setRigidPose({
			position: center.clone().addScaledVector(back, distance),
			quaternion: this.lockedQuaternion,
			orbitPoint: center,
			zoom,
		}, false);
		this.viewer.scene.view.radius = box.getBoundingSphere(new Sphere()).radius;
		return true;
	}

	/** Animate a rigid orbit pose with shortest-path quaternion interpolation and smooth easing. */
	startTransition(from, to, duration) {
		const fromQuaternion = new Quaternion().fromArray(from.quaternion);
		const toQuaternion = new Quaternion().fromArray(to.quaternion);
		const fromOrbit = new Vector3().fromArray(from.orbitPoint);
		const toOrbit = new Vector3().fromArray(to.orbitPoint);
		this.transition = {
			fromQuaternion, toQuaternion, fromOrbit, toOrbit,
			// Interpolate camera-local offsets to arc around the cloud instead of crossing its center.
			fromOffset: new Vector3().fromArray(from.position).sub(fromOrbit).applyQuaternion(fromQuaternion.clone().invert()),
			toOffset: new Vector3().fromArray(to.position).sub(toOrbit).applyQuaternion(toQuaternion.clone().invert()),
			fromZoom: from.zoom, toZoom: to.zoom, to, duration, elapsed: 0,
			wasEnabled: this.viewer.fjdCameraControls.enabled,
		};
		this.viewer.fjdCameraControls.setRigidPose(from, false);
		// Keep camera gestures from competing with the short mode-switch animation.
		this.viewer.fjdCameraControls.enabled = false;
	}

	/** Advance the current transition using the Viewer's frame delta in seconds. */
	advanceTransition(delta) {
		const transition = this.transition;
		transition.elapsed += Number.isFinite(delta) ? Math.max(0, delta) * 1000 : 0;
		if (transition.elapsed + 1e-6 >= transition.duration) {
			this.finishTransition();
			return;
		}
		const progress = transition.elapsed / transition.duration;
		const eased = progress * progress * (3 - 2 * progress);
		const quaternion = transition.fromQuaternion.clone().slerp(transition.toQuaternion, eased);
		const orbitPoint = transition.fromOrbit.clone().lerp(transition.toOrbit, eased);
		const position = transition.fromOffset.clone().lerp(transition.toOffset, eased).applyQuaternion(quaternion).add(orbitPoint);
		this.viewer.fjdCameraControls.setRigidPose({
			position, quaternion, orbitPoint,
			zoom: transition.fromZoom + (transition.toZoom - transition.fromZoom) * eased,
		}, false);
	}

	/** Settle temporary tool snapshots at a valid axis pose and restore camera input. */
	finishTransition() {
		if (!this.transition) return;
		const transition = this.transition;
		this.viewer.fjdCameraControls.setRigidPose(transition.to, false);
		this.cancelTransition();
	}

	/** Cancel pending movement without changing its last visible pose. */
	cancelTransition() {
		if (!this.transition) return;
		this.viewer.fjdCameraControls.enabled = this.transition.wasEnabled;
		this.transition = null;
	}

	/** Preserve legacy visibility fallback without changing point-cloud coordinates. */
	getBounds() {
		const clouds = this.viewer.scene.pointclouds;
		const visible = clouds.filter((cloud) => cloud.visible !== false);
		return this.viewer.getBoundingBox(visible.length ? visible : clouds);
	}

	/** Keep explicit pose updates and projection changes from releasing an active axis lock. */
	enforceOrientation(event = {}) {
		if (!this.lockedQuaternion || this.mode === "3d") return;
		const controls = this.viewer.fjdCameraControls;
		if (this.viewer.controls !== controls) {
			this.cancelTransition();
			return;
		}
		this.viewer.syncControlsContext(controls);
		if (this.transition) {
			this.advanceTransition(event.delta);
			return;
		}
		if (controls.getQuaternion(new Quaternion(), true).angleTo(this.lockedQuaternion) > 1e-6) {
			controls.setRigidPose({...controls.getRigidPose(true), quaternion: this.lockedQuaternion}, false);
		}
	}
}
