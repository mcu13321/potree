import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it} from "vitest";
import heapSource from "../libs/other/BinaryHeap.js?raw";
import {runInNewContext} from "node:vm";
import {PointCloudOctree} from "../src/PointCloudOctree.js";
import visibilitySource from "../src/Potree_update_visibility.js?raw";
import {Scene} from "../src/viewer/Scene.js";
import {recordInitialAlignmentPose, getPointCloudAlignmentResult, exportPointCloudAlignmentResults, captureAlignmentPose, beginAlignmentPose, endAlignmentPose, restoreAlignmentPose, applyAlignmentLocalMatrix, getAlignmentPoseData, loadAlignmentPoseMatrix, getAlignmentWorldCenter, getAlignmentViewNormal, alignmentPlanePoint, alignmentRotationMatrix} from "../src/utils/PointCloudAlignmentTransform.js";

/** Compare full affine matrices with survey-scale translation precision. */
function expectMatrix(actual, expected) {
	actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index], 7));
}

describe("alignment matrix transactions", () => {
	it("saves entry state during preview and preserves committed transforms across origin rebases", () => {
		const cloud = new THREE.Object3D();
		cloud.position.set(1000010, -2000020, 30);
		cloud.rotation.set(0.1, 0.2, 0.3);
		cloud.scale.set(2, 3, 4);
		cloud.userData = {sourcePosition: new THREE.Vector3(10, -20, 30), appliedTransformOffset: new THREE.Vector3(1000000, -2000000, 0)};
		const original = captureAlignmentPose(cloud);
		beginAlignmentPose(cloud, original);
		const preview = new THREE.Matrix4().makeTranslation(7, 9, 0).multiply(original.matrix);
		applyAlignmentLocalMatrix(cloud, preview);
		expect(cloud.userData.sourcePosition.toArray()).toEqual([17, -11, 30]);
		expect(getAlignmentPoseData(cloud).position).toEqual(original.position.toArray());
		const nextOffset = new THREE.Vector3(1001000, -2000500, 0);
		Scene.prototype.applyPointCloudTransformOffset.call({}, cloud, nextOffset);
		expect(cloud.position.toArray()).toEqual([1001017, -2000511, 30]);
		restoreAlignmentPose(cloud, original);
		expect(cloud.position.toArray()).toEqual([1001010, -2000520, 30]);
		expect(cloud.userData.sourcePosition.toArray()).toEqual([10, -20, 30]);
		applyAlignmentLocalMatrix(cloud, preview);
		endAlignmentPose(cloud, true);
		const saved = getAlignmentPoseData(cloud);
		expect(saved.position).toEqual([1000017, -2000011, 30]);
		const loaded = new THREE.Object3D();
		loadAlignmentPoseMatrix(loaded, saved, true);
		expectMatrix(loaded.matrix, preview);
	});

	it("keeps exact shear under rotated nonuniform parents and restores all original local state", () => {
		const parent = new THREE.Object3D(), cloud = new THREE.Object3D();
		parent.position.set(1000000, 2000000, 50);
		parent.rotation.set(0.2, 0.3, 0.4);
		parent.scale.set(2, 3, 4);
		cloud.position.set(5, 6, 7);
		cloud.boundingBox = new THREE.Box3(new THREE.Vector3(-3, -2, -1), new THREE.Vector3(3, 2, 1));
		parent.add(cloud);
		cloud.updateWorldMatrix(true, false);
		const original = captureAlignmentPose(cloud), world = cloud.matrixWorld.clone();
		const pivot = getAlignmentWorldCenter(cloud), normal = new THREE.Vector3(0, 0, 1);
		const rotated = alignmentRotationMatrix(pivot, normal, Math.PI / 3).multiply(world);
		applyAlignmentLocalMatrix(cloud, parent.matrixWorld.clone().invert().multiply(rotated));
		expectMatrix(cloud.matrixWorld, rotated);
		expect(cloud.matrixAutoUpdate).toBe(false);
		expect(getAlignmentWorldCenter(cloud).distanceTo(pivot)).toBeLessThan(1e-8);
		endAlignmentPose(cloud, true);
		const loaded = new THREE.Object3D();
		loadAlignmentPoseMatrix(loaded, getAlignmentPoseData(cloud), true);
		expectMatrix(loaded.matrix, cloud.matrix);
		restoreAlignmentPose(cloud, original);
		expectMatrix(cloud.matrix, original.matrix);
		expect(cloud.matrixAutoUpdate).toBe(true);
		expect(cloud.scale.toArray()).toEqual([1, 1, 1]);
	});

	it.each(["top", "front", "back", "left", "right"])("projects stable plane motion and screen-positive rotations in %s", mode => {
		const center = new THREE.Vector3(1000000, -2000000, 3000000);
		const normal = getAlignmentViewNormal(mode);
		for (const camera of [new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000), new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 1000)]) {
			camera.position.copy(center).addScaledVector(normal, 50);
			camera.up.set(...(mode === "top" ? [0, 1, 0] : [0, 0, 1]));
			camera.lookAt(center);
			camera.updateProjectionMatrix();
			const rect = {left: 75, top: 40, width: 800, height: 600};
			const origin = alignmentPlanePoint(camera, rect, 475, 340, center, normal);
			const right = alignmentPlanePoint(camera, rect, 535, 340, center, normal);
			const up = alignmentPlanePoint(camera, rect, 475, 280, center, normal);
			expect(origin.length()).toBeLessThan(1e-7);
			expect(Math.abs(right.dot(normal))).toBeLessThan(1e-8);
			expect(right.length()).toBeGreaterThan(1);
			const angle = Math.atan2(normal.dot(new THREE.Vector3().crossVectors(right.clone().normalize(), up.clone().normalize())), right.clone().normalize().dot(up.clone().normalize()));
			expect(angle).toBeCloseTo(Math.PI / 2, 7);
		}
	});

	it("ignores invalid optional project matrices and handles empty or parallel projections", () => {
		const cloud = new THREE.Object3D();
		loadAlignmentPoseMatrix(cloud, {matrix: [NaN]});
		expect(cloud.matrixAutoUpdate).toBe(true);
		expect(getAlignmentWorldCenter(cloud)).toBeNull();
		expect(getAlignmentViewNormal("3d")).toBeNull();
		const camera = new THREE.PerspectiveCamera();
		expect(alignmentPlanePoint(camera, {width: 0, height: 1}, 0, 0, new THREE.Vector3(), new THREE.Vector3(0, 0, 1))).toBeNull();
		expect(alignmentPlanePoint(camera, {left: 0, top: 0, width: 2, height: 2}, 1, 1, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0))).toBeNull();
	});
});

