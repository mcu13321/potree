import * as THREE from "../libs/three.js/build/three.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer as PotreeGLRenderer } from "../src/PotreeRenderer.js";
import { PointCloudTree } from "../src/PointCloudTree.js";
import { EDLRenderer } from "../src/viewer/EDLRenderer.js";
import { HQSplatRenderer } from "../src/viewer/HQSplatRenderer.js";
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
			spacing: 1,
		},
		material: {},
	};
}

function createCamera() {
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	camera.position.set(10, 10, 10);
	return camera;
}

function createViewerForEffectRender(pointclouds) {
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
		scene: {
			pointclouds,
			scenePointCloud: {},
			scene: {
				traverse: vi.fn(),
			},
			sceneBG: {},
			cameraBG: {},
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
		const viewer = createViewerForEffectRender([pc1, pc2]);
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

		expect(renderer._renderRegularPointclouds).toHaveBeenCalledWith([pc2], expect.anything(), 2);
		expect(renderer._renderEDLPointclouds).toHaveBeenCalledWith([pc1], expect.anything(), 800, 600, []);
	});

	it("HQ 渲染器应分别为普通组与 EDL 组执行独立 pass", () => {
		const pc1 = createPointcloud("pc1", { edlEnabled: true });
		const pc2 = createPointcloud("pc2");
		const viewer = createViewerForEffectRender([pc1, pc2]);
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
});
