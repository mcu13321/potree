import * as THREE from "../../libs/three.js/build/three.module.js";
import {PointCloudMaterial} from "../materials/PointCloudMaterial.js";
import {XrayNormalizationMaterial} from "../materials/XrayNormalizationMaterial.js";
import {SphereVolume} from "../utils/Volume.js";
import {Utils} from "../utils.js";
import {
	getPointcloudEffectState,
	getPointcloudMultiXrayOpacity,
	isGroupPointcloudSource,
} from "./PointcloudEffectUtils.js";
import {
	disposePointcloudMaterialMap,
	prunePointcloudMaterialMap,
	syncPointcloudPassMaterial,
} from "./PointcloudPassMaterialUtils.js";

/** Return whether the renderer can render float X-ray targets with depth textures. */
export function isXraySplatPipelineSupported(renderer){
	const gl = renderer?.getContext?.();
	if(!gl || typeof gl.getExtension !== "function"){
		return false;
	}

	const isWebGL2 = renderer?.capabilities?.isWebGL2 === true;
	const hasDepthTexture = isWebGL2 || Boolean(gl.getExtension("WEBGL_depth_texture"));
	const hasFloatTexture = isWebGL2 || Boolean(gl.getExtension("OES_texture_float"));
	const hasFloatColor = isWebGL2
		? Boolean(gl.getExtension("EXT_color_buffer_float"))
		: Boolean(gl.getExtension("WEBGL_color_buffer_float"));

	return hasDepthTexture && hasFloatTexture && hasFloatColor;
}

/** Own the two-pass offscreen X-ray render targets and resolve operation. */
export class XraySplatPipeline{

	constructor(viewer){
		this.viewer = viewer;
		this.gl = viewer.renderer.getContext();
		this.frontMaterials = new Map();
		this.accumulationMaterials = new Map();
		this.frontTarget = null;
		this.accumulationTarget = null;
		this.resolveMaterial = null;
	}

	isSupported(){
		return isXraySplatPipelineSupported(this.viewer.renderer);
	}

