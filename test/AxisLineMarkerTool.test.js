import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {AxisLineMarkerTool} from "../src/utils/AxisLineMarkerTool.js";

class MockScene extends EventDispatcher {
	constructor() {
		super();
		this.measurements = [];
		this.pointclouds = [];
		this.camera = new THREE.PerspectiveCamera();
	}

	addMeasurement(measurement) {
		this.measurements.push(measurement);
		this.dispatchEvent({type: "measurement_added", measurement});
	}

	removeMeasurement(measurement) {
		this.measurements = this.measurements.filter((item) => item !== measurement);
		this.dispatchEvent({type: "measurement_removed", measurement});
	}

	addMeasurement2platform(measurement) {
		this.dispatchEvent({type: "measurement_added_to_platform", measurement});
	}

	getActiveCamera() {
		return this.camera;
	}
}

class MockViewer extends EventDispatcher {
	constructor() {
		super();
		this.scene = new MockScene();
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: (target) => target.set(800, 600),
			render: vi.fn(),
		};
		this.controls = {
			usesRigidTopViewFit: true,
			minPolarAngle: 0.05,
			maxPolarAngle: Math.PI - 0.05,
			polarRotateSpeed: 0.3,
		};
		this.cameraControls = this.controls;
		this.setTopView4CameraControls = vi.fn();
		this.hoveredPoint = null;
		this.inputHandler = {
			getEventLocalPosition: (event) => new THREE.Vector2(event.clientX, event.clientY),
			isTapGesture: (_pointerType, start, end) => start.distanceTo(end) <= 2,
			refreshHoveredPoint: vi.fn(() => this.hoveredPoint),
		};
	}
}

function createPointcloud() {
	const pointcloud = {
		position: new THREE.Vector3(),
		getPointsInProfile: vi.fn((profile, _maxDepth, callbacks) => {
			const originX = (profile.points[0].x + profile.points[1].x) / 2;
			const originY = profile.points[0].y;
			const request = {cancel: vi.fn(() => callbacks.onCancel())};
			setTimeout(() => {
				callbacks.onProgress({
					points: {
						segments: [{
							points: {
								data: {
									position: new Float32Array([
										originX + 0.01, originY, 5,
										originX + 0.015, originY, 2,
										originX + 0.04, originY, 1,
									]),
								},
							},
						}],
					},
				});
				callbacks.onFinish();
			}, 0);
			return request;
		}),
	};
	return pointcloud;
}

function createSparsePointcloud() {
	const pointcloud = {
		position: new THREE.Vector3(),
		getPointsInProfile: vi.fn((profile, _maxDepth, callbacks) => {
			const originX = (profile.points[0].x + profile.points[1].x) / 2;
			const originY = profile.points[0].y;
			const request = {cancel: vi.fn(() => callbacks.onCancel())};
			setTimeout(() => {
				callbacks.onProgress({
					points: {
						segments: [{
							points: {
								data: {
									position: new Float32Array([originX + 0.8, originY, 2]),
								},
							},
						}],
					},
				});
				callbacks.onFinish();
			}, 0);
			return request;
		}),
	};
	return pointcloud;
}

function dispatchMouse(target, type, {button = 0, clientX, clientY}) {
	target.dispatchEvent(new MouseEvent(type, {button, clientX, clientY, bubbles: true}));
}

