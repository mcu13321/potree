import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {MeasureHtmlLabel} from "../src/utils/MeasureHtmlLabel.js";

function createMaterial() {
	return {
		resolution: {
			set: vi.fn(),
		},
	};
}

function createObject3DStub() {
	return {
		position: new THREE.Vector3(),
		scale: {
			set: vi.fn(),
		},
		visible: false,
	};
}

function createLineStub() {
	return {
		position: new THREE.Vector3(),
		geometry: {
			setPositions: vi.fn(),
			computeBoundingSphere: vi.fn(),
			verticesNeedUpdate: false,
		},
		computeLineDistances: vi.fn(),
		material: createMaterial(),
	};
}

vi.mock("../src/utils/Measure.js", async () => {
	const THREE = await import("../libs/three.js/build/three.module.js");
	const {MeasureHtmlLabel} = await import("../src/utils/MeasureHtmlLabel.js");

	class MockMeasure extends THREE.Object3D {
		constructor() {
			super();
			this.points = [];
			this.spheres = [];
			this.edges = [];
			this.sphereLabels = [];
			this.edgeLabels = [];
			this.angleLabels = [];
			this.coordinateLabels = [];
			this.heightLabel = new MeasureHtmlLabel("", {className: "potree-measurement-label--height", offsetX: 72, offsetY: -6});
			this.areaLabel = new MeasureHtmlLabel("");
			this.circleRadiusLabel = new MeasureHtmlLabel("");
			this.circleRadiusLine = {material: createMaterial()};
			this.heightEdge = {material: createMaterial(), geometry: {}, visible: false};
			this.circleLine = {material: createMaterial()};
			this.azimuth = {
				label: new MeasureHtmlLabel(""),
				node: {visible: false},
				center: createObject3DStub(),
				target: createObject3DStub(),
				north: createObject3DStub(),
				circle: {
					position: new THREE.Vector3(),
					scale: {set: vi.fn()},
					material: createMaterial(),
				},
				centerToNorth: createLineStub(),
				centerToTarget: createLineStub(),
				centerToTargetground: createLineStub(),
				targetgroundToTarget: createLineStub(),
			};
			this.showHeight = false;
			this.showAzimuth = false;
			this.maxMarkers = Infinity;
			this.finished = false;
			this.geometryGroup = new THREE.Group();
			this.textsGroup = new THREE.Group();
		}

		// 模拟真实测量对象的标签集合接口，供 MeasuringTool 统一挂载和回收。
		getAllLabels() {
			return [
				...this.edgeLabels,
				...this.angleLabels,
				...this.coordinateLabels,
				this.heightLabel,
				this.areaLabel,
				this.circleRadiusLabel,
				this.azimuth.label,
			].filter(Boolean);
		}

		disposeLabels() {
			for (const label of this.getAllLabels()) {
				label.dispose();
			}
		}

		addMarker(position) {
			const point = position.x != null ? {position} : position;
			this.points.push(point);
			this.spheres.push({
				scale: {set: vi.fn()},
				position: new THREE.Vector3(),
			});
			this.edges.push({material: createMaterial()});

			const edgeLabel = new MeasureHtmlLabel("");
			const coordinateLabel = new MeasureHtmlLabel("");
			const angleLabel = new MeasureHtmlLabel("");
			this.edgeLabels.push(edgeLabel);
			this.coordinateLabels.push(coordinateLabel);
			this.angleLabels.push(angleLabel);
		}

		removeMarker(index) {
			const edgeIndex = index === 0 ? 0 : index - 1;
			this.edgeLabels[edgeIndex]?.dispose();
			this.coordinateLabels[index]?.dispose();
			this.angleLabels[index]?.dispose();
			this.edgeLabels.splice(edgeIndex, 1);
			this.coordinateLabels.splice(index, 1);
			this.angleLabels.splice(index, 1);
			this.edges.splice(edgeIndex, 1);
			this.spheres.splice(index, 1);
			this.points.splice(index, 1);
		}

		update() {
			for (let i = 0; i < this.points.length; i++) {
				const point = this.points[i].position;
				const edgeLabel = this.edgeLabels[i];
				const coordinateLabel = this.coordinateLabels[i];
				const angleLabel = this.angleLabels[i];

				if (edgeLabel) {
					edgeLabel.position.copy(point);
					edgeLabel.setText(`edge-${i}`);
					edgeLabel.setVisible(true);
				}
				if (coordinateLabel) {
					coordinateLabel.position.copy(point);
					coordinateLabel.setText(`coord-${i}`);
					coordinateLabel.setVisible(true);
				}
				if (angleLabel) {
					angleLabel.position.copy(point);
					angleLabel.setText(`angle-${i}`);
					angleLabel.setVisible(true);
				}
			}

			this.heightLabel.setVisible(false);
			this.areaLabel.setVisible(false);
			this.circleRadiusLabel.setVisible(false);
			this.azimuth.label.setVisible(false);
		}
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
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		camera.position.set(0, 0, 10);
		camera.lookAt(new THREE.Vector3(0, 0, 0));
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();
		return camera;
	}
}

class MockViewer extends EventDispatcher {
	constructor() {
		super();
		this.renderArea = document.createElement("div");
		document.body.appendChild(this.renderArea);

		this.scene = new MockScene();
		this.lengthUnit = {unitspermeter: 1, code: "m"};
		this.lengthUnitDisplay = {unitspermeter: 1, code: "m"};
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: () => ({width: 800, height: 600, x: 800, y: 600}),
			render: vi.fn(),
		};
		Object.defineProperty(this.renderer.domElement, "clientWidth", {value: 800});
		Object.defineProperty(this.renderer.domElement, "clientHeight", {value: 600});
		this.renderArea.appendChild(this.renderer.domElement);

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

describe("MeasuringTool HTML labels", () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = new MockViewer();
		tool = new MeasuringTool(viewer);
		viewer.measuringTool = tool;
	});

	afterEach(() => {
		viewer.renderArea.remove();
		document.body.innerHTML = "";
	});

	it("measurement_added 后应把标签挂到 renderArea", () => {
		// 启动一次测量插入流程，验证初始标签已经落到 renderArea。
		tool.startInsertion({name: "length"});

		const labels = viewer.renderArea.querySelectorAll(".potree-measurement-label");
		expect(labels.length).toBeGreaterThan(0);
	});

	it("动态 addMarker 后应在后续 update 中补挂新标签", () => {
		const measure = tool.startInsertion({name: "length"});
		const beforeCount = viewer.renderArea.querySelectorAll(".potree-measurement-label").length;

		measure.addMarker(new THREE.Vector3(1, 0, 0));
		tool.update();

		const afterCount = viewer.renderArea.querySelectorAll(".potree-measurement-label").length;
		expect(afterCount).toBeGreaterThan(beforeCount);
	});

	it("removeMarker 与 measurement_removed 后不应残留 DOM 标签", () => {
		const measure = tool.startInsertion({name: "length"});
		measure.addMarker(new THREE.Vector3(1, 0, 0));
		tool.update();

		const removedLabel = measure.coordinateLabels[1];
		expect(removedLabel.domElement.parentElement).toBe(viewer.renderArea);

		measure.removeMarker(1);
		tool.update();
		expect(removedLabel.domElement).toBeNull();

		viewer.scene.removeMeasurement(measure);
		expect(viewer.renderArea.querySelectorAll(".potree-measurement-label").length).toBe(0);
	});
});
