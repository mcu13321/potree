import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it, vi} from "vitest";
import {CadVector} from "../src/utils/CadVector.js";

// Exercise styled native batches rather than duplicating the dash splitting algorithm.
describe("CAD boundary styles", () => {
	it("retains colors and dash phase across a polyline vertex", () => {
		const vector = new CadVector({paths: [
			{layer: "LAYER_VISIBLE", points: [[0, 1, 2], [2, 1, 2]], style: {color: "#ff0000", pattern: []}},
			{layer: "UNDERPASS_HIDDEN", points: [[0, 0, 0], [0.4, 0, 0], [1.2, 0, 0]], style: {color: "#0000ff", pattern: [0.6, -0.4]}},
		]});
		expect(vector.styleLines).toHaveLength(2);
		expect(vector.styleLines.map(line => line.material.color.getHex())).toEqual([0xff0000, 0x0000ff]);
		const blue = vector.styleLines[1].geometry.attributes;
		expect(blue.instanceStart.count).toBe(3);
		expect(blue.instanceStart.getX(2)).toBeCloseTo(1);
		expect(blue.instanceEnd.getX(1)).toBeCloseTo(0.6);
		vector.dispose();
	});
	it("filters layers without moving source coordinates and disposes replaced batches", () => {
		const vector = new CadVector({coordinateSpace: "source", paths: [
			{layer: "LAYER_VISIBLE", points: [[100, 2, 3], [101, 2, 3]], style: {color: "#ff0000"}},
			{layer: "UNDERPASS_HIDDEN", points: [[100, 4, 5], [101, 4, 5]], style: {color: "#0000ff"}},
		]});
		vector.applySourceOffset(new THREE.Vector3(-100, 0, 0));
		const positions = vector.points.map(point => point.position.toArray());
		const dispose = vi.spyOn(vector.styleLines[0].geometry, "dispose");
		vector.setVisibleLayers(["UNDERPASS_HIDDEN"]);
		expect(dispose).toHaveBeenCalledOnce();
		expect(vector.styleLines).toHaveLength(1);
		expect(vector.getRenderablePaths()[0].layer).toBe("UNDERPASS_HIDDEN");
		expect(vector.points.map(point => point.position.toArray())).toEqual(positions);
		vector.updateResolution(640, 480);
		expect(vector.styleLines[0].material.resolution.toArray()).toEqual([640, 480]);
		vector.setVisibleLayers([]);
		expect(vector.styleLines).toHaveLength(0);
		vector.setVisibleLayers(null);
		expect(vector.styleLines).toHaveLength(2);
		vector.dispose();
	});
});
