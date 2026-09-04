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
					baseUrl: "project/main",
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
			mainPointCloudBaseUrl: "project/main",
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

	test("shows fallback frames immediately, refines their size, and restores the axis color", () => {
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
					baseUrl: "project/main",
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
			mainPointCloudBaseUrl: "project/main",
			sectionEnd: 10,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		});
		expect(tool.frameSideLength).toBeNull();
		expect(tool.group.children.length).toBeGreaterThan(0);
		expect(axis.color.getHex()).toBe(0xfacc15);
		expect(axis.line.material.color.getHex()).toBe(0xfacc15);

		profileCallbacks.onProgress({points: {segments: [{points: {data: {position: new Float32Array([
			10, -4, 0,
			10, 4, 0,
			10, -4, 6,
			10, 4, 6,
		])}}}]}});
		profileCallbacks.onFinish();

		expect(tool.frameSideLength).toBeCloseTo(6.6);
		expect(tool.group.children.length).toBeGreaterThan(0);
		expect(tool.group.children[0].material.color.getHex()).toBe(0xf25f5f);
		expect(tool.group.children[1].material.color.getHex()).toBe(0xef4444);
		tool.clear();
		expect(axis.color.getHex()).toBe(originalAxisColor);
		expect(axis.line.material.color.getHex()).toBe(originalLineColor);
		tool.dispose();
	});

	test("uses only the axis-owned main point cloud for bounds and local envelope sizing", () => {
		const axisUuid = "axis-main";
		let mainCallbacks = null;
		const requestCounts = {main: 0, other: 0, section: 0};
		const mainPointcloud = {
			baseUrl: "project\\main\\",
			getPointsInProfile: (_profile, _maxDepth, callbacks) => {
				requestCounts.main++;
				mainCallbacks = callbacks;
				return {cancel: () => {}};
			},
			position: new THREE.Vector3(),
		};
		const otherPointcloud = {
			baseUrl: "project/other",
			getPointsInProfile: () => {
				requestCounts.other++;
			},
			position: new THREE.Vector3(),
		};
		const sectionPointcloud = {
			baseUrl: "project/sections/K0+100",
			getPointsInProfile: () => {
				requestCounts.section++;
			},
			position: new THREE.Vector3(),
		};
		const boundingBoxInputs = [];
		const viewer = {
			addEventListener: () => {},
			removeEventListener: () => {},
			renderer: {
				getSize: (target) => target.set(800, 600),
				render: () => {},
			},
			scene: {
				getActiveCamera: () => new THREE.PerspectiveCamera(),
				getBoundingBox: (pointclouds) => {
					boundingBoxInputs.push(pointclouds);
					return new THREE.Box3(
						new THREE.Vector3(-20, -20, 0),
						new THREE.Vector3(20, 20, 100),
					);
				},
				measurements: [{
					uuid: axisUuid,
					getRenderablePaths: () => [{
						points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)],
					}],
				}],
				pointclouds: [otherPointcloud, sectionPointcloud, mainPointcloud],
			},
		};
		const tool = new CrossSectionPreviewTool(viewer);

		tool.setPreview({
			axisUuid,
			mainPointCloudBaseUrl: "project/main/",
			sectionEnd: 20,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		});

		expect(requestCounts).toEqual({main: 1, other: 0, section: 0});
		expect(tool.frameSideLength).toBeNull();
		expect(tool.group.children.length).toBeGreaterThan(0);
		expect(boundingBoxInputs.length).toBeGreaterThan(0);
		expect(boundingBoxInputs.every(
			(pointclouds) => pointclouds.length === 1 && pointclouds[0] === mainPointcloud,
		)).toBe(true);

		mainCallbacks.onProgress({points: {segments: [{points: {data: {position: new Float32Array([
			0, -5, 0,
			0, 5, 0,
			0, -5, 10,
			0, 5, 10,
		])}}}]}});
		mainCallbacks.onFinish();

		expect(tool.frameSideLength).toBeCloseTo(11);
		expect(tool.group.children.length).toBeGreaterThan(0);
		tool.dispose();
	});

	test("does not borrow an axis or point cloud when the exact preview resources are unavailable", () => {
		let profileRequests = 0;
		let boundingBoxRequests = 0;
		const fallbackAxis = {
			uuid: "fallback-axis",
			isCadVector: true,
			vectorType: "axisLine",
			color: new THREE.Color(0x123456),
			getRenderablePaths: () => [{
				points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)],
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
				getBoundingBox: () => {
					boundingBoxRequests++;
					return new THREE.Box3(
						new THREE.Vector3(-10, -10, 0),
						new THREE.Vector3(10, 10, 10),
					);
				},
				measurements: [fallbackAxis],
				pointclouds: [{
					baseUrl: "project/other",
					getPointsInProfile: () => {
						profileRequests++;
					},
				}],
			},
		};
		const tool = new CrossSectionPreviewTool(viewer);

		tool.setPreview({
			axisUuid: "missing-axis",
			mainPointCloudBaseUrl: "project/missing",
			sectionEnd: 20,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		});

		expect(profileRequests).toBe(0);
		expect(boundingBoxRequests).toBe(0);
		expect(tool.group.children).toHaveLength(0);
		expect(fallbackAxis.color.getHex()).toBe(0x123456);
		tool.dispose();
	});

	test("cancels the previous envelope request when the main point cloud changes", () => {
		const axisUuid = "axis-switch";
		let cancelledMainA = 0;
		let requestedMainB = 0;
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
						points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)],
					}],
				}],
				pointclouds: [{
					baseUrl: "project/main-a",
					getPointsInProfile: () => ({cancel: () => cancelledMainA++}),
				}, {
					baseUrl: "project/main-b",
					getPointsInProfile: () => {
						requestedMainB++;
						return {cancel: () => {}};
					},
				}],
			},
		};
		const tool = new CrossSectionPreviewTool(viewer);
		const preview = {
			axisUuid,
			sectionEnd: 20,
			sectionStart: 0,
			sectionStep: 10,
			sectionThickness: 0.2,
		};

		tool.setPreview({...preview, mainPointCloudBaseUrl: "project/main-a"});
		tool.setPreview({...preview, mainPointCloudBaseUrl: "project/main-b"});

		expect(cancelledMainA).toBe(1);
		expect(requestedMainB).toBe(1);
		tool.dispose();
	});

	test("renders markers in Potree's three-dimensional overlay pass", () => {
		const source = readFileSync("src/utils/CrossSectionPreviewTool.js", "utf8");
		const viewerSource = readFileSync("src/viewer/viewer.js", "utf8");

		expect(source).toContain("render.pass.perspective_overlay");
		expect(source).toContain("this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera())");
		expect(source).not.toContain("this.viewer.fitToScreen");
		expect(viewerSource).toContain("this.crossSectionPreviewTool?.getPreviewPointclouds?.()");
	});
});
