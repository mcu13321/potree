import * as THREE from "../../libs/three.js/build/three.module.js";
import {PointShape} from "../defines.js";

/** Copy color-related controls from the source point-cloud material. */
export function syncPointcloudColorMaterial(source, target){
	target.activeAttributeName = source.activeAttributeName;
	target.elevationGradientRepeat = source.elevationGradientRepeat;
	target.elevationRange = source.elevationRange;
	target.gradient = source.gradient;
	target.matcap = source.matcap;

	target.intensityRange = source.intensityRange;
	target.intensityGamma = source.intensityGamma;
	target.intensityContrast = source.intensityContrast;
	target.intensityBrightness = source.intensityBrightness;

	target.rgbGamma = source.rgbGamma;
	target.rgbContrast = source.rgbContrast;
	target.rgbBrightness = source.rgbBrightness;

	target.weightRGB = source.weightRGB;
	target.weightIntensity = source.weightIntensity;
	target.weightElevation = source.weightElevation;
	target.weightClassification = source.weightClassification;
	target.weightReturnNumber = source.weightReturnNumber;
	target.weightSourceID = source.weightSourceID;
	target.color = source.color;
}

/** Synchronize the shared state required by an offscreen point-cloud pass. */
export function syncPointcloudPassMaterial(pointcloud, source, target, options){
	const {width, height, weighted, includeColor = false} = options;
	const octreeSize = pointcloud.pcoGeometry.boundingBox.getSize(new THREE.Vector3()).x;

	target.size = source.size;
	target.minSize = source.minSize;
	target.maxSize = source.maxSize;
	target.pointSizeType = source.pointSizeType;
	target.visibleNodesTexture = source.visibleNodesTexture;
	target.weighted = weighted;
	target.screenWidth = width;
	target.screenHeight = height;
	target.shape = PointShape.CIRCLE;
	target.uniforms.visibleNodes.value = source.visibleNodesTexture;
	target.uniforms.octreeSize.value = octreeSize;
	target.spacing = pointcloud.pcoGeometry.spacing;
	target.classification = source.classification;
	target.uniforms.classificationLUT.value.image.data = source.uniforms.classificationLUT.value.image.data;
	target.classificationTexture.needsUpdate = true;

	target.uniforms.uFilterReturnNumberRange.value = source.uniforms.uFilterReturnNumberRange.value;
	target.uniforms.uFilterNumberOfReturnsRange.value = source.uniforms.uFilterNumberOfReturnsRange.value;
	target.uniforms.uFilterGPSTimeClipRange.value = source.uniforms.uFilterGPSTimeClipRange.value;
	target.uniforms.uFilterPointSourceIDClipRange.value = source.uniforms.uFilterPointSourceIDClipRange.value;

	if(includeColor){
		syncPointcloudColorMaterial(source, target);
	}

	target.clipTask = source.clipTask;
	target.clipMethod = source.clipMethod;
	target.setClipBoxes(source.clipBoxes);
	target.setClipPolygons(source.clipPolygons);
}

/** Dispose cached materials that no longer belong to the current scene. */
export function prunePointcloudMaterialMap(materials, pointclouds){
	const retained = pointclouds instanceof Set ? pointclouds : new Set(pointclouds);

	for(const [pointcloud, material] of materials){
		if(!retained.has(pointcloud)){
			material.dispose();
			materials.delete(pointcloud);
		}
	}
}

/** Dispose every material in a point-cloud keyed cache. */
export function disposePointcloudMaterialMap(materials){
	for(const material of materials.values()){
		material.dispose();
	}
	materials.clear();
}
