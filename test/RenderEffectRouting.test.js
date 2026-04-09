import * as THREE from "../libs/three.js/build/three.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer as PotreeGLRenderer } from "../src/PotreeRenderer.js";
import { PointCloudTree } from "../src/PointCloudTree.js";
import { EDLRenderer } from "../src/viewer/EDLRenderer.js";
import { HQSplatRenderer } from "../src/viewer/HQSplatRenderer.js";
import { PotreeRenderer as ViewerPotreeRenderer } from "../src/viewer/PotreeRenderer.js";
import { Utils } from "../src/utils.js";

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

function createHQEffectMaterialStub() {
	return {
		uniforms: {
			uNear: { value: 0 },
			uFar: { value: 0 },
			uXrayUseDistanceRamp: { value: 1 },
			uXrayMultiOpacity: { value: 0.01 },
			cameraPosition: { value: null },
		},
		get uXrayUseDistanceRamp() {
			return this.uniforms.uXrayUseDistanceRamp.value;
		},
		set uXrayUseDistanceRamp(value) {
			this.uniforms.uXrayUseDistanceRamp.value = value;
		},
		get uXrayMultiOpacity() {
			return this.uniforms.uXrayMultiOpacity.value;
		},
		set uXrayMultiOpacity(value) {
			this.uniforms.uXrayMultiOpacity.value = value;
		},
		set uNear(value) {
			this.uniforms.uNear.value = value;
		},
		set uFar(value) {
			this.uniforms.uFar.value = value;
		},
		set cameraPosition(value) {
			this.uniforms.cameraPosition.value = value;
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
	});

	it("HQ 渲染器应分别为普通组和 EDL 组执行独立 pass", () => {
		const pc1 = createPointcloud("pc1", { edlEnabled: true });
		const pc2 = createPointcloud("pc2");
		const viewer = createViewerForEffectRender([pc1, pc2], "group");
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
		renderer._prepareEffectMaterials = vi.fn();

		renderer.render({ camera: createCamera() });

		expect(renderer._renderPointcloudGroup).toHaveBeenCalledTimes(2);
		expect(renderer._renderPointcloudGroup.mock.calls[0][0].pointclouds).toEqual([pc2]);
		expect(renderer._renderPointcloudGroup.mock.calls[1][0].pointclouds).toEqual([pc1]);
		expect(renderer._renderNormalizationPass).toHaveBeenCalledTimes(2);
		expect(renderer._renderNormalizationPass.mock.calls[0][0].useEDL).toBe(false);
		expect(renderer._renderNormalizationPass.mock.calls[1][0].useEDL).toBe(true);
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

	it("HQ XRAY 材质准备阶段应同步动态透明度到双 pass 材质", () => {
		const pc = createPointcloud("pc", {
			xrayEnabled: true,
			xrayTopViewBaseDistance: Math.sqrt(75),
		});
		pc.maxLevel = 2;
		pc.pointCount = 30;
		pc.material = {
			opacity: 1,
			size: 1,
			minSize: 2,
			maxSize: 50,
			pointSizeType: 0,
			visibleNodesTexture: {},
			classification: {},
			uniforms: {
				classificationLUT: { value: { image: { data: new Uint8Array(4) } } },
				uFilterReturnNumberRange: { value: [0, 7] },
				uFilterNumberOfReturnsRange: { value: [0, 7] },
				uFilterGPSTimeClipRange: { value: [0, 7] },
				uFilterPointSourceIDClipRange: { value: [0, 65535] },
			},
			clipTask: 0,
			clipMethod: 0,
			clipBoxes: [],
			clipPolygons: [],
		};
		const viewer = createViewerForEffectRender([pc, createPointcloud("pc2")], "group");
		const renderer = new HQSplatRenderer(viewer);
		const originalMaterials = new Map();
		renderer.attributeMaterials.set(pc, createHQEffectMaterialStub());
		renderer.depthMaterials.set(pc, createHQEffectMaterialStub());

		renderer._prepareEffectMaterials(pc, createCamera(), true, originalMaterials);

		expect(renderer.attributeMaterials.get(pc).uXrayUseDistanceRamp).toBe(0);
		expect(renderer.attributeMaterials.get(pc).uXrayMultiOpacity).toBeCloseTo(0.0245);
		expect(renderer.depthMaterials.get(pc).uXrayMultiOpacity).toBeCloseTo(0.0245);
	});
});
