import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {Scene} from "../src/viewer/Scene.js";
import {PointCloudAlignmentTrackingTool, getPointCloudAlignmentResult, isPointCloudAlignmentTrackingEnabled, isAlignmentMatrixManaged, captureAlignmentPose, restoreAlignmentPose, applyAlignmentLocalMatrix, beginAlignmentPose, endAlignmentPose, loadAlignmentPoseMatrix} from "../src/utils/PointCloudAlignmentTransform.js";

vi.mock("../src/Annotation.js", () => ({Annotation: class { constructor() { this.children = []; } }}));

let Viewer;
const hosts = [];

/** Exercise public tracking APIs with real scene membership and no renderer or label DOM. */
function fixture() {
	const host = Object.assign(new THREE.EventDispatcher(), {scene: new Scene()});
	for (const name of ["enablePointCloudAlignmentTracking", "disablePointCloudAlignmentTracking", "getPointCloudAlignmentResult", "exportPointCloudAlignmentResults", "disablePointCloudAlignment"]) host[name] = Viewer.prototype[name];
	hosts.push(host);
	return host;
}

describe("explicit alignment tracking compatibility", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => {hosts.splice(0).forEach(host => host.disablePointCloudAlignmentTracking()); vi.restoreAllMocks();});

	it("leaves ordinary additions, matrices, records and listeners untouched before activation", () => {
		const host = fixture(), cloud = new THREE.Object3D();
		cloud.position.set(7, 8, 9);
		const update = vi.spyOn(cloud, "updateMatrix");
		const baseline = cloud.matrix.clone(), dirty = cloud.matrixWorldNeedsUpdate;
		const subscribe = vi.spyOn(host.scene, "addEventListener");
		host.scene.addPointCloud(cloud, false);
		expect(update).not.toHaveBeenCalled();
		expect(cloud.matrix.equals(baseline)).toBe(true);
		expect(cloud.matrixWorldNeedsUpdate).toBe(dirty);
		expect(subscribe).not.toHaveBeenCalled();
		expect(isPointCloudAlignmentTrackingEnabled(host.scene)).toBe(false);
		expect(() => getPointCloudAlignmentResult(cloud)).toThrow("loading pose");
		expect(() => host.getPointCloudAlignmentResult(cloud)).toThrow("Enable");
		expect(() => host.exportPointCloudAlignmentResults()).toThrow("Enable");
		expect(host.pointCloudLabelTool).toBeUndefined();
		expect(host.pointCloudAlignmentTool).toBeUndefined();
	});

	it("keeps a foreign manual matrix unchanged during legacy offset reconciliation", () => {
		const cloud = new THREE.Object3D();
		cloud.matrixAutoUpdate = false;
		cloud.matrix.makeTranslation(90, 80, 70);
		cloud.userData.sourcePosition = new THREE.Vector3(10, 20, 30);
		Scene.prototype.applyPointCloudTransformOffset.call({}, cloud, new THREE.Vector3(1, 2, 3));
		expect(cloud.position.toArray()).toEqual([11, 22, 33]);
		expect(cloud.matrix.elements.slice(12, 15)).toEqual([90, 80, 70]);
		expect(isAlignmentMatrixManaged(cloud)).toBe(false);
		const original = captureAlignmentPose(cloud);
		applyAlignmentLocalMatrix(cloud, new THREE.Matrix4().makeTranslation(50, 60, 70));
		expect(isAlignmentMatrixManaged(cloud)).toBe(true);
		restoreAlignmentPose(cloud, original);
		expect(isAlignmentMatrixManaged(cloud)).toBe(false);
		Scene.prototype.applyPointCloudTransformOffset.call({}, cloud, new THREE.Vector3(2, 3, 4));
		expect(cloud.matrix.elements.slice(12, 15)).toEqual([90, 80, 70]);
	});

	it("is idempotent, captures existing and new clouds, and releases only owned subscriptions", () => {
		const host = fixture(), cloud = new THREE.Object3D();
		host.scene.addPointCloud(cloud, false);
		const unrelated = vi.fn();
		host.scene.addEventListener("pointcloud_added", unrelated);
		const tracker = host.enablePointCloudAlignmentTracking();
		expect(tracker).toBeInstanceOf(PointCloudAlignmentTrackingTool);
		expect(host.enablePointCloudAlignmentTracking()).toBe(tracker);
		expect(host.getPointCloudAlignmentResult(cloud).deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		const next = new THREE.Object3D();
		next.position.set(3, 4, 5);
		host.scene.addPointCloud(next, false);
		expect(host.exportPointCloudAlignmentResults().pointclouds).toHaveLength(2);
		expect(host.getPointCloudAlignmentResult(next).initial.position).toEqual([3, 4, 5]);
		host.disablePointCloudAlignmentTracking();
		expect(isPointCloudAlignmentTrackingEnabled(host.scene)).toBe(false);
		expect(host.pointCloudAlignmentTrackingTool).toBeNull();
		expect(host.scene.hasEventListener("pointcloud_added", unrelated)).toBe(true);
		expect(host.scene.hasEventListener("pointcloud_added", tracker.onAdded)).toBe(false);
		expect(host.scene.hasEventListener("pointcloud_removed", tracker.onRemoved)).toBe(false);
		expect(host.hasEventListener("scene_changed", tracker.onSceneChanged)).toBe(false);
		expect(() => getPointCloudAlignmentResult(cloud)).toThrow("loading pose");
		cloud.position.x = 20;
		host.enablePointCloudAlignmentTracking();
		expect(host.getPointCloudAlignmentResult(cloud).initial.position[0]).toBe(20);
	});

	it("preserves weak re-addition history, then resets membership and history on scene changes", () => {
		const host = fixture(), tracker = host.enablePointCloudAlignmentTracking();
		const first = host.scene, cloud = new THREE.Object3D();
		first.addPointCloud(cloud, false);
		const initial = host.getPointCloudAlignmentResult(cloud).initial;
		beginAlignmentPose(cloud, captureAlignmentPose(cloud));
		applyAlignmentLocalMatrix(cloud, new THREE.Matrix4().makeTranslation(5, 6, 7));
		endAlignmentPose(cloud, true);
		first.removePointCloud(cloud);
		expect(tracker.members.size).toBe(0);
		first.addPointCloud(cloud, false);
		expect(host.getPointCloudAlignmentResult(cloud).initial).toEqual(initial);
		expect(host.getPointCloudAlignmentResult(cloud).deltaMatrix.slice(12, 15)).toEqual([5, 6, 7]);
		host.scene = new Scene();
		host.dispatchEvent({type: "scene_changed"});
		expect(isPointCloudAlignmentTrackingEnabled(first)).toBe(false);
		expect(isPointCloudAlignmentTrackingEnabled(host.scene)).toBe(true);
		expect(first.hasEventListener("pointcloud_added", tracker.onAdded)).toBe(false);
		expect(host.exportPointCloudAlignmentResults().pointclouds).toEqual([]);
	});

	it("keeps shared-viewer records alive until the final owner releases them", () => {
		const a = fixture(), b = fixture(), cloud = new THREE.Object3D();
		b.scene = a.scene;
		a.enablePointCloudAlignmentTracking();
		b.enablePointCloudAlignmentTracking();
		a.scene.addPointCloud(cloud, false);
		a.disablePointCloudAlignmentTracking();
		expect(isPointCloudAlignmentTrackingEnabled(b.scene)).toBe(true);
		expect(b.getPointCloudAlignmentResult(cloud).deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		b.disablePointCloudAlignmentTracking();
		expect(() => getPointCloudAlignmentResult(cloud)).toThrow("loading pose");
	});

	it("retains a completed imported baseline through removal and re-addition", () => {
		const host = fixture();
		host.enablePointCloudAlignmentTracking();
		const cloud = new THREE.Object3D();
		host.scene.addPointCloud(cloud, false);
		const matrix = new THREE.Matrix4().makeTranslation(7, 8, 9);
		loadAlignmentPoseMatrix(cloud, {alignmentTransform: {version: 1, matrix: matrix.toArray()}}, true);
		host.scene.removePointCloud(cloud);
		host.scene.addPointCloud(cloud, false);
		expect(host.getPointCloudAlignmentResult(cloud).initial.matrix).toEqual(matrix.toArray());
		expect(host.getPointCloudAlignmentResult(cloud).deltaMatrix).toEqual(new THREE.Matrix4().toArray());
	});

	it("settles an old-scene preview before capturing a reused cloud in the new scene", () => {
		const host = fixture(), cloud = new THREE.Object3D();
		host.scene.addPointCloud(cloud, false);
		host.enablePointCloudAlignmentTracking();
		const oldScene = host.scene;
		cloud.position.x = 9;
		host.pointCloudAlignmentTool = {scene: oldScene, dispose() {cloud.position.x = 0;}};
		host.scene = new Scene();
		host.scene.addPointCloud(cloud, false);
		host.dispatchEvent({type: "scene_changed"});
		expect(host.pointCloudAlignmentTool).toBeNull();
		expect(host.getPointCloudAlignmentResult(cloud).initial.position).toEqual([0, 0, 0]);
		host.disablePointCloudAlignmentTracking();
	});

});
