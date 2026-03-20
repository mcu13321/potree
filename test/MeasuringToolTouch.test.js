import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";

vi.mock("../src/utils/Measure.js", async () => {
	const THREE = await import("../libs/three.js/build/three.module.js");

	class MockMeasure extends THREE.Object3D {
		constructor() {
			super();
			this.points = [];
			this.spheres = [];
			this.finished = false;
		}

		addMarker(position) {
			this.points.push({position});
			this.spheres.push({name: `sphere-${this.spheres.length}`});
		}

		removeMarker(index) {
			this.points.splice(index, 1);
			this.spheres.splice(index, 1);
		}

		update() {}
	}

	return {
		Measure: MockMeasure,
	};
});

const {MeasuringTool} = await import("../src/utils/MeasuringTool.js");

class MockScene extends EventDispatcher {
	constructor() {
		super();
		this.measurements = [];
	}

	addMeasurement(measurement) {
		this.measurements.push(measurement);
		this.dispatchEvent({type: "measurement_added", measurement});
	}

	removeMeasurement(measurement) {
		this.measurements = this.measurements.filter((item) => item !== measurement);
		this.dispatchEvent({type: "measurement_removed", measurement});
	}

	addMeasurement2platform = vi.fn();

	getActiveCamera() {
		return new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	}
}

class MockViewer extends EventDispatcher {
	constructor() {
		super();
		this.scene = new MockScene();
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: () => new THREE.Vector2(800, 600),
			render: vi.fn(),
		};
		Object.defineProperty(this.renderer.domElement, "clientWidth", {value: 800});
		Object.defineProperty(this.renderer.domElement, "clientHeight", {value: 600});
		document.body.appendChild(this.renderer.domElement);

		this.inputHandler = {
			registerInteractiveScene: vi.fn(),
			setMeasurementReadonlyStatus: vi.fn(),
			startDragging: vi.fn(),
			endDragging: vi.fn(),
			getEventLocalPosition: vi.fn(),
			isTapGesture: vi.fn(),
			refreshHoveredPoint: vi.fn(),
			hoveredPoint: null,
		};
	}
}

function createDomTouchEvent(type, touches = [], changedTouches = []) {
	const event = new Event(type, {bubbles: true, cancelable: true});
	Object.defineProperty(event, "touches", {value: touches});
	Object.defineProperty(event, "changedTouches", {value: changedTouches});
	return event;
}

describe("MeasuringTool touch insertion", () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = new MockViewer();
		tool = new MeasuringTool(viewer);
		viewer.measuringTool = tool;
	});

	afterEach(() => {
		viewer.renderer.domElement.remove();
	});

	it("触摸轻点时应按抬手位置刷新悬停点并添加标记", () => {
		const hoveredPoint = {location: new THREE.Vector3(1, 2, 3)};
		viewer.inputHandler.getEventLocalPosition.mockImplementation((event) => {
			return event.type === "touchstart" ? new THREE.Vector2(10, 10) : new THREE.Vector2(12, 12);
		});
		viewer.inputHandler.isTapGesture.mockReturnValue(true);
		viewer.inputHandler.refreshHoveredPoint.mockImplementation(() => {
			viewer.inputHandler.hoveredPoint = hoveredPoint;
			return hoveredPoint;
		});

		tool.startInsertion({name: "length"});
		viewer.renderer.domElement.dispatchEvent(createDomTouchEvent("touchstart", [{clientX: 110, clientY: 60}]));
		viewer.renderer.domElement.dispatchEvent(createDomTouchEvent("touchend", [], [{clientX: 112, clientY: 62}]));

		expect(viewer.inputHandler.refreshHoveredPoint).toHaveBeenCalledWith(new THREE.Vector2(12, 12));
		expect(tool.eventMeasurement.points.length).toBe(2);
		expect(viewer.inputHandler.startDragging).toHaveBeenCalled();
	});

	it("触摸拖动超过阈值时不应添加标记", () => {
		const hoveredPoint = {location: new THREE.Vector3(1, 2, 3)};
		viewer.inputHandler.getEventLocalPosition.mockImplementation((event) => {
			return event.type === "touchstart" ? new THREE.Vector2(10, 10) : new THREE.Vector2(30, 30);
		});
		viewer.inputHandler.isTapGesture.mockReturnValue(false);
		viewer.inputHandler.refreshHoveredPoint.mockImplementation(() => {
			viewer.inputHandler.hoveredPoint = hoveredPoint;
			return hoveredPoint;
		});

		tool.startInsertion({name: "length"});
		const draggingCallCount = viewer.inputHandler.startDragging.mock.calls.length;
		viewer.renderer.domElement.dispatchEvent(createDomTouchEvent("touchstart", [{clientX: 110, clientY: 60}]));
		viewer.renderer.domElement.dispatchEvent(createDomTouchEvent("touchend", [], [{clientX: 130, clientY: 80}]));

		expect(tool.eventMeasurement.points.length).toBe(1);
		expect(viewer.inputHandler.startDragging).toHaveBeenCalledTimes(draggingCallCount);
	});
});