describe("alignment with cached octree node transforms", () => {

	/** Exercise real Potree node construction and visibility caching without a WebGL context. */
	function fixture() {
		const BinaryHeap = runInNewContext(heapSource + "; BinaryHeap");
		const runtime = {pointBudget: 1000, maxNodesLoading: 0, lru: {touch() {}}};
		// The shipped bundle binds exports locally, so provide the same closure to the source.
		const updateVisibility = runInNewContext(visibilitySource.replace(/^import .+$/gm, "").replace(/export function /g, "function ") + "; updateVisibility", {THREE, BinaryHeap, Potree: runtime, exports: runtime});
		const parent = new THREE.Object3D();
		parent.position.set(1000000, -2000000, 0);
		const cloud = new THREE.Object3D();
		Object.setPrototypeOf(cloud, PointCloudOctree.prototype);
		cloud.material = new THREE.PointsMaterial();
		cloud.material.clipBoxes = [];
		cloud.boundingBoxNodes = [];
		cloud.position.set(-600, 0, 0);
		parent.add(cloud);
		cloud.updateWorldMatrix(true, false);
		const makeNode = (name, min, ancestor) => {
			const boundingBox = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(600, 600, 10));
			return cloud.toTreeNode({name, boundingBox, boundingSphere: boundingBox.getBoundingSphere(new THREE.Sphere()), level: name.length - 1, numPoints: 1, geometry: new THREE.BufferGeometry(), children: [], oneTimeDisposeHandlers: []}, ancestor);
		};
		const root = makeNode("r", [0, 0, 0]);
		const child = makeNode("r4", [300, 300, 0], root);
		const leaf = makeNode("r44", [450, 450, 0], child);
		const nodes = [root, child, leaf];
		const camera = new THREE.OrthographicCamera(-2000, 2000, 2000, -2000, 0.1, 5000);
		camera.position.set(1000000, -2000000, 2000);
		camera.lookAt(1000000, -2000000, 0);
		camera.updateMatrixWorld(true);
		const refresh = () => updateVisibility([cloud], camera, {domElement: {clientWidth: 800, clientHeight: 600}});
		const expectNodes = () => {
			expect(cloud.visibleNodes).toHaveLength(3);
			for (const node of nodes) expectMatrix(node.sceneNode.matrixWorld, cloud.matrixWorld.clone().multiply(node.sceneNode.matrix));
		};
		refresh();
		expectNodes();
		return {cloud, runtime, nodes, refresh, expectNodes};
	}

	it("preserves cached deep node coordinates when selecting a target restores an unchanged pose", () => {
		const {cloud, runtime, refresh, expectNodes} = fixture();
		const original = captureAlignmentPose(cloud);
		restoreAlignmentPose(cloud, original);
		expectNodes();
		refresh();
		expect(runtime._pointcloudTransformVersion.get(cloud).number).toBe(0);
		expectNodes();
	});

	it.each(["translate", "rotate"])("keeps cached nodes rigid after repeated final %s and cancellation", operation => {
		const {cloud, runtime, refresh, expectNodes} = fixture();
		const original = captureAlignmentPose(cloud);
		const delta = operation === "translate" ? new THREE.Matrix4().makeTranslation(600, -600, 0) : new THREE.Matrix4().makeRotationZ(Math.PI / 3);
		const moved = delta.multiply(original.matrix);
		applyAlignmentLocalMatrix(cloud, moved);
		refresh();
		expectNodes();
		const version = runtime._pointcloudTransformVersion.get(cloud).number;
		// Pointer-up reapplies the final pose; the visibility cache legitimately keeps its version.
		applyAlignmentLocalMatrix(cloud, moved);
		expectNodes();
		refresh();
		expect(runtime._pointcloudTransformVersion.get(cloud).number).toBe(version);
		expectNodes();
		restoreAlignmentPose(cloud, original);
		refresh();
		expectMatrix(cloud.matrix, original.matrix);
		expectNodes();
		for (const node of cloud.visibleNodes) expect(node._transformVersion).toBe(runtime._pointcloudTransformVersion.get(cloud).number);
	});
});

