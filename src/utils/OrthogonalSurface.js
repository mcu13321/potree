import * as THREE from "../../libs/three.js/build/three.module.js";
import {Utils} from "../utils.js";

// Keep recognition thresholds together; distances are relative to the sampled footprint.
export const ORTHOGONAL_SURFACE_OPTIONS = Object.freeze({
	windowSize: 49, maxPoints: 256, minPoints: 12, maxAngle: 10,
	maxPlanarity: 0.05, minSpread: 0.1, maxResidual: 0.05,
	// Expand only when local support is insufficient; keep GPU work bounded.
	maxWindowSize: 145, windowStep: 48, maxInnerRadiusRatio: 0.85,
});
const AXES = ["x", "y", "z"];

// Jacobi rotations diagonalize the small symmetric covariance without another dependency.
function eigenvectors(matrix) {
	const a = matrix.map(row => row.slice());
	const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	for (let iteration = 0; iteration < 24; iteration++) {
		let p = 0, q = 1;
		for (const [i, j] of [[0, 2], [1, 2]]) {
			if (Math.abs(a[i][j]) > Math.abs(a[p][q])) [p, q] = [i, j];
		}
		if (Math.abs(a[p][q]) <= Math.max(...a.map((row, i) => Math.abs(row[i]))) * 1e-12) break;
		const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
		const c = Math.cos(angle), s = Math.sin(angle);
		const app = a[p][p], aqq = a[q][q], apq = a[p][q];
		a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
		a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
		a[p][q] = a[q][p] = 0;
		for (let k = 0; k < 3; k++) {
			if (k !== p && k !== q) {
				const akp = a[k][p], akq = a[k][q];
				a[k][p] = a[p][k] = c * akp - s * akq;
				a[k][q] = a[q][k] = s * akp + c * akq;
			}
			const vkp = v[k][p], vkq = v[k][q];
			v[k][p] = c * vkp - s * vkq;
			v[k][q] = s * vkp + c * vkq;
		}
	}
	return a.map((row, i) => ({value: Math.max(0, row[i]), normal: new THREE.Vector3(...v.map(r => r[i]))}))
		.sort((left, right) => left.value - right.value);
}

function fitSurface(points, seed, radius, options, diagnostics = {}) {
	if (points.length < options.minPoints || !(radius > 0)) {
		diagnostics.retryable = true;
		return null;
	}
	// Center relative to the seed to retain precision at survey-coordinate magnitudes.
	const offsets = points.map(point => point.clone().sub(seed));
	const center = offsets.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
	const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
	for (const point of offsets) {
		const d = point.sub(center).toArray();
		for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) covariance[i][j] += d[i] * d[j] / points.length;
	}
	const [small, middle, large] = eigenvectors(covariance);
	// Competing surfaces and line-only support remain hard failures at this location.
	if (!(middle.value > 0) || small.value / middle.value > options.maxPlanarity ||
		middle.value / large.value < options.minSpread) return null;
	const axis = AXES.reduce((best, value) => Math.abs(small.normal[value]) > Math.abs(small.normal[best]) ? value : best, "x");
	// Cursor feedback may follow any reliable plane; only start placement requires axis alignment.
	if (options.requireAxisAlignment !== false && Math.abs(small.normal[axis]) + 1e-12 < Math.cos(options.maxAngle * Math.PI / 180)) return null;
	const noise = Math.sqrt(small.value);
	// Nested fits inherit measured outer noise instead of halving the same scanner's tolerance.
	const residualTolerance = Math.max(radius * options.maxResidual, options.noiseTolerance ?? 0);
	if (noise > residualTolerance || Math.abs(center.dot(small.normal)) > residualTolerance) {
		diagnostics.retryable = true;
		return null;
	}
	return {axis, normal: small.normal, noise};
}

