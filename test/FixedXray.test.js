import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "../libs/three.js/build/three.module.js";
import {FixedXray} from "../src/viewer/FixedXray.js";
import {chooseXrayCut, shareXrayBudget, spreadXrayPoints, XrayFrameRate, xrayPointOrder} from "../src/viewer/FixedXraySampling.js";

afterEach(() => vi.unstubAllGlobals());

function makeCloud(){
	const cloud = new THREE.Object3D();
	const box = cloud.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
	const node = (name, level, numPoints, children = []) => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(numPoints * 3), 3));
		return {name, level, numPoints, boundingBox: box, loaded: true, geometry, children};
	};
	const rawDetail = node("r1", 1, 30);
	const dispose = vi.spyOn(rawDetail.geometry, "dispose");
	const root = node("r", 0, 12, [node("r0", 1, 24)]);
	const detach = ({geometry, loaded, children, ...description}) => description;
	const loader = {
		metadata: {points: 66},
		loadFixedHierarchy: vi.fn(async () => [[detach(root)], [detach(root.children[0]), detach(rawDetail)]]),
		loadFixedGeometry: vi.fn(async () => rawDetail.geometry),
	};
	cloud.userData.xrayEnabled = true;
	cloud.pcoGeometry = {root, loader};
	cloud.visibleNodes = [{native: true}];
	return {cloud, dispose};
}

async function flush(){
	// Catalog publication and resident-node adoption each finish in a promise continuation.
	for(let i = 0; i < 6; i++) await Promise.resolve();
}

describe("fixed XRay", () => {
	it("compares single and cumulative cuts without letting a large cloud take the entire budget", () => {
		expect(shareXrayBudget([3, 100, 100], 100)).toEqual([3, 48, 49]);
		const levels = [[{numPoints: 100}], [{numPoints: 700}], [{numPoints: 1400}]];
		expect(chooseXrayCut(levels, 750, 1000)).toMatchObject({level: 1, points: 700, strategy: "single"});
		expect(chooseXrayCut(levels, 810, 1000)).toMatchObject({level: 1, points: 800, strategy: "cumulative"});
		expect(chooseXrayCut(levels, 1600, 1000).points).toBe(800);
	});

	it("keeps deterministic, disjoint samples spread along source order", () => {
		const order = xrayPointOrder(1000, 300, 7);
		expect(order).toEqual(xrayPointOrder(1000, 300, 7));
		expect(new Set(order).size).toBe(300);
		expect(Math.min(...order.slice(0, 60))).toBeLessThan(50);
		expect(Math.max(...order.slice(0, 60))).toBeGreaterThan(950);
		expect(spreadXrayPoints([100, 20, 10], 23).reduce((sum, count) => sum + count, 0)).toBe(23);
	});

	it("requires two measured windows and clears timing after a suspended frame", () => {
		const fps = new XrayFrameRate();
		for(let time = 0; time <= 1000; time += 50) fps.record(time);
		expect(fps.low).toBe(1);
		for(let time = 1050; time <= 2000; time += 50) fps.record(time);
		expect(fps.low).toBe(2);
		fps.record(3100);
		expect(fps.low).toBe(0);
		for(let time = 3125; time <= 5100; time += 25) fps.record(time);
		expect(fps.high).toBe(2);
	});

	it("progressively publishes two clouds and preserves native membership when the camera moves", async () => {
		// A full native queue does not block fixed requests or receive their decoded geometry.
		vi.stubGlobal("Potree", {lru: {touch: vi.fn()}, maxNodesLoading: 4, numNodesLoading: 4});
		const samples = [makeCloud(), makeCloud()];
		const clouds = samples.map(sample => sample.cloud);
		const viewer = {scene: {pointclouds: clouds}, isXraySplatPipelineSupported: () => true};
		const controller = new FixedXray(viewer);
		const camera = new THREE.PerspectiveCamera();
		controller.update(0);
		expect(controller.frame(clouds, camera).nodes.get(clouds[0])[0].drawCount).toBe(12);
		for(let i = 1; i <= 8; i++){
			await flush();
			controller.update(i * 16);
		}
		const before = controller.frame(clouds, camera).nodes;
		expect(before.get(clouds[0]).map(record => record.drawCount)).toEqual([12, 24, 30]);
		expect(before.get(clouds[1]).map(record => record.drawCount)).toEqual([12, 24, 30]);
		camera.position.x = 8;
		camera.updateMatrixWorld();
		expect(controller.frame(clouds, camera).nodes.get(clouds[0])).toBe(before.get(clouds[0]));
		expect(clouds[0].visibleNodes).toEqual([{native: true}]);
		// Thinning and recovery change only the fixed draw counts and use the same decoded data.
		for(const {cloud, dispose} of samples){
			expect(cloud.pcoGeometry.loader.loadFixedGeometry).toHaveBeenCalledOnce();
			expect(dispose).toHaveBeenCalledOnce();
			expect(cloud.pcoGeometry.root.children).toHaveLength(1);
		}
		expect(Potree.lru.touch).not.toHaveBeenCalled();
		expect(Potree.numNodesLoading).toBe(4);
		controller.fps.low = 2;
		controller.update(160);
		expect(controller.frame(clouds, camera).nodes.get(clouds[0]).reduce((sum, record) => sum + record.drawCount, 0)).toBe(52);
		controller.fps.high = 2;
		controller.update(192);
		expect(controller.frame(clouds, camera).nodes.get(clouds[0]).reduce((sum, record) => sum + record.drawCount, 0)).toBe(66);
		expect(clouds[0].pcoGeometry.loader.loadFixedGeometry).toHaveBeenCalledOnce();
		clouds[0].dispatchEvent({type: "dispose"});
		expect(controller.states.has(clouds[0])).toBe(false);
		controller.clear();
	});
});
