import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Scene} from "../src/viewer/Scene.js";
import {CadVectorTool} from "../src/utils/CadVectorTool.js";
import {mockCadTextCanvas} from "./helpers/cadTextCanvas.js";

// Include annotations in every actual Scene rebase and load-order regression.
beforeEach(() => mockCadTextCanvas());
afterEach(() => vi.restoreAllMocks());

// Exercise the actual shared-origin lifecycle without Annotation DOM dependencies.
vi.mock("../src/Annotation.js", () => ({Annotation: class {constructor() {this.children = [];} traverse() {}}}));

function cloud(z) {
	const result = new THREE.Object3D();
	result.position.set(100, 200, z);
	result.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(10, 20, 30));
	result.pcoGeometry = {tightBoundingBox: result.boundingBox.clone()};
	return result;
}

function setup() {
	const viewer = Object.assign(new THREE.EventDispatcher(), {
		scene: new Scene(), renderer: {getSize: target => target.set(800, 600)},
	});
	const tool = new CadVectorTool(viewer);
	return {viewer, tool};
}

function boundary(tool) {
	return tool.importVectors({uuid: "boundary", vectorType: "boundary", coordinateSpace: "source",
		paths: [{layer: "PLAN_CONTOURS", style: {color: "#ff0000"}, points: [[101, 201, 105], [102, 201, 105]]}],
		texts: [{text: "Visible Boundary", layer: "LEGEND", position: [101, 201, 105], height: 0.2}],
	})[0];
}

function expectAligned(vector, scene) {
	const expected = new THREE.Vector3(101, 201, 105).add(scene.getPointCloudCoordinateOffset());
	expect(vector.points[0].position.toArray()).toEqual(expected.toArray());
	expect(vector.textMeshes[0].position.toArray()).toEqual(expected.toArray());
	expect(vector.getTextData()[0].position).toEqual(expected.toArray());
	// Inspect the GPU line attributes as well as the semantic marker positions.
	const start = vector.styleLines[0].geometry.attributes.instanceStart;
	expect([start.getX(0), start.getY(0), start.getZ(0)]).toEqual(expected.toArray());
}

describe("styled CAD source coordinates in the actual Scene", () => {
	// Re-importing the same UUID replaces raw anchors before applying the current offset once.
	it("replaces source text and releases its old texture without accumulating offsets", () => {
		const {viewer, tool} = setup();
		viewer.scene.addPointCloud(cloud(100));
		const first = boundary(tool);
		const dispose = vi.spyOn(first.textMeshes[0].material.map, "dispose");
		expect(boundary(tool)).toBe(first);
		expect(dispose).toHaveBeenCalledOnce();
		expectAligned(first, viewer.scene);
		expect(first.textMeshes).toHaveLength(1);
		tool.dispose();
	});
	it.each([true, false])("aligns both load orders (boundary first: %s)", boundaryFirst => {
		const {viewer, tool} = setup();
		let vector;
		if (boundaryFirst) vector = boundary(tool);
		viewer.scene.addPointCloud(cloud(100));
		if (!boundaryFirst) vector = boundary(tool);
		expectAligned(vector, viewer.scene);
		tool.dispose();
	});

	// Both height directions matter: stale offsets can place a boundary above or below its cloud.
	it.each([500, -300])("follows a new anchor at Z=%s after every cloud is hidden", z => {
		const {viewer, tool} = setup();
		const first = cloud(100), second = cloud(z);
		viewer.scene.addPointCloud(first);
		viewer.scene.addPointCloud(second);
		const vector = boundary(tool);
		first.visible = second.visible = false;
		viewer.scene.reconcilePointCloudCoordinateOffset();
		second.visible = true;
		viewer.scene.reconcilePointCloudCoordinateOffset();
		tool.update();
		expectAligned(vector, viewer.scene);
		tool.update();
		expectAligned(vector, viewer.scene);
		tool.dispose();
	});

	it("keeps an ordinary multi-to-single rebase idempotent", () => {
		const {viewer, tool} = setup();
		const first = cloud(100), second = cloud(500);
		viewer.scene.addPointCloud(first);
		viewer.scene.addPointCloud(second);
		const vector = boundary(tool);
		first.visible = false;
		viewer.scene.reconcilePointCloudCoordinateOffset();
		expectAligned(vector, viewer.scene);
		tool.update();
		expectAligned(vector, viewer.scene);
		tool.dispose();
	});

	it("handles a rebase before the next frame after a silent anchor change", () => {
		const {viewer, tool} = setup();
		const first = cloud(100), second = cloud(500);
		viewer.scene.addPointCloud(first);
		viewer.scene.addPointCloud(second);
		const vector = boundary(tool);
		first.visible = second.visible = false;
		viewer.scene.reconcilePointCloudCoordinateOffset();
		second.visible = true;
		viewer.scene.reconcilePointCloudCoordinateOffset();
		viewer.scene.rebasePointCloudCoordinateOffset(new THREE.Vector3(-150, -250, -600));
		tool.update();
		expectAligned(vector, viewer.scene);
		tool.dispose();
	});
});