describe("AxisLineMarkerTool", () => {
	let tool;

	afterEach(() => {
		tool?.dispose();
		tool = null;
		document.body.innerHTML = "";
	});

	it("adds points only for taps and pauses only the preview on right click", async () => {
		const viewer = new MockViewer();
		const pointcloud = createPointcloud();
		tool = new AxisLineMarkerTool(viewer);
		const marker = tool.startInsertion();

		expect(viewer.setTopView4CameraControls).toHaveBeenCalledWith(false);
		expect(viewer.controls.minPolarAngle).toBe(Math.PI);
		expect(viewer.controls.maxPolarAngle).toBe(Math.PI);
		expect(viewer.controls.polarRotateSpeed).toBe(0);

		viewer.hoveredPoint = {location: new THREE.Vector3(1, 2, 10), pointcloud};
		tool.onMouseDown({button: 0, clientX: 10, clientY: 10});
		tool.onMouseUp({button: 0, clientX: 20, clientY: 10});
		expect(marker.points).toHaveLength(0);

		tool.onMouseDown({button: 0, clientX: 10, clientY: 10});
		tool.onMouseUp({button: 0, clientX: 11, clientY: 10});
		expect(marker.points).toHaveLength(1);
		expect(pointcloud.getPointsInProfile).not.toHaveBeenCalled();

		viewer.hoveredPoint = {location: new THREE.Vector3(3, 4, 10), pointcloud};
		tool.onMouseMove({clientX: 30, clientY: 40});
		await vi.waitFor(() => expect(marker.previewPoint?.toArray()).toEqual([3, 4, 10]));
		expect(marker.previewPoint.toArray()).toEqual([3, 4, 10]);
		expect(marker.line.visible).toBe(true);

		tool.onMouseDown({button: 2, clientX: 30, clientY: 40});
		tool.onMouseUp({button: 2, clientX: 30, clientY: 40});
		expect(tool.paused).toBe(true);
		expect(marker.previewPoint).toBeNull();
		expect(tool.activeMarker).toBe(marker);

		tool.onMouseDown({button: 0, clientX: 30, clientY: 40});
		tool.onMouseUp({button: 0, clientX: 30, clientY: 40});
		expect(tool.paused).toBe(false);
		expect(marker.points).toHaveLength(2);
		expect(marker.previewPoint.toArray()).toEqual([3, 4, 10]);

		viewer.hoveredPoint = {location: new THREE.Vector3(5, 6, 10), pointcloud};
		tool.onMouseMove({clientX: 50, clientY: 60});
		await vi.waitFor(() => expect(marker.previewPoint?.toArray()).toEqual([5, 6, 10]));
		viewer.hoveredPoint = null;
		tool.onMouseDown({button: 0, clientX: 50, clientY: 60});
		tool.onMouseUp({button: 0, clientX: 50, clientY: 60});
		expect(marker.points).toHaveLength(3);
		expect(marker.points[2].position.toArray()).toEqual([5, 6, 10]);
		expect(marker.previewPoint.toArray()).toEqual([5, 6, 10]);
	});

	it("resolves B points only on confirmation and restores the camera lock", async () => {
		const viewer = new MockViewer();
		const pointcloud = createPointcloud();
		tool = new AxisLineMarkerTool(viewer);
		const marker = tool.startInsertion();
		marker.addPoint(new THREE.Vector3(1, 2, 10), pointcloud);
		marker.addPoint(new THREE.Vector3(3, 4, 10), pointcloud);
		const lifecycle = [];
		const completed = vi.fn(() => lifecycle.push("completed"));
		const persisted = vi.fn(() => lifecycle.push("persisted"));
		tool.addEventListener("axis_line_completed", completed);
		viewer.scene.addEventListener("measurement_added_to_platform", persisted);
		marker.addEventListener("finalizing_changed", () => {
			if (!marker.isFinalizing) {
				lifecycle.push("finalized");
			}
		});

		expect(pointcloud.getPointsInProfile).not.toHaveBeenCalled();
		expect(await tool.finishInsertion()).toBe(true);

		expect(pointcloud.getPointsInProfile).toHaveBeenCalledTimes(2);
		expect(marker.points.map((point) => point.position.z)).toEqual([2, 2]);
		expect(marker.finished).toBe(true);
		expect(tool.activeMarker).toBeNull();
		expect(completed).toHaveBeenCalledTimes(1);
		expect(persisted).toHaveBeenCalledTimes(1);
		expect(persisted.mock.calls[0][0].measurement).toBe(marker);
		// Dataset persistence must happen before UI deactivation can trigger mirror synchronization.
		expect(lifecycle).toEqual(["persisted", "finalized", "completed"]);
		expect(viewer.controls.minPolarAngle).toBe(0.05);
		expect(viewer.controls.maxPolarAngle).toBe(Math.PI - 0.05);
		expect(viewer.controls.polarRotateSpeed).toBe(0.3);
	});

	it("expands through all fixed tolerance stages for sparse point clouds", async () => {
		const viewer = new MockViewer();
		const pointcloud = createSparsePointcloud();
		tool = new AxisLineMarkerTool(viewer);
		const marker = tool.startInsertion();
		marker.addPoint(new THREE.Vector3(1, 2, 10), pointcloud);
		marker.addPoint(new THREE.Vector3(3, 4, 10), pointcloud);

		expect(await tool.finishInsertion()).toBe(true);

		// Each point must miss 0.2 m and 0.5 m before matching the fixed 1.0 m stage.
		expect(pointcloud.getPointsInProfile).toHaveBeenCalledTimes(6);
		expect(marker.points.map((point) => point.position.z)).toEqual([2, 2]);
		expect(marker.points[0].position.x).toBeCloseTo(1.8);
		expect(marker.points[1].position.x).toBeCloseTo(3.8);
	});

	it("commits three DOM clicks by reusing the matching preview hit", async () => {
		const viewer = new MockViewer();
		const pointcloud = createPointcloud();
		tool = new AxisLineMarkerTool(viewer);
		const marker = tool.startInsertion();
		const canvas = viewer.renderer.domElement;

		viewer.hoveredPoint = {location: new THREE.Vector3(1, 2, 10), pointcloud};
		dispatchMouse(canvas, "mousedown", {clientX: 10, clientY: 20});
		dispatchMouse(canvas, "mouseup", {clientX: 10, clientY: 20});

		viewer.hoveredPoint = {location: new THREE.Vector3(3, 4, 10), pointcloud};
		dispatchMouse(canvas, "mousemove", {clientX: 30, clientY: 40});
		await vi.waitFor(() => expect(marker.previewPoint?.toArray()).toEqual([3, 4, 10]));
		viewer.hoveredPoint = null;
		dispatchMouse(canvas, "mousedown", {clientX: 30, clientY: 40});
		dispatchMouse(canvas, "mouseup", {clientX: 30, clientY: 40});

		viewer.hoveredPoint = {location: new THREE.Vector3(5, 6, 10), pointcloud};
		dispatchMouse(canvas, "mousemove", {clientX: 50, clientY: 60});
		await vi.waitFor(() => expect(marker.previewPoint?.toArray()).toEqual([5, 6, 10]));
		viewer.hoveredPoint = null;
		dispatchMouse(canvas, "mousedown", {clientX: 50, clientY: 60});
		dispatchMouse(canvas, "mouseup", {clientX: 50, clientY: 60});

		expect(marker.points.map((point) => point.position.toArray())).toEqual([
			[1, 2, 10],
			[3, 4, 10],
			[5, 6, 10],
		]);
		expect(tool.activeMarker).toBe(marker);
	});

	it("imports final B coordinates and supports visibility and deletion", () => {
		const viewer = new MockViewer();
		tool = new AxisLineMarkerTool(viewer);
		const [marker] = tool.importAxisLines({
			uuid: "axis-1",
			visible: false,
			points: [[1, 2, 3], [4, 5, 6]],
		});

		expect(marker.finished).toBe(true);
		expect(marker.points.map((point) => point.position.toArray())).toEqual([
			[1, 2, 3],
			[4, 5, 6],
		]);
		expect(tool.getAxisLines()).toEqual([marker]);
		expect(tool.setVisible("axis-1", true)).toBe(true);
		expect(marker.visible).toBe(true);
		expect(tool.remove("axis-1")).toBe(true);
		expect(tool.getAxisLines()).toEqual([]);
	});
});
