import * as THREE from "../../libs/three.js/build/three.module.js";
import {Utils} from "../utils.js";
import {SphereVolume} from "../utils/Volume.js";
import {getPointcloudEffectState} from "./PointcloudEffectUtils.js";

// One viewer shares a single ordinary-color layer across standard, EDL and HQ renderers.
const pipelines = new WeakMap();

/** Separate whole-layer opacity from ordinary opaque point-cloud passes. */
export function partitionPointcloudsByOpacity(pointclouds) {
	const solidPointclouds = [], opacityPointclouds = [];
	for (const cloud of pointclouds) {
		(getPointcloudEffectState(cloud).normalOpacity === undefined ? solidPointclouds : opacityPointclouds).push(cloud);
	}
	return {solidPointclouds, opacityPointclouds};
}

/** Render nearest ordinary colors first, then composite once to avoid density-dependent alpha. */
export class PointcloudOpacityPipeline {
	constructor(viewer) {
		this.viewer = viewer;
		// Preserve ordinary scene occlusion when depth textures and fragment depth are available.
		const renderer = viewer.renderer, gl = renderer.getContext?.();
		this.depthSupported = renderer.capabilities?.isWebGL2 === true || Boolean(gl?.getExtension?.("WEBGL_depth_texture") && gl?.getExtension?.("EXT_frag_depth"));
		this.target = null;
		this.material = null;
	}

	/** Allocate only while a host explicitly requests ordinary whole-layer opacity. */
	ensureResources(width, height) {
		if (!this.target) this.target = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
			depthBuffer: true, stencilBuffer: false,
			depthTexture: this.depthSupported ? new THREE.DepthTexture(width, height, THREE.UnsignedIntType) : undefined,
		});
		if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
		if (!this.material) this.material = new THREE.ShaderMaterial({
			uniforms: {uColor: {value: this.target.texture}, uDepth: {value: this.target.depthTexture}, uOpacity: {value: 1}},
			defines: this.depthSupported ? {USE_LAYER_DEPTH: 1} : {},
			extensions: {fragDepth: this.depthSupported},
			vertexShader: `varying vec2 vUv;
				void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
			fragmentShader: `uniform sampler2D uColor;
				uniform sampler2D uDepth;
				uniform float uOpacity;
				varying vec2 vUv;
				void main() {
					vec4 color = texture2D(uColor, vUv);
					if (color.a == 0.0) discard;
					#ifdef USE_LAYER_DEPTH
						gl_FragDepthEXT = texture2D(uDepth, vUv).r;
					#endif
					gl_FragColor = vec4(color.rgb, color.a * uOpacity);
				}`,
			transparent: true, depthTest: this.depthSupported, depthWrite: false, blending: THREE.NormalBlending,
		});
	}

	/** Preserve source colors, clipping and offscreen camera dimensions without taking overlay ownership. */
	render(pointclouds, camera, output = null) {
		const {viewer} = this, {renderer} = viewer;
		const size = renderer.getSize(new THREE.Vector2());
		this.ensureResources(output?.width || size.x, output?.height || size.y);
		const groups = new Map();
		for (const cloud of pointclouds) {
			const opacity = getPointcloudEffectState(cloud).normalOpacity;
			if (opacity === undefined) continue;
			if (!groups.has(opacity)) groups.set(opacity, []);
			groups.get(opacity).push(cloud);
		}
		const previousTarget = renderer.getRenderTarget();
		const previousColor = renderer.getClearColor?.(new THREE.Color()).clone();
		const previousAlpha = renderer.getClearAlpha?.();
		try {
			for (const [opacity, clouds] of groups) {
				const materials = new Map();
				try {
					// Opaque, depth-tested colors make the final alpha independent of point overlap.
					for (const cloud of clouds) {
						const material = cloud.material;
						if (materials.has(material)) continue;
						materials.set(material, {opacity: material.opacity, useEDL: material.useEDL, useXRAY: material.useXRAY, weighted: material.weighted});
						Object.assign(material, {opacity: 1, useEDL: false, useXRAY: false, weighted: false});
					}
					renderer.setRenderTarget(this.target);
					renderer.setClearColor(0x000000, 0);
					renderer.clear(true, true, false);
					viewer.pRenderer.render(viewer.scene.scenePointCloud, camera, this.target, {
						pointclouds: clouds,
						clipSpheres: viewer.scene.volumes.filter(volume => volume instanceof SphereVolume),
						transparent: false, depthTest: true, depthWrite: true,
					});
				} finally {
					// Failed draws and shared source materials must not retain temporary pass flags.
					for (const [material, state] of materials) Object.assign(material, state);
				}
				this.material.uniforms.uOpacity.value = opacity;
				// Bind the output explicitly: the default screen pass otherwise keeps sampling its own framebuffer.
				renderer.setRenderTarget(output);
				if (output) Utils.screenPass.render(renderer, this.material, output);
				else Utils.screenPass.render(renderer, this.material);
			}
		} finally {
			renderer.setRenderTarget(previousTarget);
			if (previousColor) renderer.setClearColor(previousColor, previousAlpha);
		}
	}

	/** Release the optional layer immediately once no alignment cloud uses it. */
	dispose() {
		this.target?.dispose();
		this.material?.dispose();
		this.target = null;
		this.material = null;
	}
}

/** All renderer paths call this, including empty groups, to release a completed session's resources. */
export function renderPointcloudOpacity(viewer, pointclouds, camera, output = null) {
	if (!pointclouds.length) {
		pipelines.get(viewer)?.dispose();
		pipelines.delete(viewer);
		return;
	}
	if (!pipelines.has(viewer)) pipelines.set(viewer, new PointcloudOpacityPipeline(viewer));
	pipelines.get(viewer).render(pointclouds, camera, output);
}
