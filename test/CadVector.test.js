import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it, vi} from "vitest";
import {
	CAD_VECTOR_COORDINATE_SPACE,
	CadVector,
} from "../src/utils/CadVector.js";

describe("CadVector", () => {
	it("renders disconnected paths as one white read-only line batch", () => {
		const vector = new CadVector({
			vectorType: "section",
			paths: [
				{points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]]},
				{points: [[10, 0, 0], [11, 0, 0]]},
			],
		});

		expect(vector.isCadVector).toBe(true);
		expect(vector.points).toHaveLength(5);
		expect(vector.children).toEqual([vector.line]);
		expect(vector.line.material.color.getHex()).toBe(0xffffff);
		expect(vector.line.material.depthTest).toBe(false);
		expect(vector.line.material.depthWrite).toBe(false);
		expect(vector.line.geometry.attributes.instanceStart.count).toBe(3);
		expect(vector.spheres).toBeUndefined();
		expect(vector.coordinateLabels).toBeUndefined();
	});

	it("closes a path only when the final point does not already repeat the first", () => {
		const openEnded = new CadVector({
			paths: [{closed: true, points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]]}],
		});
		const alreadyClosed = new CadVector({
			paths: [{closed: true, points: [[0, 0, 0], [1, 0, 0], [0, 0, 0]]}],
		});

		expect(openEnded.line.geometry.attributes.instanceStart.count).toBe(3);
		expect(alreadyClosed.line.geometry.attributes.instanceStart.count).toBe(2);
	});

	it("applies source offsets idempotently and rebuilds geometry after rebasing", () => {
		const vector = new CadVector({
			coordinateSpace: CAD_VECTOR_COORDINATE_SPACE.SOURCE,
			paths: [{points: [[100, 200, 300], [101, 201, 301]]}],
		});
		const update = vi.spyOn(vector, "update");

		vector.applySourceOffset(new THREE.Vector3(-100, -200, -300));
		expect(vector.points.map((point) => point.position.toArray())).toEqual([
			[0, 0, 0],
			[1, 1, 1],
		]);
		vector.applySourceOffset(new THREE.Vector3(-100, -200, -300));
		expect(update).toHaveBeenCalledTimes(1);

		vector.points.forEach((point) => point.position.add(new THREE.Vector3(5, 0, 0)));
		vector.update();
		expect(vector.points[0].position.toArray()).toEqual([5, 0, 0]);
	});

	it("ignores invalid coordinates and paths that cannot form a segment", () => {
		const vector = new CadVector({
			paths: [
				{points: [[0, 0, 0], [Number.NaN, 1, 2]]},
				{points: [[1, 1, 1], [2, 2, 2]]},
			],
		});

		expect(vector.paths).toHaveLength(1);
		expect(vector.points.map((point) => point.position.toArray())).toEqual([
			[1, 1, 1],
			[2, 2, 2],
		]);
	});
});
