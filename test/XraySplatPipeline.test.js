import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {Shaders} from "../build/shaders/shaders.js";
import {Utils} from "../src/utils.js";
import {
	isXraySplatPipelineSupported,
	XraySplatPipeline,
} from "../src/viewer/XraySplatPipeline.js";

function createRendererMock(){
	const clearColor = new THREE.Color(0x123456);
	return {
		getContext: vi.fn(() => ({
			ONE: 1,
			getExtension: vi.fn(() => ({})),
		})),
		getRenderTarget: vi.fn(() => null),
		setRenderTarget: vi.fn(),
		setClearColor: vi.fn(),
		getClearColor: vi.fn(target => target.copy(clearColor)),
		getClearAlpha: vi.fn(() => 1),
		clear: vi.fn(),
	};
}

function createTarget(width = 1024, height = 1024){
	return {
		width,
		height,
		texture: {},
		depthTexture: {},
		setSize: vi.fn(function(nextWidth, nextHeight){
			this.width = nextWidth;
			this.height = nextHeight;
		}),
		dispose: vi.fn(),
	};
}

function createPassMaterial(){
	return {
		uniforms: {
			visibleNodes: {value: null},
			octreeSize: {value: 0},
			classificationLUT: {value: {image: {data: null}}},
			uFilterReturnNumberRange: {value: null},
			uFilterNumberOfReturnsRange: {value: null},
			uFilterGPSTimeClipRange: {value: null},
			uFilterPointSourceIDClipRange: {value: null},
		},
		classificationTexture: {needsUpdate: false},
		setClipBoxes: vi.fn(),
		setClipPolygons: vi.fn(),
		dispose: vi.fn(),
	};
}

function createPointcloud(){
	const color = new THREE.Color(0x123456);
	const material = {
		opacity: 1,
		size: 1,
		minSize: 2,
		maxSize: 50,
		pointSizeType: 0,
		activeAttributeName: "rgba",
		visibleNodesTexture: {},
		classification: {},
		elevationGradientRepeat: 0,
		elevationRange: [0, 10],
		gradient: "gradient",
		matcap: "matcap",
		intensityRange: [0, 255],
		intensityGamma: 1,
		intensityContrast: 0,
		intensityBrightness: 0,
		rgbGamma: 1,
		rgbContrast: 0,
		rgbBrightness: 0,
		weightRGB: 1,
		weightIntensity: 0,
		weightElevation: 0,
		weightClassification: 0,
		weightReturnNumber: 0,
		weightSourceID: 0,
		color,
		uniforms: {
			classificationLUT: {value: {image: {data: new Uint8Array(4)}}},
			uFilterReturnNumberRange: {value: [0, 7]},
			uFilterNumberOfReturnsRange: {value: [0, 7]},
			uFilterGPSTimeClipRange: {value: [0, 7]},
			uFilterPointSourceIDClipRange: {value: [0, 65535]},
		},
		clipTask: 0,
		clipMethod: 0,
		clipBoxes: [],
		clipPolygons: [],
	};

	return {
		visible: true,
		userData: {
			xrayEnabled: true,
			xrayOpacity: 0.5,
			xrayTopViewBaseDistance: Math.sqrt(75),
		},
		pointCount: 30,
		material,
		pcoGeometry: {
			boundingBox: new THREE.Box3(
				new THREE.Vector3(0, 0, 0),
				new THREE.Vector3(10, 10, 10)
			),
			spacing: 1,
		},
	};
}

