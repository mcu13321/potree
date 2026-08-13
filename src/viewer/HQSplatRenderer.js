import * as THREE from "../../libs/three.js/build/three.module.js";
import {NormalizationMaterial} from "../materials/NormalizationMaterial.js";
import {NormalizationEDLMaterial} from "../materials/NormalizationEDLMaterial.js";
import {PointCloudMaterial} from "../materials/PointCloudMaterial.js";
import {SphereVolume} from "../utils/Volume.js";
import {Utils} from "../utils.js";
import {getPointcloudEffectState, partitionPointcloudsByEDL} from "./PointcloudEffectUtils.js";
import {
	disposePointcloudMaterialMap,
	prunePointcloudMaterialMap,
	syncPointcloudPassMaterial,
} from "./PointcloudPassMaterialUtils.js";
import {XraySplatPipeline} from "./XraySplatPipeline.js";

export class HQSplatRenderer{

	constructor(viewer){
		this.viewer = viewer;
		this.depthMaterials = new Map();
		this.attributeMaterials = new Map();
		this.normalizationMaterial = null;
		this.normalizationEDLMaterial = null;
		this.rtDepth = null;
		this.rtAttribute = null;
		this.rtDepthEDL = null;
		this.rtAttributeEDL = null;
		this.gl = viewer.renderer.getContext();
		this.xrayPipeline = new XraySplatPipeline(viewer);
		this.initialized = false;
	}

	init(){
		if(this.initialized){
			return;
		}

		this.normalizationMaterial = new NormalizationMaterial();
		this.normalizationMaterial.depthTest = true;
		this.normalizationMaterial.depthWrite = true;
		this.normalizationMaterial.transparent = true;

		this.normalizationEDLMaterial = new NormalizationEDLMaterial();
		this.normalizationEDLMaterial.depthTest = true;
		this.normalizationEDLMaterial.depthWrite = true;
		this.normalizationEDLMaterial.transparent = true;
		this.initialized = true;
	}

