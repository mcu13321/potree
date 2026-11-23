import * as THREE from '../libs/three.js/build/three.module.js';
import {describe, it, expect, vi} from 'vitest';
import {recognizeOrthogonalSurface, projectOrthogonalEndpoint, pickOrthogonalSurface, ORTHOGONAL_SURFACE_OPTIONS} from '../src/utils/OrthogonalSurface.js';

// Dense deterministic fixtures cover geometry independently of GPU rendering.
function plane(axis, angle = 0, offset = new THREE.Vector3()) {
	const points = [];
	for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
		const point = new THREE.Vector3(i / 12, j / 12, 0);
		if (axis === 'x') point.set(0, i / 12, j / 12);
		if (axis === 'y') point.set(i / 12, 0, j / 12);
		point.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * Math.PI / 180).add(offset);
		points.push(point);
	}
	return points;
}

describe('orthogonal surface recognition', () => {
	it('recognizes an exact sparse plane without requiring twelve points inside the half-radius disk', () => {
		// The nested support may grow to actual point density without reaching the full outer footprint.
		const points = [];
		for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) points.push(new THREE.Vector3(i * 0.04, j * 0.04, 0));
		expect(points.filter(point => point.length() <= 0.05)).toHaveLength(5);
		expect(recognizeOrthogonalSurface(points, new THREE.Vector3(), 0.1)?.axis).toBe('z');
	});
	it('uses measured outer noise for a nested fit of the same scanned surface', () => {
		// Scanner thickness does not become smaller just because the second footprint is smaller.
		const points = [];
		for (let i = -25; i <= 25; i++) for (let j = -25; j <= 25; j++) {
			points.push(new THREE.Vector3(i * 0.01, j * 0.01, Math.sin(i * 7 + j * 11) * 0.008));
		}
		expect(recognizeOrthogonalSurface(points, new THREE.Vector3(), 0.2)?.axis).toBe('z');
	});
	it('retains the fitted slope normal for cursor feedback without authorizing a sloped start', () => {
		// Disks use actual fitted normals; the first-point angular gate remains independent.
		const points = plane('z', 30), seed = new THREE.Vector3();
		expect(recognizeOrthogonalSurface(points, seed, 1)).toBeNull();
		const surface = recognizeOrthogonalSurface(points, seed, 1, {...ORTHOGONAL_SURFACE_OPTIONS, requireAxisAlignment: false});
		expect(Math.abs(surface.normal.dot(new THREE.Vector3(0.5, 0, Math.sqrt(0.75))))).toBeCloseTo(1, 10);
	});
	for (const axis of ['x', 'y', 'z']) it(`recognizes the ${axis} world normal`, () => {
		expect(recognizeOrthogonalSurface(plane(axis), new THREE.Vector3(), 1)?.axis).toBe(axis);
	});
	for (const angle of [0, 5, 10, 170, 180]) it(`accepts an unsigned axis angle of ${angle} degrees`, () => {
		expect(recognizeOrthogonalSurface(plane('z', angle), new THREE.Vector3(), 1)?.axis).toBe('z');
	});
	for (const angle of [10.1, 20, 45]) it(`rejects a slope of ${angle} degrees`, () => {
		expect(recognizeOrthogonalSurface(plane('z', angle), new THREE.Vector3(), 1)).toBeNull();
	});
	it('preserves the seed at survey magnitudes despite noise', () => {
		const seed = new THREE.Vector3(500000, 4000000, 100.003);
		const points = plane('z', 0, seed);
		points.forEach((point, i) => {point.z += Math.sin(i * 7) * 0.002;});
		const surface = recognizeOrthogonalSurface(points, seed, 1);
		expect(surface.axis).toBe('z');
		expect(surface.position.toArray()).toEqual(seed.toArray());
	});
	it('rejects sparse, duplicate and line-only support', () => {
		expect(recognizeOrthogonalSurface(plane('z').slice(0, 8), new THREE.Vector3(), 1)).toBeNull();
		expect(recognizeOrthogonalSurface(Array(50).fill(new THREE.Vector3()), new THREE.Vector3(), 1)).toBeNull();
		expect(recognizeOrthogonalSurface(Array.from({length: 50}, (_, i) => new THREE.Vector3(i / 50, 0, 0)), new THREE.Vector3(), 1)).toBeNull();
	});
	it('rejects a corner containing competing planes', () => {
		expect(recognizeOrthogonalSurface([...plane('z'), ...plane('x')], new THREE.Vector3(), 1)).toBeNull();
	});
	it('excludes spatially distant screen neighbors', () => {
		expect(recognizeOrthogonalSurface([...plane('z'), ...plane('x', 0, new THREE.Vector3(0, 0, 5))], new THREE.Vector3(), 1)?.axis).toBe('z');
	});
	it('rejects a seed off the estimated surface', () => {
		expect(recognizeOrthogonalSurface(plane('z', 0, new THREE.Vector3(0, 0, 0.2)), new THREE.Vector3(), 1)).toBeNull();
	});
	it('projects only the locked coordinate, including plane extensions', () => {
		const start = new THREE.Vector3(2, 3, 0.008);
		expect(projectOrthogonalEndpoint(start, new THREE.Vector3(8, 9, 3.012), 'z').toArray()).toEqual([2, 3, 3.012]);
		expect(start.toArray()).toEqual([2, 3, 0.008]);
	});
});

