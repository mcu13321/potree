import * as THREE from "../libs/three.js/build/three.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer as PotreeGLRenderer } from "../src/PotreeRenderer.js";
import { PointCloudTree } from "../src/PointCloudTree.js";
import { EDLRenderer } from "../src/viewer/EDLRenderer.js";
import { HQSplatRenderer } from "../src/viewer/HQSplatRenderer.js";
import { PotreeRenderer as ViewerPotreeRenderer } from "../src/viewer/PotreeRenderer.js";
import { Utils } from "../src/utils.js";
import { NormalizationEDLMaterial } from "../src/materials/NormalizationEDLMaterial.js";

function createRendererMock() {
	return {
		getContext: vi.fn(() => ({
			SRC_ALPHA: 1,
			ONE: 1,
			activeTexture: vi.fn(),
			bindTexture: vi.fn(),
			bindBuffer: vi.fn(),
			bindVertexArray: vi.fn(),
		})),
		getSize: vi.fn((target) => target.set(800, 600)),
		getRenderTarget: vi.fn(() => null),
		setRenderTarget: vi.fn(),
		setClearColor: vi.fn(),
		clear: vi.fn(),
		clearDepth: vi.fn(),
		render: vi.fn(),
		resetState: vi.fn(),
		setViewport: vi.fn(),
	};
}

function createPointcloud(id, userData = {}) {
	return {
		name: id,
		visible: true,
		userData: { ...userData },
		pcoGeometry: {
			boundingBox: new THREE.Box3(
				new THREE.Vector3(0, 0, 0),
				new THREE.Vector3(10, 10, 10)
			),
			nodes: {
				r: { level: 0 },
				r1234: { level: 4 },
			},
			spacing: 1,
		},
		visibleNodes: [
			{ getLevel: () => 3 },
		],
		material: {},
	};
}

function createCamera() {
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	camera.position.set(10, 10, 10);
	return camera;
}

