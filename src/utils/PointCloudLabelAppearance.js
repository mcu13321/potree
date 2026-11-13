import * as THREE from "../../libs/three.js/build/three.module.js";

// Runtime-only overrides never enter userData, saved projects, or source material settings.
const pointCloudLabelAppearances = new WeakMap();
// Host appearance preferences share the same transient lifetime as selection roles.
const pointCloudLabelOptions = new WeakMap();
// Alignment opacity is transient and must disappear when the session releases its roles.
const pointCloudAlignmentOpacities = new WeakMap();
const activePointCloudLabelColor = new THREE.Color(0x0088ff);
const secondaryPointCloudLabelColor = new THREE.Color(0xffd400);
const alignmentHiddenPointClouds = new WeakSet();
// Independent owners prevent one temporary tool from clearing another tool's visibility.
const stationHiddenPointClouds = new WeakMap();

/** Register active/inactive appearance, or remove this tool's override with null. */
export function setPointCloudLabelAppearance(pointcloud, active, options, aligning = false) {
	if (active === null) {
		pointCloudLabelAppearances.delete(pointcloud);
		pointCloudLabelOptions.delete(pointcloud);
		pointCloudAlignmentOpacities.delete(pointcloud);
	} else {
		pointCloudLabelAppearances.set(pointcloud, active === "secondary" ? "secondary" : Boolean(active));
		pointCloudLabelOptions.set(pointcloud, options);
		// The paired reference may be more opaque while omitted overrides retain the shared opacity.
		const opacity = active === "secondary"
			? options?.alignmentReferenceOpacity ?? options?.alignmentOpacity
			: options?.alignmentOpacity;
		if (aligning && Number.isFinite(opacity)) pointCloudAlignmentOpacities.set(pointcloud, opacity);
		else pointCloudAlignmentOpacities.delete(pointcloud);
	}
}

/** Read a session-only whole-layer opacity without changing saved material preferences. */
export function getPointCloudLabelAlignmentOpacity(pointcloud) {
	return pointCloudAlignmentOpacities.get(pointcloud);
}

/** Read host overrides without mutating cloud metadata or saved material preferences. */
export function getPointCloudLabelAppearanceOptions(pointcloud) {
	return pointCloudLabelOptions.get(pointcloud);
}

/** Return undefined when selection does not own this point cloud's appearance. */
export function getPointCloudLabelAppearance(pointcloud) {
	return pointCloudLabelAppearances.get(pointcloud);
}

/** Apply blue or yellow only during color drawing, including cached Xray pass materials. */
export function withPointCloudLabelColor(pointcloud, material, draw) {
	const role = getPointCloudLabelAppearance(pointcloud);
	const tint = role === "secondary" ? secondaryPointCloudLabelColor : role === true ? activePointCloudLabelColor : null;
	// Disabling role tints preserves the current attribute in regular and cached passes alike.
	if (getPointCloudLabelAppearanceOptions(pointcloud)?.colorEnabled === false || !tint ||
		material.activeAttributeName === "depth" || material.activeAttributeName === "indices" ||
		material.defines?.has?.("depth_pass")) return draw();
	const attribute = material.activeAttributeName;
	const color = material.color.clone();
	try {
		material.activeAttributeName = "color";
		material.color.copy(tint);
		return draw();
	} finally {
		material.activeAttributeName = attribute;
		material.color.copy(color);
	}
}

/** Hide only runtime rendering/picking, avoiding Scene visibility-driven coordinate rebasing. */
export function setPointCloudAlignmentHidden(pointcloud, hidden) {
	if (hidden) alignmentHiddenPointClouds.add(pointcloud);
	else alignmentHiddenPointClouds.delete(pointcloud);
}

/** Read transient visibility without mutating the original Object3D.visible property. */
export function isPointCloudAlignmentHidden(pointcloud) {
	return alignmentHiddenPointClouds.has(pointcloud);
}

/** Keep legacy LOD input identity and allocation behavior when no cloud is alignment-hidden. */
export function getAlignmentPointClouds(pointclouds) {
	// Preserve the original array when neither optional workflow owns a visibility mask.
	return pointclouds.some(isPointCloudRuntimeHidden) ? pointclouds.filter(cloud => !isPointCloudRuntimeHidden(cloud)) : pointclouds;
}

/** Add or release a station-view mask owned by one tool instance. */
export function setPointCloudStationHidden(pointcloud, owner, hidden) {
	let owners = stationHiddenPointClouds.get(pointcloud);
	if (hidden) {
		if (!owners) stationHiddenPointClouds.set(pointcloud, owners = new Set());
		owners.add(owner);
	} else if (owners) {
		owners.delete(owner);
		if (!owners.size) stationHiddenPointClouds.delete(pointcloud);
	}
}

/** Share transient visibility across drawing, picking, LOD and label projection. */
export function isPointCloudRuntimeHidden(pointcloud) {
	return isPointCloudAlignmentHidden(pointcloud) || stationHiddenPointClouds.has(pointcloud);
}
