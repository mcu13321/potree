import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {PointCloudMaterial} from "../src/materials/PointCloudMaterial.js";
import {Utils} from "../src/utils.js";
import {getPointcloudEffectState} from "../src/viewer/PointcloudEffectUtils.js";
import {setPointCloudLabelAppearance} from "../src/utils/PointCloudLabelAppearance.js";
import {PointcloudOpacityPipeline, partitionPointcloudsByOpacity, renderPointcloudOpacity} from "../src/viewer/PointcloudOpacityPipeline.js";

const owned = [];
afterEach(() => { owned.splice(0).forEach(pipeline => pipeline.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Keep real materials and layer targets while observing the WebGL draw/composite boundary. */
function fixture() {
	// Keep real shader flags and accessors while replacing unrelated browser texture generation.
	vi.spyOn(PointCloudMaterial, "generateGradientTexture").mockReturnValue(new THREE.Texture());
	vi.spyOn(PointCloudMaterial, "generateMatcapTexture").mockReturnValue(new THREE.Texture());
	vi.stubGlobal("Potree", {PointCloudMaterial});
	let currentTarget = {name: "previous"}, clearAlpha = 0.4;
	const clearColor = new THREE.Color(0x123456);
	const renderer = {
		// Exercise the depth-aware compositor used by the project's WebGL2 renderer.
		capabilities: {isWebGL2: true},
		getSize: target => target.set(800, 600),
		getRenderTarget: () => currentTarget,
		setRenderTarget: vi.fn(target => { currentTarget = target; }),
		getClearColor: target => target.copy(clearColor), getClearAlpha: () => clearAlpha,
		setClearColor: vi.fn((color, alpha) => { clearColor.set(color); clearAlpha = alpha; }),
		clear: vi.fn(),
	};
	const viewer = {renderer, scene: {scenePointCloud: {}, volumes: []}, pRenderer: {render: vi.fn()}};
	const clouds = [0, 1].map(() => {
		const material = new PointCloudMaterial();
		Object.assign(material, {useEDL: true, opacity: 0.35, weighted: true, activeAttributeName: "intensity"});
		material.color.setHex(0xabcdef);
		const cloud = {material, userData: {edlEnabled: true}};
		setPointCloudLabelAppearance(cloud, false, {colorEnabled: false, alignmentOpacity: 0.8}, true);
		return cloud;
	});
	const pipeline = new PointcloudOpacityPipeline(viewer);
	owned.push(pipeline);
	const camera = new THREE.PerspectiveCamera();
	const composites = [];
	vi.spyOn(Utils.screenPass, "render").mockImplementation((context, material, target) => {
		composites.push({context, target, opacity: material.uniforms.uOpacity.value, material});
	});
	return {viewer, clouds, pipeline, camera, composites};
}

describe("ordinary whole-layer point-cloud opacity", () => {
	// Use the real screen-pass helper: mocking it hides a framebuffer feedback loop on the main canvas.
	it.each([false, true])("switches from the sampled texture to the actual output before compositing (offscreen=%s)", offscreen => {
		const {viewer, clouds, pipeline, camera} = fixture();
		Utils.screenPass.render.mockRestore();
		const previousTarget = viewer.renderer.getRenderTarget();
		const previousQuadMaterial = Utils.screenPass.screenQuad.material;
		const output = offscreen ? {width: 320, height: 180, texture: {}, depthTexture: {}} : null;
		// Model the bundled Three renderer's target selection while executing the real shared helper.
		viewer.renderer.render = vi.fn((scene, screenCamera, legacyTarget) => {
			if (legacyTarget !== undefined) viewer.renderer.setRenderTarget(legacyTarget);
			expect(screenCamera).toBe(Utils.screenPass.camera);
			expect(viewer.renderer.getRenderTarget()).toBe(output);
			const material = scene.children[0].material;
			expect(output?.texture).not.toBe(material.uniforms.uColor.value);
			expect(output?.depthTexture).not.toBe(material.uniforms.uDepth.value);
		});
		try {
			pipeline.render(clouds, camera, output);
			expect(viewer.renderer.render).toHaveBeenCalledOnce();
			expect(viewer.renderer.getRenderTarget()).toBe(previousTarget);
		} finally {
			Utils.screenPass.screenQuad.material = previousQuadMaterial;
		}
	});

	it("draws ordinary depth-tested colors once and composites 80 percent regardless of point overlap", () => {
		const {viewer, clouds, pipeline, camera, composites} = fixture();
		const originalTarget = viewer.renderer.getRenderTarget();
		viewer.pRenderer.render.mockImplementation((_scene, actualCamera, target, params) => {
			expect(actualCamera).toBe(camera);
			expect(target).toBe(pipeline.target);
			expect(params).toMatchObject({pointclouds: clouds, transparent: false, depthTest: true, depthWrite: true});
			for (const cloud of clouds) expect(cloud.material).toMatchObject({opacity: 1, useXRAY: false, useEDL: false, weighted: false, activeAttributeName: "intensity"});
		});
		pipeline.render(clouds, camera);
		expect(viewer.pRenderer.render).toHaveBeenCalledTimes(1);
		expect(composites).toHaveLength(1);
		expect(composites[0].opacity).toBe(0.8);
		expect(composites[0].material).toMatchObject({depthTest: true, depthWrite: false, transparent: true, blending: THREE.NormalBlending});
		expect(composites[0].material.uniforms.uDepth.value).toBe(pipeline.target.depthTexture);
		expect(composites[0].material.defines.USE_LAYER_DEPTH).toBe(1);
		for (const cloud of clouds) {
			expect(cloud.material).toMatchObject({opacity: 0.35, useEDL: true, weighted: true, activeAttributeName: "intensity"});
			expect(cloud.material.color.getHex()).toBe(0xabcdef);
			expect(cloud.userData).toEqual({edlEnabled: true});
		}
		expect(viewer.renderer.getRenderTarget()).toBe(originalTarget);
		expect(viewer.renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
		expect(viewer.renderer.getClearAlpha()).toBe(0.4);
	});

	it("uses offscreen dimensions and keeps independent opacity groups separate", () => {
		const {viewer, clouds, pipeline, camera, composites} = fixture();
		// Shared host options must split the paired reference and ordinary background into separate passes.
		const options = {referenceXray: true, alignmentOpacity: 0.5, alignmentReferenceOpacity: 0.8};
		setPointCloudLabelAppearance(clouds[0], "secondary", options, true);
		setPointCloudLabelAppearance(clouds[1], false, options, true);
		const output = {width: 320, height: 180};
		pipeline.render(clouds, camera, output);
		expect([pipeline.target.width, pipeline.target.height]).toEqual([320, 180]);
		expect(composites.map(pass => pass.opacity)).toEqual([0.8, 0.5]);
		expect(composites.every(pass => pass.target === output)).toBe(true);
		expect(viewer.pRenderer.render.mock.calls.map(call => call[3].pointclouds)).toEqual([[clouds[0]], [clouds[1]]]);
		const target = pipeline.target;
		pipeline.render(clouds, camera);
		expect(pipeline.target).toBe(target);
		expect([target.width, target.height]).toEqual([800, 600]);
	});

	it.each(["draw", "composite"])("restores source materials and render state after a failed %s", failure => {
		const {viewer, clouds, pipeline, camera} = fixture();
		const previous = viewer.renderer.getRenderTarget();
		if (failure === "draw") viewer.pRenderer.render.mockImplementation(() => { throw new Error("failed"); });
		else Utils.screenPass.render.mockImplementation(() => { throw new Error("failed"); });
		expect(() => pipeline.render(clouds, camera)).toThrow("failed");
		for (const cloud of clouds) expect(cloud.material).toMatchObject({opacity: 0.35, useEDL: true, weighted: true});
		expect(viewer.renderer.getRenderTarget()).toBe(previous);
		expect(viewer.renderer.getClearAlpha()).toBe(0.4);
	});

	it("keeps opaque clouds out of the layer and frees resources when the workflow ends", () => {
		const {viewer, clouds, camera} = fixture();
		setPointCloudLabelAppearance(clouds[0], true, {alignmentOpacity: 0.8}, true);
		expect(partitionPointcloudsByOpacity(clouds)).toEqual({solidPointclouds: [clouds[0]], opacityPointclouds: [clouds[1]]});
		expect(getPointcloudEffectState(clouds[0]).edlEnabled).toBe(true);
		renderPointcloudOpacity(viewer, [clouds[1]], camera);
		const target = viewer.pRenderer.render.mock.calls[0][2];
		const dispose = vi.spyOn(target, "dispose");
		renderPointcloudOpacity(viewer, [], camera);
		expect(dispose).toHaveBeenCalledOnce();
		renderPointcloudOpacity(viewer, [], camera);
		expect(dispose).toHaveBeenCalledOnce();
	});

	// Legacy devices can still use ordinary fixed opacity without requiring float or depth extensions.
	it("falls back to an ordinary alpha layer when depth sampling is unavailable", () => {
		const {viewer, clouds, camera, composites} = fixture();
		viewer.renderer.capabilities.isWebGL2 = false;
		const pipeline = new PointcloudOpacityPipeline(viewer);
		owned.push(pipeline);
		pipeline.render(clouds, camera);
		expect(composites[0].opacity).toBe(0.8);
		expect(composites[0].material.depthTest).toBe(false);
		expect(composites[0].material.defines.USE_LAYER_DEPTH).toBeUndefined();
	});
});