describe("portable confirmed alignment results", () => {
	/** Create nontrivial loading poses before any alignment preview can mutate them. */
	function cloud(index = 0) {
		const value = new THREE.Object3D();
		value.name = `cloud-${index}`;
		value.pcoGeometry = {url: "same-source/metadata.json"};
		value.position.set(100 + index * 50, -200 + index * 20, 30);
		value.rotation.set(0.1, 0.2, 0.3 + index * 0.1);
		value.scale.set(2, 3, 4);
		recordInitialAlignmentPose(value);
		return value;
	}

	/** Use the same transaction primitives as the public alignment tool. */
	function commit(value, worldDelta) {
		beginAlignmentPose(value, captureAlignmentPose(value));
		applyAlignmentLocalMatrix(value, worldDelta.clone().multiply(value.matrix));
		endAlignmentPose(value, true);
	}

	it("reconstructs identical relative poses under a different system's shared origin and rotation", () => {
		const clouds = [cloud(0), cloud(1), cloud(2)];
		const initial = clouds.map(value => value.matrix.clone());
		commit(clouds[0], new THREE.Matrix4().makeTranslation(15, -8, 3));
		commit(clouds[0], new THREE.Matrix4().makeRotationZ(0.6));
		commit(clouds[1], new THREE.Matrix4().makeRotationX(-0.3));
		const result = JSON.parse(JSON.stringify(exportPointCloudAlignmentResults(clouds)));
		expect(result).toMatchObject({version: 1, state: "committed", matrixLayout: "column-major", application: "receiverInitialMatrix * deltaMatrix"});
		const global = new THREE.Matrix4().makeTranslation(1000000, -2000000, 3000000).multiply(new THREE.Matrix4().makeRotationY(0.8));
		const received = result.pointclouds.map((record, index) => {
			const delta = new THREE.Matrix4().fromArray(record.deltaMatrix);
			const final = new THREE.Matrix4().fromArray(record.final.matrix);
			expectMatrix(initial[index].clone().multiply(delta), final);
			const reconstructed = global.clone().multiply(initial[index]).multiply(delta);
			expectMatrix(reconstructed, global.clone().multiply(final));
			return reconstructed;
		});
		for (let i = 1; i < clouds.length; i++) {
			const expectedRelative = clouds[0].matrix.clone().invert().multiply(clouds[i].matrix);
			expectMatrix(received[0].clone().invert().multiply(received[i]), expectedRelative);
		}
		expect(result.pointclouds[2].deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		expect(new Set(result.pointclouds.map(record => record.pointcloudId)).size).toBe(3);
	});

	it("excludes previews and preserves the loading baseline over repeated commits and cancellation", () => {
		const value = cloud();
		const loading = getPointCloudAlignmentResult(value);
		commit(value, new THREE.Matrix4().makeTranslation(5, 6, 7));
		const confirmed = getPointCloudAlignmentResult(value);
		const entry = captureAlignmentPose(value);
		beginAlignmentPose(value, entry);
		applyAlignmentLocalMatrix(value, new THREE.Matrix4().makeRotationZ(1.2).multiply(value.matrix));
		expect(getPointCloudAlignmentResult(value)).toEqual(confirmed);
		restoreAlignmentPose(value, entry);
		endAlignmentPose(value, false);
		expect(getPointCloudAlignmentResult(value)).toEqual(confirmed);
		commit(value, new THREE.Matrix4().makeTranslation(10, 0, 0));
		expect(getPointCloudAlignmentResult(value).initial).toEqual(loading.initial);
		expectMatrix(new THREE.Matrix4().fromArray(loading.initial.matrix).multiply(new THREE.Matrix4().fromArray(getPointCloudAlignmentResult(value).deltaMatrix)), value.matrix);
	});

	it("keeps the delta invariant through shared-origin rebases and transformed parents", () => {
		const value = cloud();
		value.userData.sourcePosition = value.position.clone();
		value.userData.appliedTransformOffset = new THREE.Vector3();
		commit(value, new THREE.Matrix4().makeTranslation(5, 6, 7));
		const expected = getPointCloudAlignmentResult(value).deltaMatrix;
		Scene.prototype.applyPointCloudTransformOffset.call({}, value, new THREE.Vector3(1000000, -2000000, 30));
		const parent = new THREE.Object3D();
		parent.position.set(-3000000, 4000000, 50);
		parent.rotation.set(0.2, 0.3, 0.4);
		parent.scale.set(2, 4, 3);
		parent.add(value);
		const rebased = getPointCloudAlignmentResult(value);
		expectMatrix(new THREE.Matrix4().fromArray(rebased.deltaMatrix), new THREE.Matrix4().fromArray(expected));
		expectMatrix(new THREE.Matrix4().fromArray(rebased.initial.matrix).multiply(new THREE.Matrix4().fromArray(rebased.deltaMatrix)), new THREE.Matrix4().fromArray(rebased.final.matrix));
	});

	it("returns defensive JSON snapshots and rejects missing or singular baselines", () => {
		const value = cloud();
		const first = getPointCloudAlignmentResult(value);
		first.initial.matrix[12] = NaN;
		first.final.position[0] = Infinity;
		first.deltaMatrix.fill(0);
		expect(getPointCloudAlignmentResult(value).deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		expect(() => getPointCloudAlignmentResult(new THREE.Object3D())).toThrow("loading pose");
		const singular = new THREE.Object3D();
		singular.scale.x = 0;
		recordInitialAlignmentPose(singular);
		expect(() => getPointCloudAlignmentResult(singular)).toThrow(RangeError);
		expect(exportPointCloudAlignmentResults([]).pointclouds).toEqual([]);
	});
});

it("uses an imported exact matrix as the completed loading baseline", () => {
	const cloud = new THREE.Object3D();
	recordInitialAlignmentPose(cloud);
	const matrix = new THREE.Matrix4().makeRotationZ(0.4).setPosition(5, 6, 7);
	loadAlignmentPoseMatrix(cloud, {alignmentTransform: {version: 1, matrix: matrix.toArray()}}, true);
	const result = getPointCloudAlignmentResult(cloud);
	expect(result.initial.matrix).toEqual(matrix.toArray());
	expect(result.deltaMatrix).toEqual(new THREE.Matrix4().toArray());
});
