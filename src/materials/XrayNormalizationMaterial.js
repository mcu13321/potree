import * as THREE from "../../libs/three.js/build/three.module.js";
import {Shaders} from "../../build/shaders/shaders.js";

/** Resolve premultiplied X-ray accumulation and nearest-surface detail. */
export class XrayNormalizationMaterial extends THREE.RawShaderMaterial{

	constructor(){
		super();

		this.setValues({
			uniforms: {
				uDepthMap: {type: "t", value: null},
				uAccumulationMap: {type: "t", value: null},
				uFrontColorMap: {type: "t", value: null},
				uDensityScale: {type: "f", value: 2.0},
				uMaxOpacity: {type: "f", value: 0.85},
				uFrontDetailStrength: {type: "f", value: 0.35},
				uColorGamma: {type: "f", value: 0.55},
			},
			vertexShader: Shaders["normalize.vs"],
			fragmentShader: Shaders["normalize_xray.fs"],
		});
	}
}
