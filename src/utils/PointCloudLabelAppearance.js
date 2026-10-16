import * as THREE from "../../libs/three.js/build/three.module.js";

// Runtime-only overrides never enter userData, saved projects, or source material settings.
const pointCloudLabelAppearances = new WeakMap();
const activePointCloudLabelColor = new THREE.Color(0x0088ff);
const secondaryPointCloudLabelColor = new THREE.Color(0xffd400);
const alignmentHiddenPointClouds = new WeakSet();

/** Register active/inactive appearance, or remove this tool's override with null. */
export function setPointCloudLabelAppearance(pointcloud, active) {
	if (active === null) pointCloudLabelAppearances.delete(pointcloud);
	else pointCloudLabelAppearances.set(pointcloud, active === "secondary" ? "secondary" : Boolean(active));
}

/** Return undefined when selection does not own this point cloud's appearance. */
export function getPointCloudLabelAppearance(pointcloud) {
	return pointCloudLabelAppearances.get(pointcloud);
}

/** Apply blue or yellow only during color drawing, including cached Xray pass materials. */
export function withPointCloudLabelColor(pointcloud, material, draw) {
	const role = getPointCloudLabelAppearance(pointcloud);
	const tint = role === "secondary" ? secondaryPointCloudLabelColor : role === true ? activePointCloudLabelColor : null;
	if (!tint ||
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
	return pointclouds.some(isPointCloudAlignmentHidden) ? pointclouds.filter(cloud => !isPointCloudAlignmentHidden(cloud)) : pointclouds;
}
