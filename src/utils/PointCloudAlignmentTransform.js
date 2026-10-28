import * as THREE from "../../libs/three.js/build/three.module.js";

// Preview poses stay outside userData and project files until explicitly committed.
const alignmentPoseSnapshots = new WeakMap();
const alignmentCommittedMatrices = new WeakSet();
// Only explicit alignment operations may own manual matrix rebasing.
const alignmentManagedMatrices = new WeakSet();
// Immutable loading baselines and confirmed poses are independent of temporary alignment sessions.
const alignmentExportPoses = new WeakMap();
const alignmentViewNormals = {top: [0, 0, 1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0]};

/** Read the shared scene offset without allocating state on the point cloud. */
function alignmentOffset(cloud) {
	return (cloud.userData?.appliedTransformOffset ?? cloud.userData?.offset)?.clone?.() ?? new THREE.Vector3();
}

/** Capture exact local state, including affine matrices and coordinate-rebase bookkeeping. */
export function captureAlignmentPose(cloud) {
	if (cloud.matrixAutoUpdate) cloud.updateMatrix();
	return {
		matrix: cloud.matrix.clone(), position: cloud.position.clone(), quaternion: cloud.quaternion.clone(),
		scale: cloud.scale.clone(), order: cloud.rotation.order, matrixAutoUpdate: cloud.matrixAutoUpdate,
		managed: alignmentManagedMatrices.has(cloud),
		offset: alignmentOffset(cloud), sourcePosition: cloud.userData?.sourcePosition?.clone?.(),
	};
}

/** Keep an immutable session baseline available to persistence while previews are visible. */
export function beginAlignmentPose(cloud, pose) {
	alignmentPoseSnapshots.set(cloud, pose);
}

/** Express a baseline in the scene's current shared coordinate system. */
function alignmentBaselineMatrix(cloud, pose, offset = alignmentOffset(cloud)) {
	const delta = offset.clone().sub(pose.offset);
	const matrix = pose.matrix.clone();
	matrix.elements[12] += delta.x;
	matrix.elements[13] += delta.y;
	matrix.elements[14] += delta.z;
	return matrix;
}

/** Restore the entry pose exactly, compensating only for a shared scene-origin change. */
export function restoreAlignmentPose(cloud, pose) {
	const matrix = alignmentBaselineMatrix(cloud, pose);
	cloud.position.copy(pose.position).add(alignmentOffset(cloud).sub(pose.offset));
	cloud.rotation.order = pose.order;
	cloud.quaternion.copy(pose.quaternion);
	cloud.scale.copy(pose.scale);
	cloud.matrixAutoUpdate = pose.matrixAutoUpdate;
	cloud.matrix.copy(matrix);
	if (pose.managed) alignmentManagedMatrices.add(cloud);
	else alignmentManagedMatrices.delete(cloud);
	if (pose.sourcePosition) cloud.userData.sourcePosition = pose.sourcePosition.clone();
	// Octree nodes use cloud-relative coordinates; recursive updates would add ancestor offsets twice.
	cloud.updateWorldMatrix(true, false);
}

/** Apply exact parent-local matrices; retain affine shear instead of silently losing it. */
export function applyAlignmentLocalMatrix(cloud, matrix, preferAutoUpdate = true) {
	if (!matrix.elements.every(Number.isFinite)) return false;
	const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose(position, quaternion, scale);
	if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(Number.isFinite)) return false;
	cloud.position.copy(position);
	cloud.quaternion.copy(quaternion);
	cloud.scale.copy(scale);
	const composed = new THREE.Matrix4().compose(position, quaternion, scale);
	const representable = matrix.elements.every((value, index) => Math.abs(value - composed.elements[index]) <= 1e-9 * Math.max(1, Math.abs(value)));
	cloud.matrixAutoUpdate = Boolean(preferAutoUpdate && representable);
	cloud.matrix.copy(matrix);
	alignmentManagedMatrices.add(cloud);
	// Scene rebasing reconstructs position from this cache; preserve the user's displacement.
	if (cloud.userData?.sourcePosition) cloud.userData.sourcePosition.copy(cloud.position).sub(alignmentOffset(cloud));
	// Octree nodes use cloud-relative coordinates; recursive updates would add ancestor offsets twice.
	cloud.updateWorldMatrix(true, false);
	return true;
}