function createViewerForEffectRender(pointclouds, sourceKind = "single") {
	const renderer = createRendererMock();
	const pRenderer = {
		threeRenderer: renderer,
		render: vi.fn(),
	};

	return {
		renderer,
		pRenderer,
		dispatchEvent: vi.fn(),
		isEDLSupported: vi.fn(() => true),
		background: "black",
		edlStrength: 0.4,
		edlRadius: 1.4,
		edlOpacity: 1.0,
		// 测试中显式指定来源模式，避免再依赖点云数量推断。
		treemindPointCloudSourceMode: { sourceKind },
		scene: {
			pointclouds,
			treemindPointCloudSourceMode: { sourceKind },
			scenePointCloud: {},
			scene: {
				traverse: vi.fn(),
			},
			sceneBG: {},
			cameraBG: {},
			cameraScreenSpace: {},
			getActiveCamera: () => createCamera(),
			volumes: [],
			getBoundingBox: vi.fn(() => new THREE.Box3(
				new THREE.Vector3(0, 0, 0),
				new THREE.Vector3(10, 10, 10)
			)),
		},
		transformationTool: {
			update: vi.fn(),
			scene: {},
		},
		controls: {
			sceneControls: {},
		},
		clippingTool: {
			update: vi.fn(),
			sceneMarker: {},
			sceneVolume: {},
		},
		navigationCube: {
			width: 120,
			camera: {},
		},
		shadowTestCam: {
			updateMatrixWorld: vi.fn(),
			matrixWorld: new THREE.Matrix4(),
			matrixWorldInverse: new THREE.Matrix4(),
			updateProjectionMatrix: vi.fn(),
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Render effect routing", () => {
	it("底层 Renderer 应只渲染指定的点云子集", () => {
		const threeRenderer = createRendererMock();
		const renderer = new PotreeGLRenderer(threeRenderer);
		const scene = new THREE.Scene();
		const pc1 = new PointCloudTree();
		const pc2 = new PointCloudTree();
		pc1.visibleNodes = [];
		pc2.visibleNodes = [];
		scene.add(pc1);
		scene.add(pc2);

		const renderOctreeSpy = vi.spyOn(renderer, "renderOctree").mockImplementation(() => {});

		renderer.render(scene, createCamera(), null, {
			pointclouds: [pc2],
		});

		expect(renderOctreeSpy).toHaveBeenCalledTimes(1);
		expect(renderOctreeSpy.mock.calls[0][0]).toBe(pc2);
	});

	it("标准 EDL 渲染器应将普通点云与 EDL 点云分别分组渲染", () => {
		const pc1 = createPointcloud("pc1", { edlEnabled: true });
		const pc2 = createPointcloud("pc2");
		const viewer = createViewerForEffectRender([pc1, pc2], "group");
		const renderer = new EDLRenderer(viewer);

		renderer.initEDL = vi.fn(() => {
			renderer.edlMaterial = {
				uniforms: {
					screenWidth: { value: 0 },
					screenHeight: { value: 0 },
					uNear: { value: 0 },
					uFar: { value: 0 },
					uEDLColor: { value: null },
					uEDLDepth: { value: null },
					// Mirror the projection contract used by the real EDL material.
					uUseOrthographicCamera: { value: false },
					uOrthographicHeight: { value: 1 },
					uProj: { value: null },
					edlStrength: { value: 0 },
					radius: { value: 0 },
					opacity: { value: 0 },
				},
			};
			renderer.rtEDL = {
				texture: "edl-color",
				depthTexture: "edl-depth",
				setSize: vi.fn(),
			};
			renderer.rtRegular = {
				setSize: vi.fn(),
			};
		});
		renderer.renderShadowMap = vi.fn();
		renderer._renderRegularPointclouds = vi.fn();
		renderer._renderEDLPointclouds = vi.fn();
		vi.spyOn(Utils.screenPass, "render").mockImplementation(() => {});

		renderer.render({ camera: createCamera() });

		expect(renderer._renderRegularPointclouds).toHaveBeenCalledWith([pc2], expect.anything(), true);
		expect(renderer._renderEDLPointclouds).toHaveBeenCalledWith([pc1], expect.anything(), 800, 600, []);
		// An offscreen orthographic camera must override the active perspective camera.
		const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, -100, 100);
		camera.zoom = 2;
		renderer.render({ camera, offscreen: true });
		expect(renderer.edlMaterial.uniforms.uUseOrthographicCamera.value).toBe(true);
		expect(renderer.edlMaterial.uniforms.uOrthographicHeight.value).toBe(8);
		renderer.render({ camera: createCamera(), offscreen: true });
		expect(renderer.edlMaterial.uniforms.uUseOrthographicCamera.value).toBe(false);
	});

	// Exercise actual HQ uniforms rather than a mocked normalization pass.
	it("HQ EDL follows the supplied camera and zoom across projection switches", () => {
		const renderer = new HQSplatRenderer(createViewerForEffectRender([]));
		renderer.normalizationEDLMaterial = new NormalizationEDLMaterial();
		vi.spyOn(Utils.screenPass, "render").mockImplementation(() => {});
		const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, -100, 100);
		camera.zoom = 4;
		const params = {rtDepth: {texture: {}}, rtAttribute: {texture: {}, depthTexture: {}}, width: 800, height: 600, useEDL: true, camera};
		renderer._renderNormalizationPass(params);
		const uniforms = renderer.normalizationEDLMaterial.uniforms;
		expect(uniforms.uUseOrthographicCamera.value).toBe(true);
		expect(uniforms.uOrthographicHeight.value).toBe(4);
		renderer._renderNormalizationPass({...params, camera: createCamera()});
		expect(uniforms.uUseOrthographicCamera.value).toBe(false);
		expect(uniforms.uOrthographicHeight.value).toBe(1);
	});

	it("HQ 渲染器应编排普通、XRAY 和 EDL 独立 pass", () => {
		const pc1 = createPointcloud("pc1", { edlEnabled: true });
		const pc2 = createPointcloud("pc2");
		const pc3 = createPointcloud("pc3", { xrayEnabled: true });
		const viewer = createViewerForEffectRender([pc1, pc2, pc3], "group");
		viewer.getXrayRenderSettings = vi.fn(() => ({
			densityScale: 2,
			maxOpacity: 0.85,
			frontDetailStrength: 0.35,
			colorGamma: 0.55,
		}));
		const renderer = new HQSplatRenderer(viewer);

		renderer.init = vi.fn(() => {
			renderer.initialized = true;
			renderer.normalizationMaterial = {
				uniforms: {
					uWeightMap: { value: null },
					uDepthMap: { value: null },
				},
			};
			renderer.normalizationEDLMaterial = {
				uniforms: {
					edlStrength: { value: 0 },
					radius: { value: 0 },
					screenWidth: { value: 0 },
					screenHeight: { value: 0 },
					uEDLMap: { value: null },
					uWeightMap: { value: null },
					uDepthMap: { value: null },
				},
			};
			renderer.rtDepth = { texture: "depth", depthTexture: "depth-tex", setSize: vi.fn() };
			renderer.rtAttribute = { texture: "attr", depthTexture: "attr-tex", setSize: vi.fn() };
			renderer.rtDepthEDL = { texture: "depth-edl", depthTexture: "depth-edl-tex", setSize: vi.fn() };
			renderer.rtAttributeEDL = { texture: "attr-edl", depthTexture: "attr-edl-tex", setSize: vi.fn() };
		});
		renderer._renderPointcloudGroup = vi.fn();
		renderer._renderBackground = vi.fn();
		renderer._renderNormalizationPass = vi.fn();
		renderer._preparePassMaterials = vi.fn((pointcloud, originals) => {
			originals.set(pointcloud, pointcloud.material);
		});
		renderer.xrayPipeline = {
			prune: vi.fn(),
			renderToTargets: vi.fn(),
			resolve: vi.fn(),
		};

		renderer.render({ camera: createCamera() });

		expect(renderer._renderPointcloudGroup).toHaveBeenCalledTimes(2);
		expect(renderer._renderPointcloudGroup.mock.calls[0][0].pointclouds).toEqual([pc2]);
		expect(renderer._renderPointcloudGroup.mock.calls[1][0].pointclouds).toEqual([pc1]);
		expect(renderer.xrayPipeline.renderToTargets.mock.calls[0][0].pointclouds).toEqual([pc3]);
		expect(renderer.xrayPipeline.resolve).toHaveBeenCalledWith(viewer.getXrayRenderSettings());
		expect(renderer._renderNormalizationPass).toHaveBeenCalledTimes(2);
		expect(renderer._renderNormalizationPass.mock.calls[0][0].useEDL).toBe(false);
		expect(renderer._renderNormalizationPass.mock.calls[1][0].useEDL).toBe(true);
		// Normalization must receive the same camera used by its depth pass.
		expect(renderer._renderNormalizationPass.mock.calls[1][0].camera).toBe(renderer._renderPointcloudGroup.mock.calls[1][0].camera);
	});

	it("标准渲染器应为多点云 XRAY 写入动态透明度", () => {
		const pc1 = createPointcloud("pc1", {
			xrayEnabled: true,
			xrayTopViewBaseDistance: Math.sqrt(75),
		});
		pc1.maxLevel = 2;
		pc1.pointCount = 30;
		pc1.material = { opacity: 1, uniforms: {} };
		const pc2 = createPointcloud("pc2");
		pc2.material = { opacity: 1, uniforms: {} };
		const viewer = createViewerForEffectRender([pc1, pc2], "group");
		const renderer = new ViewerPotreeRenderer(viewer);

		renderer.render({ camera: createCamera() });

		expect(pc1.material.uXrayUseDistanceRamp).toBe(0);
		expect(pc1.material.uXrayMultiOpacity).toBeCloseTo(0.0245);
	});

	it("标准渲染器在 single 模式下应保留 XRAY distance ramp", () => {
		const pc1 = createPointcloud("pc1", {
			xrayEnabled: true,
			xrayTopViewBaseDistance: Math.sqrt(75),
		});
		pc1.maxLevel = 2;
		pc1.material = { opacity: 1, uniforms: {} };
		const pc2 = createPointcloud("pc2");
		pc2.material = { opacity: 1, uniforms: {} };
		const viewer = createViewerForEffectRender([pc1, pc2], "single");
		const renderer = new ViewerPotreeRenderer(viewer);

		renderer.render({ camera: createCamera() });

		expect(pc1.material.uXrayUseDistanceRamp).toBe(1);
	});

	it("restores original materials when an HQ pass fails", () => {
		const pointcloud = createPointcloud("pc");
		const originalMaterial = {name: "original"};
		pointcloud.material = originalMaterial;
		const viewer = createViewerForEffectRender([pointcloud]);
		const renderer = new HQSplatRenderer(viewer);
		renderer.init = vi.fn(() => {
			renderer.initialized = true;
		});
		renderer._ensureStandardTargets = vi.fn(() => {
			renderer.rtDepth = {width: 800, height: 600};
			renderer.rtAttribute = {width: 800, height: 600};
		});
		renderer.clearTargets = vi.fn();
		renderer._preparePassMaterials = vi.fn((pc, originals) => {
			originals.set(pc, pc.material);
			pc.material = {name: "derived"};
		});
		renderer._renderPointcloudGroup = vi.fn(() => {
			throw new Error("HQ pass failed");
		});
		renderer.xrayPipeline = {
			prune: vi.fn(),
			renderToTargets: vi.fn(),
		};

		expect(() => renderer.render({camera: createCamera()})).toThrow("HQ pass failed");
		expect(pointcloud.material).toBe(originalMaterial);
	});

	it("prunes stale HQ materials and disposes renderer-owned resources", () => {
		const retained = createPointcloud("retained");
		const removed = createPointcloud("removed");
		const viewer = createViewerForEffectRender([retained]);
		const renderer = new HQSplatRenderer(viewer);
		const retainedDepth = {dispose: vi.fn()};
		const removedDepth = {dispose: vi.fn()};
		const retainedAttribute = {dispose: vi.fn()};
		const removedAttribute = {dispose: vi.fn()};
		renderer.depthMaterials.set(retained, retainedDepth);
		renderer.depthMaterials.set(removed, removedDepth);
		renderer.attributeMaterials.set(retained, retainedAttribute);
		renderer.attributeMaterials.set(removed, removedAttribute);
		renderer.xrayPipeline = {prune: vi.fn(), dispose: vi.fn()};

		renderer._pruneMaterialCaches([retained]);

		expect(removedDepth.dispose).toHaveBeenCalledTimes(1);
		expect(removedAttribute.dispose).toHaveBeenCalledTimes(1);
		expect(renderer.xrayPipeline.prune).toHaveBeenCalledWith(new Set([retained]));

		const sharedDepthTexture = {};
		renderer.rtDepth = {depthTexture: sharedDepthTexture, dispose: vi.fn()};
		renderer.rtAttribute = {depthTexture: sharedDepthTexture, dispose: vi.fn()};
		renderer.normalizationMaterial = {dispose: vi.fn()};
		renderer.normalizationEDLMaterial = {dispose: vi.fn()};
		renderer.dispose();

		expect(retainedDepth.dispose).toHaveBeenCalledTimes(1);
		expect(retainedAttribute.dispose).toHaveBeenCalledTimes(1);
		expect(renderer.rtDepth).toBeNull();
		expect(renderer.xrayPipeline.dispose).toHaveBeenCalledTimes(1);
	});

});

