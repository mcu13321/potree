import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {InputHandler} from "../src/navigation/InputHandler.js";
import {Utils} from "../src/utils.js";

// Only replace canvas texture creation; keep the real measure and input event handlers.
vi.mock("../libs/konva/lib/shapes/Circle.js", () => ({Circle: class {
	toCanvas() { return document.createElement("canvas"); }
}}));
const {MeasuringTool} = await import("../src/utils/MeasuringTool.js");

describe("Measurement preview after native double clicks", () => {
	let viewer;
	let tool;
	let pick;
	const a = new THREE.Vector3(1, 2, 3);
	const b = new THREE.Vector3(5, 2, 3);
	const c = new THREE.Vector3(3, 6, 3);

	beforeEach(() => {
		vi.useFakeTimers();
		viewer = new EventDispatcher();
		viewer.renderArea = document.createElement("div");
		document.body.appendChild(viewer.renderArea);
		const canvas = document.createElement("canvas");
		viewer.renderArea.appendChild(canvas);
		Object.defineProperty(canvas, "clientWidth", {value: 800});
		Object.defineProperty(canvas, "clientHeight", {value: 600});
		const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
		camera.position.set(0, 0, 10);
		camera.updateMatrixWorld(true);
		viewer.scene = Object.assign(new EventDispatcher(), {
			scene: new THREE.Scene(), pointclouds: [], measurements: [],
			view: {clone: () => ({})}, getActiveCamera: () => camera,
			addMeasurement(measurement) {
				this.measurements.push(measurement);
				this.dispatchEvent({type: "measurement_added", measurement});
			},
			removeMeasurement(measurement) {
				this.measurements = this.measurements.filter((item) => item !== measurement);
				this.dispatchEvent({type: "measurement_removed", measurement});
			},
			addMeasurement2platform: vi.fn(),
		});
		viewer.controls = {enabled: true};
		viewer.renderer = {domElement: canvas, getSize: () => new THREE.Vector2(800, 600)};
		viewer.inputHandler = new InputHandler(viewer);
		viewer.inputHandler.setScene(viewer.scene);
		vi.spyOn(viewer.inputHandler, "getHoveredElements").mockReturnValue([]);
		pick = a;
		vi.spyOn(Utils, "getMousePointCloudIntersection").mockImplementation(() => ({location: pick, point: {position: pick}}));
		tool = new MeasuringTool(viewer);
		viewer.measuringTool = tool;
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		viewer.renderArea.remove();
	});

	function move(point) {
		pick = point;
		viewer.renderer.domElement.dispatchEvent(new MouseEvent("mousemove", {clientX: 100, clientY: 100}));
	}
	function click(detail) {
		for (const type of ["mousedown", "mouseup"]) {
			viewer.renderer.domElement.dispatchEvent(new MouseEvent(type, {button: 0, detail, clientX: 100, clientY: 100}));
		}
	}

	for (const name of ["length", "height", "angle", "area"]) {
		it(`${name} keeps the first vertex fixed and the preview following after double/triple click`, () => {
			const measure = tool.startInsertion({name, ...({height: {maxMarkers: 2}, angle: {maxMarkers: 3}}[name] || {})});
			move(a);
			click(1);
			click(2);
			click(3);
			expect(measure.points).toHaveLength(2);
			expect(viewer.inputHandler.drag?.object).toBe(measure.spheres[1]);
			move(b);
			expect(measure.points.map(({position}) => position.toArray())).toEqual([a.toArray(), b.toArray()]);
			expect(measure.finished).toBeFalsy();
			expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
			click(1);
			if (name === "height") {
				expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledExactlyOnceWith(measure);
			} else {
				click(2);
				move(c);
				expect(measure.points.map(({position}) => position.toArray())).toEqual([a.toArray(), b.toArray(), c.toArray()]);
			}
		});
	}
});
