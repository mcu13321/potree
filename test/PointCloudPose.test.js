import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";

let Viewer;
const viewers = [];

/** Use real tracking and public Viewer methods without constructing a renderer or DOM overlay. */
function fixture(tracking = true) {
	const scene = Object.assign(new EventDispatcher(), {pointclouds: [], scenePointCloud: new THREE.Group()});
	scene.add = cloud => {scene.pointclouds.push(cloud); scene.scenePointCloud.add(cloud); scene.dispatchEvent({type: "pointcloud_added", pointcloud: cloud});};
	const viewer = Object.assign(new EventDispatcher(), {scene});
	for (const method of ["setPointCloudPose", "enablePointCloudAlignmentTracking", "disablePointCloudAlignmentTracking", "disablePointCloudAlignment", "getPointCloudAlignmentResult", "exportPointCloudAlignmentResults"])
		viewer[method] = Viewer.prototype[method];
	if (tracking) viewer.enablePointCloudAlignmentTracking();
	viewers.push(viewer);
	return {viewer, scene};
}

describe("explicit point-cloud poses", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => {
		for (const viewer of viewers.splice(0)) {viewer.pointCloudAlignmentTool = null; viewer.disablePointCloudAlignmentTracking();}
		vi.restoreAllMocks();
	});

	it("does not initialize tracking or emit events for a detached cloud until explicitly retained", () => {
		const {viewer, scene} = fixture(false);
		const cloud = new THREE.Object3D();
		const events = vi.fn(), listen = vi.spyOn(viewer, "addEventListener");
		viewer.addEventListener("pointcloud_pose_changed", events);
		listen.mockClear();
		const matrix = new THREE.Matrix4().makeRotationZ(0.4).setPosition(7, -8, 9);
		expect(viewer.setPointCloudPose(cloud, matrix)).toBe(cloud);
		expect(viewer.pointCloudAlignmentTrackingTool).toBeUndefined();
		expect(viewer.pointCloudLabelTool).toBeUndefined();
		expect(listen).not.toHaveBeenCalled();
		expect(events).not.toHaveBeenCalled();
		viewer.enablePointCloudAlignmentTracking();
		scene.add(cloud);
		const result = viewer.getPointCloudAlignmentResult(cloud);
		expect(result.initial.matrix).toEqual(cloud.matrix.toArray());
		expect(result.final.matrix).toEqual(result.initial.matrix);
		expect(result.deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		matrix.identity();
		expect(cloud.position.toArray()).toEqual([7, -8, 9]);
	});

	it("updates committed poses while preserving initial baselines, other clouds and event snapshots", () => {
		const {viewer, scene} = fixture();
		const cloud = new THREE.Object3D(), other = new THREE.Object3D();
		viewer.setPointCloudPose(cloud, new THREE.Matrix4().makeTranslation(10, 20, 30));
		scene.add(cloud); scene.add(other);
		const initial = viewer.getPointCloudAlignmentResult(cloud).initial.matrix;
		const events = [];
		viewer.addEventListener("pointcloud_pose_changed", event => events.push(event));
		cloud.userData.sourcePosition = cloud.position.clone();
		for (const x of [40, 50]) {
			viewer.setPointCloudPose(cloud, new THREE.Matrix4().makeRotationZ(0.6).setPosition(x, 4, 2));
			const result = viewer.getPointCloudAlignmentResult(cloud);
			expect(result.initial.matrix).toEqual(initial);
			expect(result.final.position).toEqual([x, 4, 2]);
			expect(cloud.userData.sourcePosition.toArray()).toEqual([x, 4, 2]);
		}
		expect(other.position.toArray()).toEqual([0, 0, 0]);
		expect(events).toHaveLength(2);
		events[0].matrix.identity();
		expect(cloud.position.x).toBe(50);
		expect(viewer.exportPointCloudAlignmentResults().pointclouds[0].final.position).toEqual([50, 4, 2]);
	});

	it("rejects foreign clouds, untracked members and active alignment without modifying state", () => {
		const first = fixture(), second = fixture(false);
		const cloud = new THREE.Object3D();
		second.scene.add(cloud);
		expect(() => first.viewer.setPointCloudPose(cloud, new THREE.Matrix4())).toThrow("another scene");
		expect(() => second.viewer.setPointCloudPose(cloud, new THREE.Matrix4())).toThrow("tracking");
		const own = new THREE.Object3D(); first.scene.add(own);
		first.viewer.pointCloudAlignmentTool = {disposed: false};
		expect(() => first.viewer.setPointCloudPose(own, new THREE.Matrix4().makeTranslation(1, 2, 3))).toThrow("End alignment");
		expect(own.position.toArray()).toEqual([0, 0, 0]);
	});

	// Validation failures must leave both the displayed pose and the confirmed record untouched.
	it("validates affine matrices before mutating point clouds or recording a commit", () => {
		const {viewer, scene} = fixture();
		const cloud = new THREE.Object3D(); scene.add(cloud);
		const before = viewer.getPointCloudAlignmentResult(cloud);
		for (const matrix of [new THREE.Matrix4().makeScale(0, 1, 1), {elements: [1]}, {elements: Array(16).fill(NaN)},
			new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1)]) {
			expect(() => viewer.setPointCloudPose(cloud, matrix)).toThrow();
			expect(viewer.getPointCloudAlignmentResult(cloud)).toEqual(before);
			expect(cloud.matrix.toArray()).toEqual(new THREE.Matrix4().toArray());
		}
		const affine = new THREE.Matrix4(); affine.elements[4] = 0.3;
		viewer.setPointCloudPose(cloud, affine);
		expect(cloud.matrixAutoUpdate).toBe(false);
		expect(viewer.getPointCloudAlignmentResult(cloud).final.matrix).toEqual(affine.toArray());
	});
});