/** Release preview serialization ownership and remember matrices that must round-trip exactly. */
export function endAlignmentPose(cloud, committed) {
	alignmentPoseSnapshots.delete(cloud);
	if (committed) {
		alignmentCommittedMatrices.add(cloud);
		const record = alignmentExportPoses.get(cloud);
		if (record) record.committed = captureAlignmentPose(cloud);
	}
}

/** Explicit host updates preserve loading baselines and never install default scene hooks. */
export function setPointCloudPose(viewer, cloud, input) {
	if (!cloud?.isObject3D) throw new TypeError("A point-cloud object is required");
	const member = viewer.scene.pointclouds.includes(cloud);
	if (!member && (cloud.parent || alignmentTrackingOwners.get(cloud)?.size)) throw new RangeError("Point cloud belongs to another scene");
	const tracker = viewer.pointCloudAlignmentTrackingTool;
	const record = alignmentExportPoses.get(cloud) ?? tracker?.records.get(cloud);
	if (member && (!tracker || tracker.disposed || tracker.scene !== viewer.scene || !record)) throw new Error("Enable alignment tracking before updating a scene member");
	if (viewer.pointCloudAlignmentTool && !viewer.pointCloudAlignmentTool.disposed) throw new Error("End alignment before setting a point-cloud pose");
	const values = input?.elements;
	if (!values || values.length !== 16 || !Array.from(values).every(Number.isFinite)) throw new RangeError("Pose matrix must contain 16 finite values");
	const matrix = new THREE.Matrix4().fromArray(values);
	const determinant = matrix.determinant();
	if (!Number.isFinite(determinant) || determinant === 0 || [3, 7, 11].some(i => Math.abs(values[i]) > 1e-12) || Math.abs(values[15] - 1) > 1e-12) throw new RangeError("Pose matrix must be invertible and affine");
	// Validate decomposition before any object, source-position cache or tracking record is changed.
	const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose(position, quaternion, scale);
	if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(Number.isFinite)) throw new RangeError("Pose matrix cannot be decomposed");
	if (!applyAlignmentLocalMatrix(cloud, matrix)) throw new RangeError("Pose matrix cannot be applied");
	alignmentCommittedMatrices.add(cloud);
	if (record) record.committed = captureAlignmentPose(cloud);
	// Detached clouds receive their initial record only when an explicitly enabled tracker retains them.
	if (member) {
		viewer.pointCloudLabelTool?.update();
		viewer.dispatchEvent({type: "pointcloud_pose_changed", pointcloud: cloud, matrix: cloud.matrix.clone(), matrixWorld: cloud.matrixWorld.clone()});
	}
	return cloud;
}

/** Save the baseline during preview, and exact confirmed matrices after commit. */
export function getAlignmentPoseData(cloud) {
	const pose = alignmentPoseSnapshots.get(cloud);
	if (!pose && !alignmentCommittedMatrices.has(cloud)) {
		return {position: cloud.position.toArray(), rotation: cloud.rotation.toArray(), scale: cloud.scale.toArray()};
	}
	const matrix = pose ? alignmentBaselineMatrix(cloud, pose) : captureAlignmentPose(cloud).matrix;
	const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose(position, quaternion, scale);
	const rotation = new THREE.Euler().setFromQuaternion(quaternion, pose?.order ?? cloud.rotation.order);
	return {position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray(), alignmentTransform: {version: 1, matrix: matrix.toArray()}};
}

/** Optional matrix data extends existing TRS projects without changing legacy loading. */
export function loadAlignmentPoseMatrix(cloud, data, enabled = false) {
	if (!enabled) return;
	const extension = data.alignmentTransform;
	if (extension?.version !== 1 || !Array.isArray(extension.matrix) || extension.matrix.length !== 16 || !extension.matrix.every(Number.isFinite)) return;
	if (!applyAlignmentLocalMatrix(cloud, new THREE.Matrix4().fromArray(extension.matrix))) return;
	alignmentCommittedMatrices.add(cloud);
	// Exact extension matrices finish the explicitly enabled project's loading baseline.
	const initial = captureAlignmentPose(cloud);
	const record = alignmentExportPoses.get(cloud);
	if (record) {record.initial = initial; record.committed = initial;}
	else alignmentExportPoses.set(cloud, {initial, committed: initial});
}

