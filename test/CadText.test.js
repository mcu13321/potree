import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "../libs/three.js/build/three.module.js";
import {createCadTextMesh, disposeCadTextMesh} from "../src/utils/CadText.js";
import {CadVector} from "../src/utils/CadVector.js";
import {mockCadTextCanvas} from "./helpers/cadTextCanvas.js";

afterEach(() => vi.restoreAllMocks());

describe("CAD world-space text", () => {
	it("uses source height, alignment, color, rotation and extrusion plane", () => {
		const {context} = mockCadTextCanvas();
		const mesh = createCadTextMesh({text: "HH", height: 0.2, color: "#00ff00",
			horizontalAlign: "right", verticalAlign: "top", normal: [0, -1, 0], rotation: Math.PI / 2});
		expect(mesh.isMesh).toBe(true);
		expect(mesh.material.color.getHex()).toBe(0x00ff00);
		expect(mesh.material.transparent).toBe(true);
		const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
		expect(normal.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-10);
		const right = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
		expect(right.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
		mesh.geometry.computeBoundingBox();
		// Padding surrounds the aligned ink box; cap-height maps exactly to CAD units.
		expect(mesh.geometry.boundingBox.max.x).toBeCloseTo(4 * 0.2 / 96);
		expect(mesh.geometry.boundingBox.max.y).toBeCloseTo(4 * 0.2 / 96);
		expect(context.fillText).toHaveBeenCalledWith("HH", 4, 100);
		const geometry = vi.spyOn(mesh.geometry, "dispose"), texture = vi.spyOn(mesh.material.map, "dispose");
		const material = vi.spyOn(mesh.material, "dispose");
		disposeCadTextMesh(mesh);
		expect(geometry).toHaveBeenCalledOnce(); expect(texture).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
	});

	it("reuses textures through visibility changes and offsets and disposes replaced text", () => {
		const {context} = mockCadTextCanvas();
		const text = {text: "A\nB", position: [101, 201, 105], height: 0.2, layer: " legend "};
		const vector = new CadVector({coordinateSpace: "source", paths: [{points: [[101, 201, 105], [102, 201, 105]]}], texts: [text]});
		const mesh = vector.textMeshes[0], texture = mesh.material.map;
		const drawCount = context.fillText.mock.calls.length;
		vector.setVisibleLayers(["LEGEND"]);
		expect(mesh.visible).toBe(true);
		vector.setVisibleLayers(["LAYER_VISIBLE"]);
		expect(mesh.visible).toBe(false);
		vector.applySourceOffset(new THREE.Vector3(-100, -200, -100));
		vector.applySourceOffset(new THREE.Vector3(-100, -200, -100));
		expect(mesh.position.toArray()).toEqual([1, 1, 5]);
		expect(vector.points.filter(point => point === vector.texts[0])).toHaveLength(1);
		expect(mesh.material.map).toBe(texture);
		expect(context.fillText).toHaveBeenCalledTimes(drawCount);
		const dispose = vi.spyOn(texture, "dispose");
		vector.setTexts(null);
		expect(dispose).toHaveBeenCalledOnce(); expect(vector.textMeshes).toHaveLength(0);
		vector.dispose();
	});
});