import {setPointCloudLabelAppearance, setPointCloudAlignmentHidden, setPointCloudStationHidden, getAlignmentPointClouds} from "../src/utils/PointCloudLabelAppearance.js";

describe("label tint at the actual octree draw boundary", () => {
	it("tints color and cached pass materials for both roles, restoring source state after a failed draw", () => {
		const renderer = new PotreeGLRenderer(createRendererMock());
		const pc = createPointcloud("active");
		pc.material = {activeAttributeName: "rgba", color: new THREE.Color(0x123456)};
		setPointCloudLabelAppearance(pc, true);
		const pass = {activeAttributeName: "intensity", color: new THREE.Color(0xabcdef)};
		let expectedRoleColor = 0x0088ff;
		const draw = vi.spyOn(renderer, "renderOctreeWithoutLabelAppearance").mockImplementation((_cloud, _nodes, _camera, _target, params) => {
			const material = params.material || pc.material;
			expect(material.activeAttributeName).toBe("color");
			expect(material.color.getHex()).toBe(expectedRoleColor);
			throw new Error("Draw failed");
		});
		// Solid role tints apply to regular and cached draw materials alike.
		for (const [role, color] of [[true, 0x0088ff], ["secondary", 0xffd400]]) {
			setPointCloudLabelAppearance(pc, role);
			expectedRoleColor = color;
			for (const material of [pc.material, pass]) {
				const attribute = material.activeAttributeName, color = material.color.clone();
				expect(() => renderer.renderOctree(pc, [], createCamera(), null, {material})).toThrow("Draw failed");
				expect(material.activeAttributeName).toBe(attribute);
				expect(material.color.equals(color)).toBe(true);
			}
		}
		expect(draw).toHaveBeenCalledTimes(4);
		setPointCloudLabelAppearance(pc, null);
	});

	it("leaves picking and high-quality/standard depth passes unchanged", () => {
		const renderer = new PotreeGLRenderer(createRendererMock());
		const pc = createPointcloud("active");
		setPointCloudLabelAppearance(pc, true);
		for (const mode of [{activeAttributeName: "indices"}, {activeAttributeName: "depth"}, {activeAttributeName: null, defines: new Map([["depth_pass", "#define hq_depth_pass"]])}]) {
			const material = {...mode, color: new THREE.Color(0x123456)};
			vi.spyOn(renderer, "renderOctreeWithoutLabelAppearance").mockImplementation(() => {
				expect(material.activeAttributeName).toBe(mode.activeAttributeName);
				expect(material.color.getHex()).toBe(0x123456);
			});
			renderer.renderOctree(pc, [], createCamera(), null, {material});
		}
		setPointCloudLabelAppearance(pc, null);
	});

	it("routes both selected roles to Xray and inactive EDL clouds to ordinary rendering", () => {
		const active = createPointcloud("active", {xrayEnabled: true});
		const inactive = createPointcloud("inactive", {edlEnabled: true});
		setPointCloudLabelAppearance(active, true);
		setPointCloudLabelAppearance(inactive, false);
		const renderer = new EDLRenderer(createViewerForEffectRender([active, inactive]));
		expect(renderer._getPointcloudGroups([active, inactive])).toEqual({edlPointclouds: [], regularPointclouds: [active, inactive]});
		// Both roles enable Xray without changing the stored preference.
		for (const role of [true, "secondary"]) {
			setPointCloudLabelAppearance(active, role);
			renderer._configureRegularPointclouds([active, inactive], createCamera(), false);
			expect(active.material.useXRAY).toBe(true);
			expect(inactive.material.useXRAY).toBe(false);
			expect(active.material.useEDL).toBe(false);
			expect(inactive.material.useEDL).toBe(false);
		}
		expect(active.userData.xrayEnabled).toBe(true);
		setPointCloudLabelAppearance(active, null);
		setPointCloudLabelAppearance(inactive, null);
	});
});

