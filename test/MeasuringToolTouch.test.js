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

// Replay native mouse click counts without changing picking, editing, or touch semantics.
describe("MeasuringTool repeated mouse clicks", () => {
	let viewer;
	let tool;
	const a = new THREE.Vector3(1, 2, 3);
	const b = new THREE.Vector3(4, 6, 8);
	const c = new THREE.Vector3(7, 3, 5);
	const options = (name) => ({name, ...({height: {maxMarkers: 2}, angle: {maxMarkers: 3}, point: {maxMarkers: 1}}[name] || {})});

	beforeEach(() => {
		vi.useFakeTimers();
		viewer = new MockViewer();
		tool = new MeasuringTool(viewer);
		viewer.measuringTool = tool;
		viewer.inputHandler.getEventLocalPosition.mockReturnValue(new THREE.Vector2(10, 10));
		viewer.inputHandler.isTapGesture.mockReturnValue(true);
		viewer.inputHandler.hoveredPoint = {location: a};
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		viewer.renderer.domElement.remove();
	});

	function release(point, detail = 1, button = 0) {
		// Picking updates the trailing preview before the native mouseup insertion callback.
		tool.eventMeasurement.points.at(-1).position.copy(point);
		for (const type of ["mousedown", "mouseup"]) {
			viewer.renderer.domElement.dispatchEvent(new MouseEvent(type, {button, detail, clientX: 10, clientY: 10}));
		}
	}

	for (const name of ["length", "height", "angle", "area"]) {
		it(`${name} ignores the second and third releases of the same click gesture`, () => {
			const measure = tool.startInsertion(options(name));
			release(a, 1);
			release(a, 2);
			release(a, 3);
			expect(measure.points.map(({position}) => position.toArray())).toEqual([a.toArray(), a.toArray()]);
			expect(measure.finished).toBe(false);
			expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
		});
	}

	for (const name of ["length", "area"]) {
		it(`${name} keeps distinct single clicks and right-click completion`, () => {
			const measure = tool.startInsertion(options(name));
			release(a);
			release(b);
			release(b, 2);
			if (name === "area") release(c);
			const committed = name === "area" ? [a, b, c] : [a, b];
			// A repeated right-button count must not be mistaken for a repeated left click.
			release(c, 2, 2);
			expect(measure.points.map(({position}) => position.toArray())).toEqual(committed.map((point) => point.toArray()));
			expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledExactlyOnceWith(measure);
		});
	}

	for (const name of ["height", "angle"]) {
		it(`${name} completes at the normal point count and does not spill into the next draft`, () => {
			const measure = tool.startInsertion(options(name));
			release(a);
			release(b);
			if (name === "angle") release(c);
			expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledExactlyOnceWith(measure);
			vi.runOnlyPendingTimers();
			const nextDraft = tool.eventMeasurement;
			release(c, 2);
			expect(nextDraft.points).toHaveLength(1);
			expect(nextDraft.finished).toBe(false);
			release(a, 1);
			expect(nextDraft.points).toHaveLength(2);
		});
	}

	it("still rejects camera drags and keeps synthetic single clicks", () => {
		const measure = tool.startInsertion(options("length"));
		viewer.inputHandler.isTapGesture.mockReturnValue(false);
		release(a);
		expect(measure.points).toHaveLength(1);
		viewer.inputHandler.isTapGesture.mockReturnValue(true);
		release(a, 0);
		expect(measure.points).toHaveLength(2);
	});

	it("leaves single-point and other measurement tools outside the filter", () => {
		const point = tool.startInsertion(options("point"));
		release(a, 1);
		release(a, 2);
		expect(point.points).toHaveLength(1);
		const other = tool.startInsertion({name: "custom", maxMarkers: 10});
		release(a, 1);
		release(a, 2);
		expect(other.points).toHaveLength(3);
	});
});