/** Match the tight-bound world center already used by the DOM labels. */
export function getAlignmentWorldCenter(cloud) {
	const bounds = cloud.pcoGeometry?.tightBoundingBox ?? cloud.boundingBox ?? cloud.pcoGeometry?.boundingBox;
	if (!bounds || bounds.isEmpty()) return null;
	cloud.updateWorldMatrix(true, false);
	return new THREE.Box3().copy(bounds).applyMatrix4(cloud.matrixWorld).getCenter(new THREE.Vector3());
}

/** Signed camera-facing normals keep opposite face gestures visually consistent. */
export function getAlignmentViewNormal(mode) {
	return alignmentViewNormals[mode] ? new THREE.Vector3().fromArray(alignmentViewNormals[mode]) : null;
}

/** Intersect in center-relative coordinates to limit cancellation at survey-scale origins. */
export function alignmentPlanePoint(camera, rect, x, y, center, normal) {
	if (rect.width <= 0 || rect.height <= 0) return null;
	camera.updateWorldMatrix(true, false);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height), camera);
	const ray = raycaster.ray.clone();
	ray.origin.sub(center);
	const point = ray.intersectPlane(new THREE.Plane(normal, 0), new THREE.Vector3());
	return point?.toArray().every(Number.isFinite) ? point : null;
}

/** Build world-space rigid deltas without accumulating Euler or per-frame matrix errors. */
export function alignmentRotationMatrix(center, normal, angle) {
	return new THREE.Matrix4().makeTranslation(center.x, center.y, center.z)
		.multiply(new THREE.Matrix4().makeRotationAxis(normal, angle))
		.multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}

/** Capture the loading pose once; removing and re-adding the same object never resets it. */
export function recordInitialAlignmentPose(cloud) {
	if (alignmentExportPoses.has(cloud)) return;
	const initial = captureAlignmentPose(cloud);
	alignmentExportPoses.set(cloud, {initial, committed: initial});
}

/** Describe a matrix for inspection; its full affine data remains authoritative. */
function alignmentExportPose(matrix) {
	const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose(position, quaternion, scale);
	return {matrix: matrix.toArray(), position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray()};
}

/** Export the local right-multiply delta in the scene's current shared reference frame. */
export function getPointCloudAlignmentResult(cloud) {
	const record = alignmentExportPoses.get(cloud);
	if (!record) throw new Error("The point cloud has no recorded loading pose");
	cloud.parent?.updateWorldMatrix(true, false);
	const parent = cloud.parent?.matrixWorld ?? new THREE.Matrix4();
	// Re-express both poses with the same parent and scene offset, excluding origin-only changes.
	const initial = parent.clone().multiply(alignmentBaselineMatrix(cloud, record.initial));
	const final = parent.clone().multiply(alignmentBaselineMatrix(cloud, record.committed));
	if (![...initial.elements, ...final.elements].every(Number.isFinite) || initial.determinant() === 0 || final.determinant() === 0) {
		throw new RangeError("Alignment export requires finite, invertible pose matrices");
	}
	const delta = record.initial.matrix.equals(record.committed.matrix) && record.initial.offset.equals(record.committed.offset)
		? new THREE.Matrix4() : record.initial.matrix.clone().invert().multiply(alignmentBaselineMatrix(cloud, record.committed, record.initial.offset));
	if (!delta.elements.every(Number.isFinite)) throw new RangeError("Alignment delta is not finite");
	return {
		pointcloudId: cloud.uuid,
		name: cloud.name ?? "",
		sourceUrl: cloud.pcoGeometry?.url ?? null,
		initial: alignmentExportPose(initial),
		final: alignmentExportPose(final),
		deltaMatrix: delta.toArray(),
	};
}

