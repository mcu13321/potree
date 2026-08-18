import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {AxisLineMarker} from "../src/utils/AxisLineMarker.js";
import {CadVectorTool} from "../src/utils/CadVectorTool.js";

class MockScene extends EventDispatcher {
	constructor() {
		super();
		this.measurements = [];
		this.offset = new THREE.Vector3();
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

	getPointCloudCoordinateOffset() {
		return this.offset.clone();
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
			getSize: (target) => target.set(800, 600),
			render: vi.fn(),
		};
	}
}

describe("CadVectorTool", () => {
	let tool;

	afterEach(() => {
		tool?.dispose();
		tool = null;
	});

	it("imports axis-line and section records and supports idempotent updates", () => {
		const viewer = new MockViewer();
		tool = new CadVectorTool(viewer);
		const [axis] = tool.importVectors({
			uuid: "axis-1",
			vectorType: "axisLine",
			paths: [{points: [[0, 0, 0], [1, 0, 0]]}],
		});
		const [section] = tool.importVectors({
			uuid: "section-1",
			vectorType: "section",
			paths: [{points: [[0, 0, 0], [0, 0, 1], [1, 0, 2]]}],
		});
		const [updatedAxis] = tool.importVectors({
			uuid: "axis-1",
			vectorType: "axisLine",
			visible: false,
			paths: [{points: [[2, 0, 0], [3, 0, 0]]}],
		});

		expect(tool.getCadVectors()).toEqual([axis, section]);
		expect(updatedAxis).toBe(axis);
		expect(axis.visible).toBe(false);
		expect(axis.points[0].position.toArray()).toEqual([2, 0, 0]);
		expect(tool.scene.children).toEqual([axis, section]);
		expect(tool.setVisible("section-1", false)).toBe(true);
		expect(tool.remove("section-1")).toBe(true);
		expect(tool.find("section-1")).toBeNull();
	});

	it("aligns source coordinates when point clouds are already loaded or arrive later", () => {
		const viewer = new MockViewer();
		viewer.scene.offset.set(-100, -200, -300);
		tool = new CadVectorTool(viewer);
		const [first] = tool.importVectors({
			uuid: "source-1",
			coordinateSpace: "source",
			paths: [{points: [[100, 200, 300], [101, 200, 300]]}],
		});
		expect(first.points[0].position.toArray()).toEqual([0, 0, 0]);

		viewer.scene.offset.set(-90, -200, -300);
		first.points.forEach((point) => point.position.add(new THREE.Vector3(10, 0, 0)));
		first.update();
		viewer.scene.dispatchEvent({
			type: "pointcloud_offset_changed",
			nextOffset: viewer.scene.offset.clone(),
		});
		viewer.scene.dispatchEvent({type: "pointcloud_added"});
		expect(first.points[0].position.toArray()).toEqual([10, 0, 0]);
	});

	it("does not register generic vectors as interactive objects", () => {
		const viewer = new MockViewer();
		viewer.inputHandler = {registerInteractiveScene: vi.fn()};
		tool = new CadVectorTool(viewer);

		expect(viewer.inputHandler.registerInteractiveScene).not.toHaveBeenCalled();
	});

	it("updates a completed manual marker without replacing its semantic name", () => {
		const viewer = new MockViewer();
		const marker = new AxisLineMarker({uuid: "manual-axis"});
		marker.setFinalPoints([[0, 0, 0], [1, 0, 0]]);
		marker.finished = true;
		viewer.scene.addMeasurement(marker);
		tool = new CadVectorTool(viewer);

		const [updated] = tool.importVectors({
			uuid: "manual-axis",
			name: "Axis line 01",
			vectorType: "axisLine",
			paths: [{points: [[2, 0, 0], [3, 0, 0]]}],
		});

		expect(updated).toBe(marker);
		expect(marker.name).toBe("axisLine");
		expect(marker.points[0].position.toArray()).toEqual([2, 0, 0]);
	});
});