// Use the real picker orchestration with deterministic GPU-hit batches to verify sampling policy.
describe('adaptive orthogonal surface picking', () => {
	function fixture(width = 800, height = 600) {
		const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
		camera.position.set(0, 0, 10); camera.updateMatrixWorld(true);
		const pointcloud = {pick: vi.fn()};
		const position = new THREE.Vector3(0.6, 0, 0);
		return {camera, pointcloud, position, viewer: {
			scene: {getActiveCamera: () => camera}, renderer: {domElement: {clientWidth: width, clientHeight: height}},
		}};
	}
	it('centers on the projected seed and expands only when the first batch lacks support', () => {
		const {viewer, camera, position, pointcloud} = fixture();
		const points = plane('z', 0, position).map(position => ({position}));
		pointcloud.pick.mockReturnValueOnce(points.slice(0, 3)).mockReturnValue(points);
		const result = pickOrthogonalSurface(viewer, new THREE.Vector2(400, 300), {point: {position, pointcloud}});
		expect(result.axis).toBe('z'); expect(result.position.toArray()).toEqual(position.toArray());
		expect(pointcloud.pick.mock.calls.map(call => call[3].pickWindowSize)).toEqual([49, 97]);
		const projected = position.clone().project(camera);
		expect(pointcloud.pick.mock.calls[0][3].x).toBeCloseTo((projected.x + 1) * 400);
		expect(pointcloud.pick.mock.calls[0][3].x).toBeGreaterThan(424.5);
	});
	it('keeps ambiguous corners invalid instead of expanding until a different plane dominates', () => {
		const {viewer, position, pointcloud} = fixture();
		pointcloud.pick.mockReturnValue([...plane('z', 0, position), ...plane('x', 0, position)].map(position => ({position})));
		expect(pickOrthogonalSurface(viewer, new THREE.Vector2(400, 300), {point: {position, pointcloud}})).toBeNull();
		expect(pointcloud.pick).toHaveBeenCalledTimes(1);
	});
	it('bounds empty-region retries to three windows', () => {
		const {viewer, position, pointcloud} = fixture(); pointcloud.pick.mockReturnValue([]);
		expect(pickOrthogonalSurface(viewer, new THREE.Vector2(400, 300), {point: {position, pointcloud}})).toBeNull();
		expect(pointcloud.pick.mock.calls.map(call => call[3].pickWindowSize)).toEqual([49, 97, 145]);
	});
	it('clamps adaptive windows and readback rectangles inside small viewports', () => {
		const {viewer, position, pointcloud} = fixture(80, 60); pointcloud.pick.mockReturnValue([]);
		pickOrthogonalSurface(viewer, new THREE.Vector2(79, 0), {point: {position, pointcloud}});
		expect(pointcloud.pick.mock.calls.map(call => call[3].pickWindowSize)).toEqual([49, 59]);
		for (const call of pointcloud.pick.mock.calls) {
			const {x, y, pickWindowSize} = call[3], half = (pickWindowSize - 1) / 2;
			expect(x - half).toBeGreaterThanOrEqual(0); expect(x + half).toBeLessThan(80);
			expect(y - half).toBeGreaterThanOrEqual(0); expect(y + half).toBeLessThan(60);
		}
	});
});