// Retain failure reasons internally so expanding a window cannot rescue an ambiguous wall corner.
function analyzeOrthogonalSurface(points, seed, radius, options) {
	const unique = new Map();
	for (const point of points) {
		if (![point.x, point.y, point.z].every(Number.isFinite) || point.distanceTo(seed) > radius) continue;
		unique.set(point.toArray().join(","), point);
	}
	const sorted = [...unique.values()].sort((a, b) => a.distanceToSquared(seed) - b.distanceToSquared(seed));
	// Evenly subsample by distance rather than discarding the outer support of the plane.
	const sample = sorted.length <= options.maxPoints ? sorted : Array.from({length: options.maxPoints}, (_, i) => sorted[Math.floor(i * sorted.length / options.maxPoints)]);
	const diagnostics = {};
	const outer = fitSurface(sample, seed, radius, options, diagnostics);
	if (!outer) return {surface: null, retryable: Boolean(diagnostics.retryable)};
	// Grow the nested neighborhood to enough points while retaining a genuinely smaller footprint.
	const requiredDistance = sample[options.minPoints - 1].distanceTo(seed);
	const innerRadius = Math.max(radius / 2, requiredDistance * (1 + 1e-9));
	if (innerRadius > radius * options.maxInnerRadiusRatio) return {surface: null, retryable: true};
	const inner = fitSurface(sample.filter(point => point.distanceTo(seed) <= innerRadius), seed, innerRadius,
		{...options, noiseTolerance: outer.noise * 1.5}, diagnostics);
	if (!inner) return {surface: null, retryable: Boolean(diagnostics.retryable)};
	const consistent = inner && Math.abs(inner.normal.dot(outer.normal)) >= Math.cos(options.maxAngle * Math.PI / 180);
	const surface = consistent && (options.requireAxisAlignment === false || inner.axis === outer.axis)
		? {axis: outer.axis, normal: outer.normal.clone(), position: seed.clone()} : null;
	return {surface, retryable: false};
}

// Geometry callers keep a simple nullable result; the GPU picker also consumes retry diagnostics.
export function recognizeOrthogonalSurface(points, seed, radius, options = ORTHOGONAL_SURFACE_OPTIONS) {
	return analyzeOrthogonalSurface(points, seed, radius, options).surface;
}

export function projectOrthogonalEndpoint(start, target, axis) {
	const end = start.clone();
	end[axis] = target[axis];
	return end;
}

// Target points need only a visible hit; they do not require a reliable plane or normal.
export function pickOrthogonalPoint(viewer, mouse) {
	const camera = viewer.scene.getActiveCamera();
	const clouds = viewer.scene.pointclouds.filter(cloud => cloud.visible !== false);
	const hit = Utils.getMousePointCloudIntersection(mouse, camera, viewer, clouds, {pickClipped: true});
	return hit ? {position: hit.location.clone(), pointcloud: hit.pointcloud} : null;
}

// Reuse an existing target hit while estimating its independent cursor-plane orientation.
export function pickOrthogonalSurface(viewer, mouse, {requireAxisAlignment = true, point = null} = {}) {
	const hit = point ?? pickOrthogonalPoint(viewer, mouse);
	if (!hit) return null;
	const camera = viewer.scene.getActiveCamera();
	const canvas = viewer.renderer.domElement;
	const distance = camera.position.distanceTo(hit.position);
	const projected = Utils.projectedRadius(1, camera, distance, canvas.clientWidth, canvas.clientHeight);
	if (!(projected > 0) || !Number.isFinite(projected)) return null;
	const raycaster = new THREE.Raycaster();
	const screen = hit.position.clone().project(camera);
	if (![screen.x, screen.y, screen.z].every(Number.isFinite) || screen.z < -1 || screen.z > 1) return null;
	// The seed can be displaced inside the initial pick window; center both ray and samples on it.
	raycaster.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
	const pixelX = (screen.x + 1) * canvas.clientWidth / 2;
	const pixelY = (screen.y + 1) * canvas.clientHeight / 2;
	const options = {...ORTHOGONAL_SURFACE_OPTIONS, requireAxisAlignment};
	const viewportLimit = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight));
	const maxWindow = Math.min(options.maxWindowSize, viewportLimit % 2 ? viewportLimit : viewportLimit - 1);
	if (maxWindow < 3) return null;
	let windowSize = Math.min(options.windowSize, maxWindow);
	while (true) {
		const half = (windowSize - 1) / 2;
		// Keep the readback rectangle within the framebuffer when the seed is near a canvas edge.
		const x = Math.max(half, Math.min(canvas.clientWidth - 1 - half, pixelX));
		const y = Math.max(half, Math.min(canvas.clientHeight - 1 - half, pixelY));
		const points = hit.pointcloud.pick(viewer, camera, raycaster.ray, {
			all: true, pickClipped: true, pickWindowSize: windowSize, x, y,
		}) ?? [];
		const result = analyzeOrthogonalSurface(points.map(point => point.position), hit.position, windowSize / 2 / projected, options);
		if (result.surface) return {...result.surface, pointcloud: hit.pointcloud};
		if (!result.retryable || windowSize >= maxWindow) return null;
		windowSize = Math.min(windowSize + options.windowStep, maxWindow);
	}
}