function createPipelineHarness(){
	const renderer = createRendererMock();
	const viewer = {
		renderer,
		pRenderer: {render: vi.fn()},
		isEDLSupported: vi.fn(() => true),
		treemindPointCloudSourceMode: {sourceKind: "group"},
		scene: {
			scenePointCloud: {},
			volumes: [],
			getBoundingBox: vi.fn(pointclouds => pointclouds[0].pcoGeometry.boundingBox),
		},
	};
	const pipeline = new XraySplatPipeline(viewer);
	pipeline.frontTarget = createTarget();
	pipeline.accumulationTarget = createTarget();
	pipeline.resolveMaterial = {
		uniforms: {
			uDepthMap: {value: null},
			uAccumulationMap: {value: null},
			uFrontColorMap: {value: null},
			uDensityScale: {value: 0},
			uMaxOpacity: {value: 0},
			uFrontDetailStrength: {value: 0},
			uColorGamma: {value: 0},
		},
		dispose: vi.fn(),
	};
	return {pipeline, viewer};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("XraySplatPipeline", () => {
	it("keeps the shader contracts for view-space distance and premultiplied resolve", () => {
		expect(Shaders["pointcloud.vs"]).toContain("vDistance = length(mvPosition.xyz)");
		expect(Shaders["pointcloud.fs"]).toContain("#if defined(xray_front_pass)");
		expect(Shaders["pointcloud.fs"]).toContain("color * frontCoverage");
		expect(Shaders["normalize_xray.fs"]).toContain("accumulation.rgb / accumulation.a");
		expect(Shaders["normalize_xray.fs"]).toContain("uFrontDetailStrength");
	});

	it("detects the required WebGL1 and WebGL2 capabilities", () => {
		const webgl1 = {
			capabilities: {isWebGL2: false},
			getContext: () => ({getExtension: name => ({
				WEBGL_depth_texture: {},
				OES_texture_float: {},
				WEBGL_color_buffer_float: {},
			})[name] || null}),
		};
		const unsupported = {
			capabilities: {isWebGL2: false},
			getContext: () => ({getExtension: () => null}),
		};
		const webgl2 = {
			capabilities: {isWebGL2: true},
			getContext: () => ({getExtension: name => name === "EXT_color_buffer_float" ? {} : null}),
		};

		expect(isXraySplatPipelineSupported(webgl1)).toBe(true);
		expect(isXraySplatPipelineSupported(unsupported)).toBe(false);
		expect(isXraySplatPipelineSupported(webgl2)).toBe(true);
	});

	it("renders front and accumulation passes and restores the source material", () => {
		const {pipeline, viewer} = createPipelineHarness();
		const pointcloud = createPointcloud();
		const sourceMaterial = pointcloud.material;
		const frontMaterial = createPassMaterial();
		const accumulationMaterial = createPassMaterial();
		pipeline.frontMaterials.set(pointcloud, frontMaterial);
		pipeline.accumulationMaterials.set(pointcloud, accumulationMaterial);

		pipeline.renderToTargets({
			pointclouds: [pointcloud],
			originalMaterials: new Map([[pointcloud, sourceMaterial]]),
			camera: {position: new THREE.Vector3(10, 10, 10)},
			width: 800,
			height: 600,
		});

		expect(viewer.pRenderer.render).toHaveBeenCalledTimes(2);
		expect(viewer.pRenderer.render.mock.calls[0][2]).toBe(pipeline.frontTarget);
		expect(viewer.pRenderer.render.mock.calls[1][2]).toBe(pipeline.accumulationTarget);
		expect(viewer.pRenderer.render.mock.calls[1][3]).toMatchObject({
			blendFunc: [1, 1],
			depthTest: false,
			depthWrite: false,
		});
		expect(frontMaterial.activeAttributeName).toBe("rgba");
		expect(frontMaterial.color).toBe(sourceMaterial.color);
		expect(accumulationMaterial.uXrayUseDistanceRamp).toBe(0);
		expect(accumulationMaterial.uXrayMultiOpacity).toBeCloseTo(0.0245);
		expect(pointcloud.material).toBe(sourceMaterial);
		expect(pipeline.frontTarget.setSize).toHaveBeenCalledWith(800, 600);
		expect(pipeline.accumulationTarget.setSize).toHaveBeenCalledWith(800, 600);

		pipeline._resize(800, 600);
		expect(pipeline.frontTarget.setSize).toHaveBeenCalledTimes(1);
		expect(pipeline.accumulationTarget.setSize).toHaveBeenCalledTimes(1);
	});

	it("restores source materials when a point pass fails", () => {
		const {pipeline, viewer} = createPipelineHarness();
		const pointcloud = createPointcloud();
		const sourceMaterial = pointcloud.material;
		pipeline.frontMaterials.set(pointcloud, createPassMaterial());
		pipeline.accumulationMaterials.set(pointcloud, createPassMaterial());
		viewer.pRenderer.render.mockImplementation(() => {
			throw new Error("render failed");
		});

		expect(() => pipeline.renderToTargets({
			pointclouds: [pointcloud],
			originalMaterials: new Map([[pointcloud, sourceMaterial]]),
			camera: {position: new THREE.Vector3(10, 10, 10)},
			width: 800,
			height: 600,
		})).toThrow("render failed");
		expect(pointcloud.material).toBe(sourceMaterial);
	});

	it("binds target textures and normalized settings during resolve", () => {
		const {pipeline, viewer} = createPipelineHarness();
		vi.spyOn(Utils.screenPass, "render").mockImplementation(() => {});
		const settings = {
			densityScale: 2,
			maxOpacity: 0.85,
			frontDetailStrength: 0.35,
			colorGamma: 0.55,
		};

		pipeline.resolve(settings);

		const uniforms = pipeline.resolveMaterial.uniforms;
		expect(uniforms.uDepthMap.value).toBe(pipeline.frontTarget.depthTexture);
		expect(uniforms.uFrontColorMap.value).toBe(pipeline.frontTarget.texture);
		expect(uniforms.uAccumulationMap.value).toBe(pipeline.accumulationTarget.texture);
		expect(uniforms.uDensityScale.value).toBe(2);
		expect(Utils.screenPass.render).toHaveBeenCalledWith(viewer.renderer, pipeline.resolveMaterial);
	});

	it("prunes removed point clouds and disposes all owned resources", () => {
		const {pipeline} = createPipelineHarness();
		const retained = createPointcloud();
		const removed = createPointcloud();
		const retainedFront = createPassMaterial();
		const removedFront = createPassMaterial();
		const retainedAccumulation = createPassMaterial();
		const removedAccumulation = createPassMaterial();
		pipeline.frontMaterials.set(retained, retainedFront);
		pipeline.frontMaterials.set(removed, removedFront);
		pipeline.accumulationMaterials.set(retained, retainedAccumulation);
		pipeline.accumulationMaterials.set(removed, removedAccumulation);

		pipeline.prune([retained]);

		expect(removedFront.dispose).toHaveBeenCalledTimes(1);
		expect(removedAccumulation.dispose).toHaveBeenCalledTimes(1);
		expect(pipeline.frontMaterials.has(retained)).toBe(true);
		expect(pipeline.accumulationMaterials.has(retained)).toBe(true);

		const frontTarget = pipeline.frontTarget;
		const accumulationTarget = pipeline.accumulationTarget;
		const resolveMaterial = pipeline.resolveMaterial;
		pipeline.dispose();

		expect(retainedFront.dispose).toHaveBeenCalledTimes(1);
		expect(retainedAccumulation.dispose).toHaveBeenCalledTimes(1);
		expect(frontTarget.dispose).toHaveBeenCalledTimes(1);
		expect(accumulationTarget.dispose).toHaveBeenCalledTimes(1);
		expect(resolveMaterial.dispose).toHaveBeenCalledTimes(1);
		expect(pipeline.frontTarget).toBeNull();
	});
});