	_createDepthTarget(type = THREE.FloatType){
		return new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType),
		});
	}

	_createAttributeTarget(depthTexture, type = THREE.FloatType){
		return new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type,
			depthTexture,
		});
	}

	_ensureStandardTargets(){
		if(!this.rtDepth){
			this.rtDepth = this._createDepthTarget();
		}
		if(!this.rtAttribute){
			this.rtAttribute = this._createAttributeTarget(this.rtDepth.depthTexture);
		}
	}

	_ensureEDLTargets(){
		if(!this.rtDepthEDL){
			this.rtDepthEDL = this._createDepthTarget();
		}
		if(!this.rtAttributeEDL){
			this.rtAttributeEDL = this._createAttributeTarget(this.rtDepthEDL.depthTexture);
		}
	}

	resize(width, height, targets = []){
		for(const target of targets){
			if(target.width !== width || target.height !== height){
				target.setSize(width, height);
			}
		}
	}

	clearTargets(targetSpecs = []){
		const {renderer} = this.viewer;
		const previousTarget = renderer.getRenderTarget();

		renderer.setClearColor(0x000000, 0);
		for(const {target, clearDepth = false} of targetSpecs){
			renderer.setRenderTarget(target);
			renderer.clear(true, clearDepth, false);
		}
		renderer.setRenderTarget(previousTarget);
	}

	clear(){
		this.init();
		const {renderer, background} = this.viewer;

		if(background === "skybox" || background === "gradient"){
			renderer.setClearColor(0x000000, 0);
		}else if(background === "black"){
			renderer.setClearColor(0x000000, 1);
		}else if(background === "white"){
			renderer.setClearColor(0xFFFFFF, 1);
		}else{
			renderer.setClearColor(0x000000, 0);
		}

		renderer.clear();
	}

	_preparePassMaterials(pointcloud, originalMaterials){
		if(!this.attributeMaterials.has(pointcloud)){
			this.attributeMaterials.set(pointcloud, new PointCloudMaterial());
		}
		if(!this.depthMaterials.has(pointcloud)){
			const depthMaterial = new PointCloudMaterial();
			depthMaterial.setDefine("depth_pass", "#define hq_depth_pass");
			this.depthMaterials.set(pointcloud, depthMaterial);
		}

		const effectState = getPointcloudEffectState(pointcloud, this.viewer.isEDLSupported());
		const attributeMaterial = this.attributeMaterials.get(pointcloud);
		const depthMaterial = this.depthMaterials.get(pointcloud);

		originalMaterials.set(pointcloud, pointcloud.material);
		attributeMaterial.useEDL = false;
		attributeMaterial.useXRAY = false;
		attributeMaterial.opacity = 1.0;
		depthMaterial.useEDL = effectState.edlEnabled;
		depthMaterial.useXRAY = false;
		depthMaterial.opacity = 1.0;
	}

	_renderPointcloudGroup({pointclouds, originalMaterials, camera, width, height, rtDepth, rtAttribute}){
		if(pointclouds.length === 0){
			return;
		}

		for(const pointcloud of pointclouds){
			const source = originalMaterials.get(pointcloud);
			const depthMaterial = this.depthMaterials.get(pointcloud);
			syncPointcloudPassMaterial(pointcloud, source, depthMaterial, {
				width,
				height,
				weighted: false,
			});
			pointcloud.material = depthMaterial;
		}

		this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, rtDepth, {
			clipSpheres: this.viewer.scene.volumes.filter(volume => volume instanceof SphereVolume),
			pointclouds,
		});

		for(const pointcloud of pointclouds){
			const source = originalMaterials.get(pointcloud);
			const attributeMaterial = this.attributeMaterials.get(pointcloud);
			syncPointcloudPassMaterial(pointcloud, source, attributeMaterial, {
				width,
				height,
				weighted: true,
				includeColor: true,
			});
			pointcloud.material = attributeMaterial;
		}

		this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, rtAttribute, {
			clipSpheres: this.viewer.scene.volumes.filter(volume => volume instanceof SphereVolume),
			pointclouds,
			blendFunc: [this.gl.SRC_ALPHA, this.gl.ONE],
			depthWrite: false,
		});
	}

	_renderBackground(){
		const viewer = this.viewer;

		viewer.renderer.setRenderTarget(null);
		if(viewer.background === "skybox"){
			viewer.renderer.setClearColor(0x000000, 0);
			viewer.renderer.clear();
			viewer.skybox.camera.rotation.copy(viewer.scene.cameraP.rotation);
			viewer.skybox.camera.fov = viewer.scene.cameraP.fov;
			viewer.skybox.camera.aspect = viewer.scene.cameraP.aspect;
			viewer.skybox.parent.rotation.x = 0;
			viewer.skybox.parent.updateMatrixWorld();
			viewer.skybox.camera.updateProjectionMatrix();
			viewer.renderer.render(viewer.skybox.scene, viewer.skybox.camera);
		}else if(viewer.background === "gradient"){
			viewer.renderer.setClearColor(0x000000, 0);
			viewer.renderer.clear();
			viewer.renderer.render(viewer.scene.sceneBG, viewer.scene.cameraBG);
		}else if(viewer.background === "black"){
			viewer.renderer.setClearColor(0x000000, 1);
			viewer.renderer.clear();
		}else if(viewer.background === "white"){
			viewer.renderer.setClearColor(0xFFFFFF, 1);
			viewer.renderer.clear();
		}else{
			viewer.renderer.setClearColor(0x000000, 0);
			viewer.renderer.clear();
		}
	}

	_renderNormalizationPass({rtDepth, rtAttribute, width, height, useEDL}){
		const material = useEDL ? this.normalizationEDLMaterial : this.normalizationMaterial;

		if(useEDL){
			material.uniforms.edlStrength.value = this.viewer.edlStrength;
			material.uniforms.radius.value = this.viewer.edlRadius;
			material.uniforms.screenWidth.value = width;
			material.uniforms.screenHeight.value = height;
			material.uniforms.uEDLMap.value = rtDepth.texture;
		}

		material.uniforms.uWeightMap.value = rtAttribute.texture;
		material.uniforms.uDepthMap.value = rtAttribute.depthTexture;
		Utils.screenPass.render(this.viewer.renderer, material);
	}

	_pruneMaterialCaches(pointclouds){
		const retained = new Set(pointclouds);
		prunePointcloudMaterialMap(this.depthMaterials, retained);
		prunePointcloudMaterialMap(this.attributeMaterials, retained);
		this.xrayPipeline.prune(retained);
	}

	render(params = {}){
		this.init();
		const viewer = this.viewer;
		const camera = params.camera || viewer.scene.getActiveCamera();
		const {width, height} = viewer.renderer.getSize(new THREE.Vector2());
		const allPointclouds = viewer.scene.pointclouds;
		const visiblePointclouds = allPointclouds.filter(pointcloud => pointcloud.visible);
		const {edlPointclouds, regularPointclouds} = partitionPointcloudsByEDL(
			visiblePointclouds,
			viewer.isEDLSupported()
		);
		const xrayPointclouds = regularPointclouds.filter(pointcloud => {
			return getPointcloudEffectState(pointcloud, viewer.isEDLSupported()).xrayEnabled;
		});
		const standardPointclouds = regularPointclouds.filter(pointcloud => {
			return !getPointcloudEffectState(pointcloud, viewer.isEDLSupported()).xrayEnabled;
		});
		const originalMaterials = new Map();
		const activeTargets = [];
		const targetSpecs = [];

		viewer.dispatchEvent({type: "render.pass.begin", viewer});
		this._pruneMaterialCaches(allPointclouds);

		if(standardPointclouds.length > 0){
			this._ensureStandardTargets();
			activeTargets.push(this.rtDepth, this.rtAttribute);
			targetSpecs.push(
				{target: this.rtDepth, clearDepth: true},
				{target: this.rtAttribute}
			);
		}

		if(edlPointclouds.length > 0){
			this._ensureEDLTargets();
			activeTargets.push(this.rtDepthEDL, this.rtAttributeEDL);
			targetSpecs.push(
				{target: this.rtDepthEDL, clearDepth: true},
				{target: this.rtAttributeEDL}
			);
		}

		this.resize(width, height, activeTargets);
		this.clearTargets(targetSpecs);
		for(const pointcloud of [...standardPointclouds, ...edlPointclouds]){
			this._preparePassMaterials(pointcloud, originalMaterials);
		}
		for(const pointcloud of xrayPointclouds){
			originalMaterials.set(pointcloud, pointcloud.material);
		}

		try{
			this._renderPointcloudGroup({
				pointclouds: standardPointclouds,
				originalMaterials,
				camera,
				width,
				height,
				rtDepth: this.rtDepth,
				rtAttribute: this.rtAttribute,
			});

			this.xrayPipeline.renderToTargets({
				pointclouds: xrayPointclouds,
				originalMaterials,
				camera,
				width,
				height,
			});

			this._renderPointcloudGroup({
				pointclouds: edlPointclouds,
				originalMaterials,
				camera,
				width,
				height,
				rtDepth: this.rtDepthEDL,
				rtAttribute: this.rtAttributeEDL,
			});
		}finally{
			for(const [pointcloud, material] of originalMaterials){
				pointcloud.material = material;
			}
		}

		this._renderBackground();
		if(standardPointclouds.length > 0){
			this._renderNormalizationPass({
				rtDepth: this.rtDepth,
				rtAttribute: this.rtAttribute,
				width,
				height,
				useEDL: false,
			});
		}
		if(xrayPointclouds.length > 0){
			this.xrayPipeline.resolve(viewer.getXrayRenderSettings());
		}
		if(edlPointclouds.length > 0){
			this._renderNormalizationPass({
				rtDepth: this.rtDepthEDL,
				rtAttribute: this.rtAttributeEDL,
				width,
				height,
				useEDL: true,
			});
		}

		viewer.renderer.render(viewer.scene.scene, camera);
		viewer.dispatchEvent({type: "render.pass.scene", viewer});
		viewer.renderer.clearDepth();
		viewer.transformationTool.update();
		viewer.dispatchEvent({type: "render.pass.perspective_overlay", viewer});
		viewer.renderer.render(viewer.controls.sceneControls, camera);
		viewer.renderer.render(viewer.clippingTool.sceneVolume, camera);
		viewer.renderer.render(viewer.transformationTool.scene, camera);
		viewer.renderer.setViewport(
			width - viewer.navigationCube.width,
			height - viewer.navigationCube.width,
			viewer.navigationCube.width,
			viewer.navigationCube.width
		);
		viewer.renderer.render(viewer.navigationCube, viewer.navigationCube.camera);
		viewer.renderer.setViewport(0, 0, width, height);
		viewer.dispatchEvent({type: "render.pass.end", viewer});
	}

	_disposeTargetPair(depthTarget, attributeTarget){
		if(depthTarget && attributeTarget && attributeTarget.depthTexture === depthTarget.depthTexture){
			attributeTarget.depthTexture = null;
		}
		attributeTarget?.dispose();
		depthTarget?.dispose();
	}

	dispose(){
		disposePointcloudMaterialMap(this.depthMaterials);
		disposePointcloudMaterialMap(this.attributeMaterials);
		this._disposeTargetPair(this.rtDepth, this.rtAttribute);
		this._disposeTargetPair(this.rtDepthEDL, this.rtAttributeEDL);
		this.normalizationMaterial?.dispose();
		this.normalizationEDLMaterial?.dispose();
		this.xrayPipeline.dispose();
		this.rtDepth = null;
		this.rtAttribute = null;
		this.rtDepthEDL = null;
		this.rtAttributeEDL = null;
		this.normalizationMaterial = null;
		this.normalizationEDLMaterial = null;
		this.initialized = false;
	}
}
