import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it, vi} from "vitest";
import {AxisLineMarker} from "../src/utils/AxisLineMarker.js";
import {CadVector} from "../src/utils/CadVector.js";
import {loadMeasurement} from "../src/viewer/LoadProject.js";
import {createMeasurementData} from "../src/viewer/SaveProject.js";

describe("axis-line project serialization", () => {
	it("exports and imports generic CAD vector paths", () => {
		const vector = new CadVector({
			uuid: "section-1",
			name: "section.dwg",
			vectorType: "section",
			visible: false,
			paths: [{closed: false, points: [[1, 2, 3], [4, 5, 6]]}],
		});
		const data = createMeasurementData(vector);

		expect(data).toMatchObject({
			type: "CadVector",
			uuid: "section-1",
			name: "section.dwg",
			vectorType: "section",
			visible: false,
			coordinateSpace: "scene",
		});
		expect(data.paths[0].points).toEqual([[1, 2, 3], [4, 5, 6]]);

		const imported = {uuid: "section-1"};
		const importVectors = vi.fn(() => [imported]);
		expect(loadMeasurement({cadVectorTool: {importVectors}}, data)).toBe(imported);
		expect(importVectors).toHaveBeenCalledWith({
			uuid: "section-1",
			name: "section.dwg",
			vectorType: "section",
			visible: false,
			coordinateSpace: "scene",
			paths: data.paths,
		});
	});
	it("exports completed axis-line coordinates as final B points", () => {
		const marker = new AxisLineMarker({uuid: "axis-1", visible: false});
		marker.setFinalPoints([
			new THREE.Vector3(1, 2, 3),
			new THREE.Vector3(4, 5, 6),
		]);
		marker.finished = true;

		const data = createMeasurementData(marker);

		expect(data.type).toBe("AxisLineMarker");
		expect(data.visible).toBe(false);
		expect(data.points).toEqual([[1, 2, 3], [4, 5, 6]]);
	});

	it("imports axis-line coordinates through the dedicated tool", () => {
		const imported = {uuid: "axis-1"};
		const importAxisLines = vi.fn(() => [imported]);
		const viewer = {
			scene: {measurements: []},
			axisLineMarkerTool: {importAxisLines},
		};
		const data = {
			type: "AxisLineMarker",
			uuid: "axis-1",
			visible: true,
			points: [[1, 2, 3], [4, 5, 6]],
		};

		expect(loadMeasurement(viewer, data)).toBe(imported);
		expect(importAxisLines).toHaveBeenCalledWith({
			uuid: "axis-1",
			visible: true,
			points: data.points,
		});
	});
});
