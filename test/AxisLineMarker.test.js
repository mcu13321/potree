import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it} from "vitest";
import {
	AXIS_LINE_DEFAULT_XY_TOLERANCES,
	AxisLineMarker,
	selectAxisLineLowestPoint,
} from "../src/utils/AxisLineMarker.js";

describe("AxisLineMarker", () => {
	it("renders only a white polyline and keeps preview outside committed points", () => {
		const marker = new AxisLineMarker();
		marker.addPoint(new THREE.Vector3(1, 2, 3));
		marker.setPreviewPoint(new THREE.Vector3(4, 5, 6));

		expect(marker.points).toHaveLength(1);
		expect(marker.previewPoint.toArray()).toEqual([4, 5, 6]);
		expect(marker.line.material.color.getHex()).toBe(0xffffff);
		expect(marker.children).toEqual([marker.line]);
	});

	it("invalidates the cached instance count when the polyline grows", () => {
		const marker = new AxisLineMarker();
		marker.addPoint(new THREE.Vector3(1, 2, 3));
		marker.addPoint(new THREE.Vector3(4, 5, 6));
		// Simulate the segment limit cached by Three.js after the first render.
		marker.line.geometry._maxInstanceCount = 1;

		marker.setPreviewPoint(new THREE.Vector3(7, 8, 9));

		expect(marker.line.geometry.attributes.instanceStart.count).toBe(2);
		expect(marker.line.geometry._maxInstanceCount).toBeUndefined();
	});

	it("selects the lowest Z point from the nearest populated XY tolerance", () => {
		const origin = new THREE.Vector3(0, 0, 10);
		const candidates = [
			new THREE.Vector3(0.01, 0, 8),
			new THREE.Vector3(0.015, 0, 6),
			new THREE.Vector3(0.04, 0, 1),
		];

		const selected = selectAxisLineLowestPoint(
			origin,
			candidates,
			AXIS_LINE_DEFAULT_XY_TOLERANCES,
		);

		expect(selected.toArray()).toEqual([0.015, 0, 6]);
	});

	it("expands to the next tolerance only when the smaller tolerance is empty", () => {
		const selected = selectAxisLineLowestPoint(
			new THREE.Vector3(0, 0, 10),
			[new THREE.Vector3(0.04, 0, 3), new THREE.Vector3(0.09, 0, 1)],
			AXIS_LINE_DEFAULT_XY_TOLERANCES,
		);

		expect(selected.toArray()).toEqual([0.04, 0, 3]);
	});
});