// Runtime hiding must protect direct picking draws as well as scene traversal.
it("suppresses hidden alignment clouds without writing their visible flag", () => {
 const renderer = new PotreeGLRenderer(createRendererMock());
 const pc = new PointCloudTree();
 const other = new PointCloudTree();
 const scene = new THREE.Scene();
 scene.add(pc, other);
 const draw = vi.spyOn(renderer, "renderOctreeWithoutLabelAppearance").mockImplementation(() => {});
 setPointCloudAlignmentHidden(pc, true);
 expect(renderer.traverse(scene).octrees).toEqual([other]);
 expect(renderer.traverse(pc).octrees).toEqual([]);
 renderer.renderOctree(pc, [], createCamera(), null, {});
 expect(draw).not.toHaveBeenCalled();
 expect(pc.visible).toBe(true);
 setPointCloudAlignmentHidden(pc, false);
 expect(renderer.traverse(scene).octrees).toContain(pc);
 renderer.renderOctree(pc, [], createCamera(), null, {});
 expect(draw).toHaveBeenCalledTimes(1);
});

// Default LOD updates must retain the same array passed by legacy viewers.
it("suppresses station-hidden scene traversal and direct picking until its owner releases it", () => {
	const renderer = new PotreeGLRenderer(createRendererMock());
	const pc = new PointCloudTree(), owner = {};
	const draw = vi.spyOn(renderer, "renderOctreeWithoutLabelAppearance").mockImplementation(() => {});
	setPointCloudStationHidden(pc, owner, true);
	expect(renderer.traverse(pc).octrees).toEqual([]);
	renderer.renderOctree(pc, [], createCamera(), null, {});
	expect(draw).not.toHaveBeenCalled();
	expect(pc.visible).toBe(true);
	setPointCloudStationHidden(pc, owner, false);
	renderer.renderOctree(pc, [], createCamera(), null, {});
	expect(draw).toHaveBeenCalledOnce();
});

// Default LOD updates must retain the same array passed by legacy viewers.
it("keeps the original LOD array until an alignment cloud is hidden", () => {
	const a = new THREE.Object3D(), b = new THREE.Object3D(), clouds = [a, b];
	expect(getAlignmentPointClouds(clouds)).toBe(clouds);
	setPointCloudAlignmentHidden(a, true);
	try {
		expect(getAlignmentPointClouds(clouds)).toEqual([b]);
		expect(clouds).toEqual([a, b]);
	} finally {setPointCloudAlignmentHidden(a, false);}
	expect(getAlignmentPointClouds(clouds)).toBe(clouds);
});
