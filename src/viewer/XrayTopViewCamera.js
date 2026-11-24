import {OrthographicCamera, Quaternion, Vector3} from "../../libs/three.js/build/three.module.js";

const WORLD_UP = new Vector3(0, 0, 1);
// Leave a wider release angle so small movements do not restart the transition.
const SNAP_DOT = Math.cos(6 * Math.PI / 180);
const RELEASE_DOT = Math.cos(9 * Math.PI / 180);
const SNAP_DURATION = 0.4;
const IDENTITY_ROTATION = new Quaternion();
const DOT_EPSILON = 1e-12;

/** Animate the render camera, then let the controller steer out of the top-view band. */
export class XrayTopViewCamera {
	constructor(){
		this.camera = new OrthographicCamera();
		this.back = new Vector3();
		this.renderBack = new Vector3();
		this.target = new Vector3();
		this.levelRotation = new Quaternion();
		this.reset();
	}

	get isAnimating(){
		return this.referenceZ !== null && this.elapsed < SNAP_DURATION;
	}

	reset(){
		this.referenceZ = null;
		this.elapsed = 0;
		this.releaseControls();
	}

	lockControls(controls){
		if(!controls.enabled) return;
		this.lockedControls = controls;
		controls.enabled = false;
		// End the active gesture and clear residual motion at the visible pose.
		controls.cancel();
		controls.setRigidPose(controls.getRigidPose(false), false);
	}

	releaseControls(){
		// Restore input only if this transition disabled it.
		if(!this.lockedControls) return;
		this.lockedControls.enabled = true;
		this.lockedControls = null;
	}

	// Only the viewer update loop passes a delta; direct renders reuse the current progress.
	update(perspective, controls, fallbackDistance, delta = 0){
		const back = this.back.copy(WORLD_UP).applyQuaternion(perspective.quaternion);
		const entering = this.referenceZ === null;
		if(!Number.isFinite(back.z) || (entering ? back.z < SNAP_DOT - DOT_EPSILON : back.z <= RELEASE_DOT + DOT_EPSILON)){
			this.reset();
			return null;
		}

		const position = perspective.position;
		if(entering){
			controls.getTarget(this.target, false);
			const targetDepth = this.target.sub(position).dot(back) * -1;
			const distance = targetDepth > Number.EPSILON ? targetDepth : fallbackDistance;
			if(!Number.isFinite(distance) || distance <= Number.EPSILON) return null;
			// Keep the plane stable if the next pointer press picks a different orbit point.
			this.referenceZ = position.z - back.z * distance;
			this.camera.far = perspective.far;
			this.camera.near = -perspective.far;
			// An already vertical camera has no rotation to animate.
			if(back.z >= 1 - DOT_EPSILON) this.elapsed = SNAP_DURATION;
			else this.lockControls(controls);
		}else if(Number.isFinite(delta) && delta > 0){
			this.elapsed = Math.min(this.elapsed + delta, SNAP_DURATION);
		}

		const distance = (position.z - this.referenceZ) / back.z;
		const projection = perspective.projectionMatrix.elements;
		const halfWidth = distance / projection[0];
		const halfHeight = distance / projection[5];
		if(!Number.isFinite(halfWidth) || !Number.isFinite(halfHeight) || halfWidth <= 0 || halfHeight <= 0){
			this.reset();
			return null;
		}

		const camera = this.camera;
		// Ease the shortest leveling rotation around the same point on the reference plane.
		const progress = this.elapsed / SNAP_DURATION;
		const eased = progress * progress * (3 - 2 * progress);
		const rotation = this.levelRotation.setFromUnitVectors(back, WORLD_UP).slerp(IDENTITY_ROTATION, 1 - eased);
		const renderBack = this.renderBack.copy(back).applyQuaternion(rotation);
		camera.position.copy(position).addScaledVector(back, -distance).addScaledVector(renderBack, distance);
		camera.quaternion.copy(perspective.quaternion).premultiply(rotation);
		camera.up.copy(WORLD_UP);
		// Match magnification and any perspective lens offset on the reference plane.
		camera.left = (projection[8] - 1) * halfWidth;
		camera.right = (projection[8] + 1) * halfWidth;
		camera.bottom = (projection[9] - 1) * halfHeight;
		camera.top = (projection[9] + 1) * halfHeight;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		// The last frame settles before accepting a new gesture.
		if(!this.isAnimating) this.releaseControls();
		return camera;
	}
}