	_createFrontTarget(){
		return new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType),
		});
	}

	_createAccumulationTarget(){
		return new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			depthBuffer: false,
		});
	}

	_ensureResources(){
		if(!this.frontTarget){
			this.frontTarget = this._createFrontTarget();
		}
		if(!this.accumulationTarget){
			this.accumulationTarget = this._createAccumulationTarget();
		}
		if(!this.resolveMaterial){
			this.resolveMaterial = new XrayNormalizationMaterial();
			this.resolveMaterial.depthTest = false;
			this.resolveMaterial.depthWrite = false;
			this.resolveMaterial.transparent = true;
		}
	}

	_getFrontMaterial(pointcloud){
		if(!this.frontMaterials.has(pointcloud)){
			const material = new PointCloudMaterial();
			material.setDefine("depth_pass", "#define hq_depth_pass");
			material.setDefine("xray_front_pass", "#define xray_front_pass");
			material.useEDL = false;
			material.useXRAY = false;
			material.opacity = 1.0;
			this.frontMaterials.set(pointcloud, material);
		}

		return this.frontMaterials.get(pointcloud);
	}

	_getAccumulationMaterial(pointcloud){
		if(!this.accumulationMaterials.has(pointcloud)){
			const material = new PointCloudMaterial();
			material.useEDL = false;
			material.useXRAY = true;
			this.accumulationMaterials.set(pointcloud, material);
		}

		return this.accumulationMaterials.get(pointcloud);
	}

	_configureMaterials(pointcloud, source, camera, width, height, isGroupSource){
		const bbox = this.viewer.scene.getBoundingBox([pointcloud]);
		const center = bbox.getCenter(new THREE.Vector3());
		const size = bbox.getSize(new THREE.Vector3());
		const maxDimension = Math.max(size.x, size.y, size.z);
		const distanceToCenter = camera.position.distanceTo(center);
		const frontMaterial = this._getFrontMaterial(pointcloud);
		const accumulationMaterial = this._getAccumulationMaterial(pointcloud);

		syncPointcloudPassMaterial(pointcloud, source, frontMaterial, {
			width,
			height,
			weighted: false,
			includeColor: true,
		});

		syncPointcloudPassMaterial(pointcloud, source, accumulationMaterial, {
			width,
			height,
			weighted: true,
			includeColor: true,
		});
		accumulationMaterial.opacity = getPointcloudEffectState(
			pointcloud,
			this.viewer.isEDLSupported()
		).xrayOpacity;
		accumulationMaterial.uNear = Math.max(0, distanceToCenter - maxDimension / 2);
		accumulationMaterial.uFar = distanceToCenter + maxDimension / 2;
		accumulationMaterial.uXrayUseDistanceRamp = isGroupSource ? 0 : 1;
		accumulationMaterial.uXrayMultiOpacity = getPointcloudMultiXrayOpacity(
			pointcloud,
			camera.position,
			bbox
		);

		return {frontMaterial, accumulationMaterial};
	}

	_resize(width, height){
		for(const target of [this.frontTarget, this.accumulationTarget]){
			if(target.width !== width || target.height !== height){
				target.setSize(width, height);
			}
		}
	}

	_clearTargets(){
		const {renderer} = this.viewer;
		const previousTarget = renderer.getRenderTarget();
		const previousColor = renderer.getClearColor
			? renderer.getClearColor(new THREE.Color()).clone()
			: null;
		const previousAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : null;

		try{
			renderer.setClearColor(0x000000, 0);
			renderer.setRenderTarget(this.frontTarget);
			renderer.clear(true, true, false);
			renderer.setRenderTarget(this.accumulationTarget);
			renderer.clear(true, false, false);
		}finally{
			renderer.setRenderTarget(previousTarget);
			if(previousColor){
				renderer.setClearColor(previousColor, previousAlpha);
			}
		}
	}

	renderToTargets({pointclouds, originalMaterials, camera, width, height}){
		if(pointclouds.length === 0){
			return;
		}

		this._ensureResources();
		this._resize(width, height);
		this._clearTargets();
		const isGroupSource = isGroupPointcloudSource(this.viewer);
		const materials = new Map();

		try{
			for(const pointcloud of pointclouds){
				const source = originalMaterials.get(pointcloud);
				materials.set(
					pointcloud,
					this._configureMaterials(pointcloud, source, camera, width, height, isGroupSource)
				);
				pointcloud.material = materials.get(pointcloud).frontMaterial;
			}

			this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, this.frontTarget, {
				clipSpheres: this.viewer.scene.volumes.filter(volume => volume instanceof SphereVolume),
				pointclouds,
			});

			for(const pointcloud of pointclouds){
				pointcloud.material = materials.get(pointcloud).accumulationMaterial;
			}

			this.viewer.pRenderer.render(
				this.viewer.scene.scenePointCloud,
				camera,
				this.accumulationTarget,
				{
					clipSpheres: this.viewer.scene.volumes.filter(volume => volume instanceof SphereVolume),
					pointclouds,
					// The shader output is premultiplied, so accumulation uses additive ONE blending.
					blendFunc: [this.gl.ONE, this.gl.ONE],
					depthTest: false,
					depthWrite: false,
				}
			);
		}finally{
			for(const pointcloud of pointclouds){
				pointcloud.material = originalMaterials.get(pointcloud);
			}
		}
	}

	// An explicit target keeps the normalized XRAY result inside the magnifier texture.
	resolve(settings, target = undefined){
		if(!this.frontTarget || !this.accumulationTarget){
			return;
		}

		this._ensureResources();
		const uniforms = this.resolveMaterial.uniforms;
		uniforms.uDepthMap.value = this.frontTarget.depthTexture;
		uniforms.uFrontColorMap.value = this.frontTarget.texture;
		uniforms.uAccumulationMap.value = this.accumulationTarget.texture;
		uniforms.uDensityScale.value = settings.densityScale;
		uniforms.uMaxOpacity.value = settings.maxOpacity;
		uniforms.uFrontDetailStrength.value = settings.frontDetailStrength;
		uniforms.uColorGamma.value = settings.colorGamma;
		if (target) {
			Utils.screenPass.render(this.viewer.renderer, this.resolveMaterial, target);
		} else {
			Utils.screenPass.render(this.viewer.renderer, this.resolveMaterial);
		}
	}

	prune(pointclouds){
		const retained = new Set(pointclouds);
		prunePointcloudMaterialMap(this.frontMaterials, retained);
		prunePointcloudMaterialMap(this.accumulationMaterials, retained);
	}

	dispose(){
		disposePointcloudMaterialMap(this.frontMaterials);
		disposePointcloudMaterialMap(this.accumulationMaterials);
		this.frontTarget?.dispose();
		this.accumulationTarget?.dispose();
		this.resolveMaterial?.dispose();
		this.frontTarget = null;
		this.accumulationTarget = null;
		this.resolveMaterial = null;
	}
}
