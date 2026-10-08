import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it} from "vitest";
import {
	AXIS_LINE_DEFAULT_XY_TOLERANCES,
	AxisLineMarker,
	selectAxisLineLoadedBottomPoint,
	selectAxisLineLowestPoint,
} from "../src/utils/AxisLineMarker.js";

describe("AxisLineMarker", () => {
	it("is a single-path CAD vector while keeping its preview outside committed points", () => {
		const marker = new AxisLineMarker();
		marker.addPoint(new THREE.Vector3(1, 2, 3));
		marker.setPreviewPoint(new THREE.Vector3(4, 5, 6));

		expect(marker.isCadVector).toBe(true);
		expect(marker.vectorType).toBe("axisLine");
		expect(marker.paths).toHaveLength(1);
		expect(marker.points).toHaveLength(1);
		expect(marker.line.visible).toBe(true);
	});
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

	it("skips nearby roof points when a supported floor band exists", () => {
		const origin = new THREE.Vector3(0, 0, 10);
		const candidates = [
			new THREE.Vector3(0, 0, 10),
			new THREE.Vector3(0.01, 0, 10),
			new THREE.Vector3(0.04, 0, 1),
			new THREE.Vector3(0.06, 0, 1.02),
			new THREE.Vector3(0.08, 0, 0.99),
		];

		const selected = selectAxisLineLoadedBottomPoint(origin, candidates);

		expect(selected.toArray()).toEqual([0.04, 0, 1]);
	});

	it("ignores an isolated low outlier and widens the loaded sample when needed", () => {
		const selected = selectAxisLineLoadedBottomPoint(new THREE.Vector3(0, 0, 10), [
			new THREE.Vector3(0, 0, 10),
			new THREE.Vector3(0.01, 0, -100),
			new THREE.Vector3(0.14, 0, 1),
			new THREE.Vector3(0.16, 0, 1.02),
			new THREE.Vector3(0.18, 0, 0.99),
		]);
		expect(selected.toArray()).toEqual([0.14, 0, 1]);
	});

	it("falls back to the lowest loaded point when no supported floor exists", () => {
		const selected = selectAxisLineLoadedBottomPoint(new THREE.Vector3(0, 0, 10), [
			new THREE.Vector3(0, 0, 10),
			new THREE.Vector3(0.04, 0, 9),
		]);
		expect(selected.toArray()).toEqual([0.04, 0, 9]);
		expect(selectAxisLineLoadedBottomPoint(new THREE.Vector3(), [])).toBeNull();
	});

	it("preserves the original exported nearest-populated selector", () => {
		const selected = selectAxisLineLowestPoint(
			new THREE.Vector3(0, 0, 10),
			[new THREE.Vector3(0.01, 0, 8), new THREE.Vector3(0.04, 0, 1)],
			AXIS_LINE_DEFAULT_XY_TOLERANCES,
		);
		expect(selected.toArray()).toEqual([0.01, 0, 8]);
	});
});
