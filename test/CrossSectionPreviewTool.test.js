import * as THREE from "../libs/three.js/build/three.module.js";
import {readFileSync} from "node:fs";
import {describe, expect, test} from "vitest";
import {
	buildCrossSectionPreviewFrames,
	buildCrossSectionPreviewVolume,
	CrossSectionPreviewTool,
	estimateCrossSectionFrameSideLength,
} from "../src/utils/CrossSectionPreviewTool.js";

describe("buildCrossSectionPreviewFrames", () => {
	test("creates vertical squares perpendicular to the XY axis tangent", () => {
		const frames = buildCrossSectionPreviewFrames({
			axisPoints: [new THREE.Vector3(0, 0, 4), new THREE.Vector3(20, 0, 4)],
			sectionStart: 0,
			sectionEnd: 20,
			sectionStep: 10,
			zRange: 12,
		});

		expect(frames).toHaveLength(3);
		expect(frames[1].position.toArray()).toEqual([10, 0, 4]);
		expect(frames[1].corners.map((corner) => corner.toArray())).toEqual([
			[10, -6, 4],
			[10, 6, 4],
			[10, 6, 16],
			[10, -6, 16],
		]);
	});

	test("rejects a station range beyond the three-dimensional axis length", () => {
		const frames = buildCrossSectionPreviewFrames({
			axisPoints: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0)],
			sectionStart: 0,
			sectionEnd: 6,
			sectionStep: 1,
			zRange: 10,
		});

		expect(frames).toEqual([]);
	});

	test("continues mileage across multiple axis paths without adding a connector segment", () => {
		const frames = buildCrossSectionPreviewFrames({
			axisPaths: [
				[new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
				[new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0)],
			],
			sectionStart: 0,
			sectionEnd: 20,
			sectionStep: 10,
			zRange: 10,
		});

		expect(frames).toHaveLength(3);
		expect(frames.at(-1).position.toArray()).toEqual([20, 0, 0]);
	});

	test("extrudes the selected cross-section square by its configured thickness", () => {
		const [frame] = buildCrossSectionPreviewFrames({
			axisPoints: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
			sectionStart: 0,
			sectionEnd: 0,
			sectionStep: 1,
			zRange: 8,
		});
		const volume = buildCrossSectionPreviewVolume(frame, 2);

		expect(volume.leadingCorners[0].toArray()).toEqual([1, -4, 0]);
		expect(volume.trailingCorners[0].toArray()).toEqual([-1, -4, 0]);
	});

	test("uses only the representative local vertical envelope for the shared square size", () => {
		const frameSideLength = estimateCrossSectionFrameSideLength([
			new THREE.Vector3(0, -4, 0),
			new THREE.Vector3(0, 4, 0),
			new THREE.Vector3(0, -4, 6),
			new THREE.Vector3(0, 4, 6),
		]);

		expect(frameSideLength).toBeCloseTo(6.6);
	});

	test("keeps markers visible when representative profile lookup is unavailable", () => {
		const axisUuid = "axis-1";
		let didRequestProfile = false;
		let profileDepth = null;
		const viewer = {
			addEventListener: () => {},
			removeEventListener: () => {},
			renderer: {
				getSize: (target) => target.set(800, 600),
				render: () => {},
			},
			scene: {
				getActiveCamera: () => new THREE.PerspectiveCamera(),
				getBoundingBox: () => new THREE.Box3(
					new THREE.Vector3(-10, -10, 0),
					new THREE.Vector3(10, 10, 10),
				),
				measurements: [{
					uuid: axisUuid,
					getRenderablePaths: () => [{
						points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
					}],
				}],
				pointclouds: [{
					getPointsInProfile: (_profile, maxDepth) => {
						didRequestProfile = true;
						profileDepth = maxDepth;
						throw new Error("Profile lookup is unavailable");
					},
					position: new THREE.Vector3(),
				}],
			},
		};
		const tool = new CrossSectionPreviewTool(viewer);

		expect(() => tool.setPreview({
			axisUuid,
			sectionEnd: 10,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		})).not.toThrow();
		expect(didRequestProfile).toBe(true);
		expect(profileDepth).toBe(3);
		expect(tool.group.children.length).toBeGreaterThan(0);
		tool.dispose();
	});

	test("waits for the local envelope before showing red frames and restores the axis color", () => {
		const axisUuid = "axis-2";
		const originalAxisColor = 0x123456;
		const originalLineColor = 0x654321;
		let profileCallbacks = null;
		const axis = {
			uuid: axisUuid,
			color: new THREE.Color(originalAxisColor),
			line: {material: {color: new THREE.Color(originalLineColor)}},
			getRenderablePaths: () => [{
				points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
			}],
		};
		const viewer = {
			addEventListener: () => {},
			removeEventListener: () => {},
			renderer: {
				getSize: (target) => target.set(800, 600),
				render: () => {},
			},
			scene: {
				getActiveCamera: () => new THREE.PerspectiveCamera(),
				getBoundingBox: () => new THREE.Box3(
					new THREE.Vector3(-10, -10, 0),
					new THREE.Vector3(10, 10, 10),
				),
				measurements: [axis],
				pointclouds: [{
					getPointsInProfile: (_profile, _maxDepth, callbacks) => {
						profileCallbacks = callbacks;
						return {cancel: () => {}};
					},
					position: new THREE.Vector3(),
				}],
			},
		};
		const tool = new CrossSectionPreviewTool(viewer);

		tool.setPreview({
			axisUuid,
			sectionEnd: 10,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		});
		expect(tool.group.children).toHaveLength(0);
		expect(axis.color.getHex()).toBe(0xfacc15);
		expect(axis.line.material.color.getHex()).toBe(0xfacc15);

		profileCallbacks.onProgress({points: {segments: [{points: {data: {position: new Float32Array([
			10, -4, 0,
			10, 4, 0,
			10, -4, 6,
			10, 4, 6,
		])}}}]}});
		profileCallbacks.onFinish();

		expect(tool.group.children.length).toBeGreaterThan(0);
		expect(tool.group.children[0].material.color.getHex()).toBe(0xf25f5f);
		expect(tool.group.children[1].material.color.getHex()).toBe(0xef4444);
		tool.clear();
		expect(axis.color.getHex()).toBe(originalAxisColor);
		expect(axis.line.material.color.getHex()).toBe(originalLineColor);
		tool.dispose();
	});

	test("renders markers in Potree's three-dimensional overlay pass", () => {
		const source = readFileSync("src/utils/CrossSectionPreviewTool.js", "utf8");

		expect(source).toContain("render.pass.perspective_overlay");
		expect(source).toContain("this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera())");
	});
});