/** Serialize confirmed cumulative transforms with an explicit cross-system application contract. */
export function exportPointCloudAlignmentResults(pointclouds) {
	return {
		version: 1,
		state: "committed",
		matrixLayout: "column-major",
		vectorConvention: "column-vector",
		application: "receiverInitialMatrix * deltaMatrix",
		coordinateSpace: "pointcloud-local",
		units: "source",
		pointclouds: pointclouds.map(cloud => getPointCloudAlignmentResult(cloud)),
	};
}

// Tracking subscriptions and cloud records have explicit scene and instance ownership.
const alignmentTrackingScenes = new WeakMap();
const alignmentTrackingOwners = new WeakMap();

/** Preserve legacy matrix handling for point clouds never transformed by this feature. */
export function isAlignmentMatrixManaged(cloud) {
	return alignmentManagedMatrices.has(cloud);
}

/** Project extensions are active only while a host-owned tracker is bound to that scene. */
export function isPointCloudAlignmentTrackingEnabled(scene) {
	return Boolean(alignmentTrackingScenes.get(scene)?.size);
}

/** Own loading baselines only after explicit host activation, without default Scene hooks. */
export class PointCloudAlignmentTrackingTool {
	constructor(viewer) {
		this.viewer = viewer;
		this.disposed = false;
		this.members = new Set();
		this.records = new WeakMap();
		this.onAdded = event => this.retain(event.pointcloud);
		this.onRemoved = event => this.release(event.pointcloud);
		this.onSceneChanged = () => this.setScene(viewer.scene);
		viewer.addEventListener("scene_changed", this.onSceneChanged);
		this.setScene(viewer.scene);
	}

	/** Share live records safely if multiple enabled viewers reference the same cloud. */
	retain(cloud) {
		if (this.disposed || this.members.has(cloud)) return;
		let owners = alignmentTrackingOwners.get(cloud);
		if (!owners) {
			owners = new Set();
			alignmentTrackingOwners.set(cloud, owners);
			const cached = this.records.get(cloud);
			if (cached) alignmentExportPoses.set(cloud, cached);
			else recordInitialAlignmentPose(cloud);
		}
		owners.add(this);
		this.members.add(cloud);
		this.records.set(cloud, alignmentExportPoses.get(cloud));
	}

	/** Removed members retain only a weak history for re-addition during this tool's lifetime. */
	release(cloud) {
		if (!this.members.delete(cloud)) return;
		const owners = alignmentTrackingOwners.get(cloud);
		owners?.delete(this);
		if (!owners?.size) {
			alignmentTrackingOwners.delete(cloud);
			alignmentExportPoses.delete(cloud);
		}
	}

	/** Bind additions only in the current scene and capture already-loaded members explicitly. */
	setScene(scene) {
		if (scene === this.scene) return;
		if (this.viewer.pointCloudAlignmentTool && this.viewer.pointCloudAlignmentTool.scene !== scene) this.viewer.disablePointCloudAlignment?.();
		this.unbindScene();
		this.scene = scene;
		if (!scene) return;
		let owners = alignmentTrackingScenes.get(scene);
		if (!owners) alignmentTrackingScenes.set(scene, owners = new Set());
		owners.add(this);
		scene.addEventListener?.("pointcloud_added", this.onAdded);
		scene.addEventListener?.("pointcloud_removed", this.onRemoved);
		for (const cloud of scene.pointclouds) this.retain(cloud);
	}

	/** Release strong references, weak history, and only this tool's event handlers. */
	unbindScene() {
		this.scene?.removeEventListener?.("pointcloud_added", this.onAdded);
		this.scene?.removeEventListener?.("pointcloud_removed", this.onRemoved);
		const owners = alignmentTrackingScenes.get(this.scene);
		owners?.delete(this);
		if (!owners?.size && this.scene) alignmentTrackingScenes.delete(this.scene);
		for (const cloud of this.members) this.release(cloud);
		this.records = new WeakMap();
		this.scene = null;
	}

	/** No tracker subscription or loading-pose record may outlive explicit disposal. */
	dispose() {
		if (this.disposed) return;
		this.viewer.disablePointCloudAlignment?.();
		this.disposed = true;
		this.unbindScene();
		this.viewer.removeEventListener("scene_changed", this.onSceneChanged);
		if (this.viewer.pointCloudAlignmentTrackingTool === this) this.viewer.pointCloudAlignmentTrackingTool = null;
	}
}
