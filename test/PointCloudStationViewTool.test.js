import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import * as THREE from "../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {PointCloudStationViewTool} from "../src/utils/PointCloudStationViewTool.js";
import {getAlignmentPointClouds, getPointCloudLabelAppearance, isPointCloudRuntimeHidden, setPointCloudAlignmentHidden, setPointCloudStationHidden} from "../src/utils/PointCloudLabelAppearance.js";
import {ViewModeController} from "../src/viewer/ViewModeController.js";

let Viewer;
const viewers = [];

/** Use real public methods and label projection without allocating a WebGL renderer. */
function fixture() {
	const element = document.createElement("div");
	element.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600});
	document.body.appendChild(element);
	const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
	camera.position.set(0, 0, 20);
	camera.lookAt(0, 0, 0);
	const clouds = [0, 1, 2].map(index => {
		const cloud = new THREE.Object3D();
		cloud.position.x = index * 2;
		cloud.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
		cloud.material = {color: new THREE.Color(0x123456), activeAttributeName: "rgba"};
		return cloud;
	});
	const makeScene = members => Object.assign(new EventDispatcher(), {pointclouds: members, getActiveCamera: () => camera});
	const viewer = Object.assign(new EventDispatcher(), {scene: makeScene(clouds), renderArea: element, renderer: {domElement: element}});
	for (const method of ["enablePointCloudStationView", "disablePointCloudStationView", "enablePointCloudLabels", "disablePointCloudLabels", "enablePointCloudAlignment", "disablePointCloudAlignment", "fitToScreen", "setTopView4CameraControls"])
		viewer[method] = Viewer.prototype[method];
	viewers.push(viewer);
	return {viewer, clouds, makeScene};
}

