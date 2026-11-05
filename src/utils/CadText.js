import * as THREE from "../../libs/three.js/build/three.module.js";

/** Rasterize plain CAD text once; its mesh retains source-world size and orientation. */
export function createCadTextMesh(text) {
	const fontSize = 128, padding = 4;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.font = `${fontSize}px sans-serif`;
	const lines = String(text.text).split(/\r?\n/);
	const metrics = lines.map(line => context.measureText(line));
	const capHeight = context.measureText("H").actualBoundingBoxAscent || fontSize * 0.75;
	const ascent = Math.max(capHeight, ...metrics.map(metric => metric.actualBoundingBoxAscent || capHeight));
	const descent = Math.max(fontSize * 0.2, ...metrics.map(metric => metric.actualBoundingBoxDescent || 0));
	const leftBearing = Math.max(0, ...metrics.map(metric => metric.actualBoundingBoxLeft || 0));
	const width = Math.max(1, ...metrics.map(metric => Math.max(metric.width, metric.actualBoundingBoxRight || 0))) + leftBearing;
	const lineHeight = fontSize * 1.2;
	const inkHeight = ascent + descent + (lines.length - 1) * lineHeight;
	canvas.width = Math.ceil(width + padding * 2);
	canvas.height = Math.ceil(inkHeight + padding * 2);
	context.font = `${fontSize}px sans-serif`;
	context.fillStyle = "#ffffff";
	context.textBaseline = "alphabetic";
	lines.forEach((line, index) => context.fillText(line, padding + leftBearing, padding + ascent + index * lineHeight));
	const unit = text.height / capHeight;
	const horizontal = {left: 0, center: 0.5, right: 1}[text.horizontalAlign] ?? 0;
	const top = {top: 0, middle: inkHeight / 2, bottom: inkHeight}[text.verticalAlign] ?? ascent;
	const geometry = new THREE.PlaneGeometry(canvas.width * unit, canvas.height * unit);
	geometry.translate((canvas.width / 2 - padding - width * horizontal) * unit,
		(top + padding - canvas.height / 2) * unit, 0);
	const texture = new THREE.CanvasTexture(canvas);
	texture.generateMipmaps = false;
	texture.minFilter = THREE.LinearFilter;
	const material = new THREE.MeshBasicMaterial({map: texture, color: text.color ?? "#ffffff",
		transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false});
	material.toneMapped = false;
	const mesh = new THREE.Mesh(geometry, material);
	const value = text.normal;
	const normal = Array.isArray(value) ? new THREE.Vector3(...value)
		: new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 1);
	if (!normal.lengthSq() || ![normal.x, normal.y, normal.z].every(Number.isFinite)) normal.set(0, 0, 1);
	normal.normalize();
	// CAD rotation is measured in the arbitrary-axis plane defined by the extrusion normal.
	const reference = Math.abs(normal.x) < 1 / 64 && Math.abs(normal.y) < 1 / 64
		? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
	const right = reference.cross(normal).normalize();
	const up = normal.clone().cross(right);
	mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
	mesh.rotateZ(text.rotation ?? 0);
	mesh.frustumCulled = false;
	return mesh;
}

/** Release GPU allocations without changing the source text records. */
export function disposeCadTextMesh(mesh) {
	mesh.geometry.dispose();
	mesh.material.map.dispose();
	mesh.material.dispose();
}
