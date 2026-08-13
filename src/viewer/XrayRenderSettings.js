import * as THREE from "../../libs/three.js/build/three.module.js";

export const DEFAULT_XRAY_RENDER_SETTINGS = Object.freeze({
	densityScale: 2.0,
	maxOpacity: 0.85,
	frontDetailStrength: 0.35,
	colorGamma: 0.55,
});

function finiteOrCurrent(value, current){
	return typeof value === "number" && Number.isFinite(value) ? value : current;
}

/** Normalize a partial X-ray resolve configuration against its current values. */
export function normalizeXrayRenderSettings(settings, current = DEFAULT_XRAY_RENDER_SETTINGS){
	const source = settings && typeof settings === "object" ? settings : {};

	return {
		densityScale: Math.max(0, finiteOrCurrent(source.densityScale, current.densityScale)),
		maxOpacity: THREE.MathUtils.clamp(
			finiteOrCurrent(source.maxOpacity, current.maxOpacity),
			0,
			1
		),
		frontDetailStrength: THREE.MathUtils.clamp(
			finiteOrCurrent(source.frontDetailStrength, current.frontDetailStrength),
			0,
			1
		),
		colorGamma: THREE.MathUtils.clamp(
			finiteOrCurrent(source.colorGamma, current.colorGamma),
			0.1,
			1
		),
	};
}

/** Return whether two normalized X-ray configurations are equivalent. */
export function areXrayRenderSettingsEqual(left, right){
	return left.densityScale === right.densityScale
		&& left.maxOpacity === right.maxOpacity
		&& left.frontDetailStrength === right.frontDetailStrength
		&& left.colorGamma === right.colorGamma;
}