describe("opt-in station viewing", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => {
		for (const viewer of viewers.splice(0)) { viewer.disablePointCloudStationView(); viewer.disablePointCloudLabels(); }
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("does not allocate until called, rejects invalid targets and reuses the live instance", () => {
		const {viewer, clouds} = fixture();
		const listen = vi.spyOn(viewer, "addEventListener");
		expect(viewer.pointCloudStationViewTool).toBeUndefined();
		expect(getAlignmentPointClouds(clouds)).toBe(clouds);
		expect(viewer.enablePointCloudStationView(null)).toBeNull();
		expect(viewer.enablePointCloudStationView({})).toBeNull();
		expect(listen).not.toHaveBeenCalled();
		const tool = viewer.enablePointCloudStationView(clouds[0]);
		expect(tool).toBeInstanceOf(PointCloudStationViewTool);
		expect(viewer.enablePointCloudStationView(clouds[0])).toBe(tool);
		expect(tool.getState()).toEqual({running: true, pointcloud: clouds[0]});
		expect(viewer.pointCloudLabelTool).toBeUndefined();
		expect(viewer.viewModeController).toBeUndefined();
		expect(viewer.enablePointCloudAlignment()).toBeNull();
		viewer.disablePointCloudStationView();
		viewer.pointCloudAlignmentTool = {disposed: false};
		expect(viewer.enablePointCloudStationView(clouds[0])).toBeNull();
		expect(() => new PointCloudStationViewTool(viewer, clouds[0])).toThrow("alignment");
	});

	it("isolates labels and edges while retaining blue selection, matrices and base visibility", () => {
		const {viewer, clouds: [a, b, c]} = fixture();
		const labels = viewer.enablePointCloudLabels();
		labels.setActivePointCloud(a);
		labels.setConnections([{source: a, target: b}]);
		c.visible = false;
		const visibleSetter = vi.fn();
		Object.defineProperty(b, "visible", {get: () => true, set: visibleSetter});
		const matrix = a.matrix.clone(), material = a.material.color.clone();
		const tool = viewer.enablePointCloudStationView(a);
		expect(getAlignmentPointClouds(viewer.scene.pointclouds)).toEqual([a]);
		expect(labels.labels.get(a).style.display).not.toBe("none");
		expect(labels.labels.get(b).style.display).toBe("none");
		expect(labels.connectionProjections.has(b)).toBe(false);
		expect(getPointCloudLabelAppearance(a)).toBe(true);
		expect(labels.getActivePointCloud()).toBe(a);
		labels.setVisible(false);
		labels.setConnectionsVisible(false);
		viewer.disablePointCloudStationView();
		expect(tool.disposed).toBe(true);
		expect(viewer.pointCloudStationViewTool).toBeNull();
		expect(getAlignmentPointClouds(viewer.scene.pointclouds)).toBe(viewer.scene.pointclouds);
		expect(c.visible).toBe(false);
		expect(visibleSetter).not.toHaveBeenCalled();
		expect(a.matrix.equals(matrix)).toBe(true);
		expect(a.material.color.equals(material)).toBe(true);
		expect(labels.visible).toBe(false);
		expect(labels.connectionsVisible).toBe(false);
	});

	it("handles dynamic membership and cleans all masks and listeners on scene replacement", () => {
		const {viewer, clouds: [a, b], makeScene} = fixture();
		const scene = viewer.scene;
		const tool = viewer.enablePointCloudStationView(a);
		const late = new THREE.Object3D();
		scene.pointclouds.push(late);
		scene.dispatchEvent({type: "pointcloud_added", pointcloud: late});
		expect(isPointCloudRuntimeHidden(late)).toBe(true);
		scene.pointclouds.splice(scene.pointclouds.indexOf(b), 1);
		scene.dispatchEvent({type: "pointcloud_removed", pointcloud: b});
		expect(isPointCloudRuntimeHidden(b)).toBe(false);
		viewer.scene = makeScene([]);
		viewer.dispatchEvent({type: "scene_changed"});
		expect(tool.disposed).toBe(true);
		expect(isPointCloudRuntimeHidden(late)).toBe(false);
		expect(tool.hiddenClouds.size).toBe(0);
		expect(scene.hasEventListener("pointcloud_added", tool.onReconcile)).toBe(false);
		expect(viewer.hasEventListener("scene_changed", tool.onReconcile)).toBe(false);
		viewer.disablePointCloudStationView();
		tool.dispose();
	});

	it("closes when its target is removed and does not clear another mask owner", () => {
		const {viewer, clouds: [a, b]} = fixture();
		const otherOwner = {};
		setPointCloudStationHidden(b, otherOwner, true);
		setPointCloudAlignmentHidden(b, true);
		const tool = viewer.enablePointCloudStationView(a);
		viewer.scene.pointclouds.shift();
		viewer.scene.dispatchEvent({type: "pointcloud_removed", pointcloud: a});
		expect(tool.disposed).toBe(true);
		expect(isPointCloudRuntimeHidden(b)).toBe(true);
		setPointCloudAlignmentHidden(b, false);
		expect(isPointCloudRuntimeHidden(b)).toBe(true);
		setPointCloudStationHidden(b, otherOwner, false);
		expect(isPointCloudRuntimeHidden(b)).toBe(false);
	});

	it("scopes axis, top and legacy reset bounds to the target only while enabled", () => {
		const {viewer, clouds: [a]} = fixture();
		const bounds = new THREE.Box3(new THREE.Vector3(-2, -3, -4), new THREE.Vector3(2, 3, 4));
		viewer.getBoundingBox = vi.fn(() => bounds);
		viewer.scene.view = {};
		viewer.zoomTo = vi.fn();
		viewer.controls = {stop: vi.fn(), usesRigidTopViewFit: true, camera: {}, fitToTopViewBox: vi.fn(), getPosition: () => new THREE.Vector3(0, 0, 20)};
		viewer.scene.getBoundingBox = viewer.getBoundingBox;
		const controller = new ViewModeController(viewer);
		controller.getBounds();
		expect(viewer.getBoundingBox.mock.calls.at(-1)[0]).toEqual(viewer.scene.pointclouds);
		viewer.enablePointCloudStationView(a);
		controller.getBounds();
		expect(viewer.getBoundingBox.mock.calls.at(-1)[0]).toEqual([a]);
		viewer.fitToScreen();
		expect(viewer.getBoundingBox.mock.calls.at(-1)[0]).toEqual([a]);
		viewer.setTopView4CameraControls(false);
		expect(viewer.getBoundingBox.mock.calls[3][0]).toEqual([a]);
		expect(viewer.controls.fitToTopViewBox).toHaveBeenCalledWith(bounds, false, {});
		viewer.disablePointCloudStationView();
		controller.getBounds();
		expect(viewer.getBoundingBox.mock.calls.at(-1)[0]).toEqual(viewer.scene.pointclouds);
	});
});
