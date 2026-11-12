import * as THREE from '../libs/three.js/build/three.module.js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {EventDispatcher} from '../src/EventDispatcher.js';

// Keep real Measure geometry while replacing only canvas texture creation and GPU picking.
vi.mock('../libs/konva/lib/shapes/Circle.js', () => ({Circle: class {toCanvas() {return document.createElement('canvas');}}}));
vi.mock('../src/utils/OrthogonalSurface.js', async importOriginal => ({...await importOriginal(), pickOrthogonalSurface: vi.fn(), pickOrthogonalPoint: vi.fn()}));
const {pickOrthogonalSurface, pickOrthogonalPoint} = await import('../src/utils/OrthogonalSurface.js');
const {OrthogonalMeasurementTool} = await import('../src/utils/OrthogonalMeasurementTool.js');
const {Measure} = await import('../src/utils/Measure.js');
const {createMeasurementData} = await import('../src/viewer/SaveProject.js');
const {loadMeasurement} = await import('../src/viewer/LoadProject.js');

describe('orthogonal measurement transactions', () => {
	let viewer, tool, canvas;
	// Start recognition and unconstrained target picking intentionally use separate seams.
	const hit = (axis, position) => {
		const normal = new THREE.Vector3(); normal[axis] = 1;
		pickOrthogonalSurface.mockReturnValue({axis, normal, position: new THREE.Vector3(...position)});
		pickOrthogonalPoint.mockReturnValue({position: new THREE.Vector3(...position)});
	};
	beforeEach(() => {
		viewer = new EventDispatcher();
		canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		Object.defineProperty(canvas, 'clientWidth', {value: 800});
		Object.defineProperty(canvas, 'clientHeight', {value: 600});
		const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
		camera.position.set(0, 0, 10);
		viewer.renderer = {domElement: canvas};
		viewer.inputHandler = {getEventLocalPosition: event => new THREE.Vector2(event.clientX, event.clientY), isTapGesture: () => true};
		viewer.measuringTool = {scene: new THREE.Scene(), stopInsertion: vi.fn(), getRenderAreaElement: () => document.body, setActiveMeasurement: vi.fn()};
		viewer.scene = Object.assign(new EventDispatcher(), {
			// Match the scene contract required by real measurement label updates.
			measurements: [], pointclouds: [], getActiveCamera: () => camera,
			addMeasurement(measurement) {this.measurements.push(measurement);},
			removeMeasurement(measurement) {this.measurements = this.measurements.filter(item => item !== measurement); this.dispatchEvent({type: 'measurement_removed', measurement});},
			addMeasurement2platform: vi.fn(),
		});
		tool = new OrthogonalMeasurementTool(viewer);
		viewer.orthogonalMeasurementTool = tool;
		pickOrthogonalSurface.mockReturnValue(null);
		pickOrthogonalPoint.mockReturnValue(null);
	});
	afterEach(() => {tool.dispose(); canvas.remove(); vi.clearAllMocks();});
	function click(detail = 1) {
		for (const type of ['mousedown', 'mouseup']) canvas.dispatchEvent(new MouseEvent(type, {button: 0, detail, clientX: 10, clientY: 20, bubbles: true}));
	}
	function saved() {
		const measurement = new Measure(viewer);
		measurement.name = 'orthogonal'; measurement.orthogonalAxis = 'z'; measurement.finished = true;
		measurement.addMarker(new THREE.Vector3(2, 3, 0)); measurement.addMarker(new THREE.Vector3(2, 3, 3));
		viewer.scene.addMeasurement(measurement);
		return measurement;
	}
	function drag(measurement, index) {return {drag: {object: measurement.spheres[index], end: new THREE.Vector2(10, 20)}};}
	it('orients the cursor disk to its fitted plane independently of the locked measurement axis', () => {
		// A vertical line must coexist with both wall-facing and sloped cursor disks.
		tool.startInsertion(); hit('z', [2, 3, 0]); click();
		for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.5, 0, Math.sqrt(0.75))]) {
			const position = new THREE.Vector3(8, 9, 3);
			pickOrthogonalPoint.mockReturnValue({position});
			pickOrthogonalSurface.mockReturnValue({axis: 'x', normal, position});
			tool.refresh(new THREE.Vector2(10, 20));
			const diskNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(tool.circles[1].quaternion);
			expect(Math.abs(diskNormal.dot(normal))).toBeCloseTo(1, 10);
			expect(tool.draft.points[1].position.toArray()).toEqual([2, 3, 3]);
		}
		pickOrthogonalSurface.mockReturnValue(null); tool.refresh(new THREE.Vector2(10, 20));
		expect(tool.circles[1].visible).toBe(false);
		expect(tool.draft.showEdges).toBe(true); click();
		expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledTimes(1);
	});
	it('keeps the first fitted normal while snapping only the measuring axis', () => {
		// Slightly tilted valid floors must retain their real disk orientation.
		tool.startInsertion(); hit('z', [2, 3, 0]);
		const normal = new THREE.Vector3(0.1, 0, Math.sqrt(0.99));
		pickOrthogonalSurface.mockReturnValue({axis: 'z', normal, position: new THREE.Vector3(2, 3, 0)});
		click(); hit('x', [8, 9, 3]); tool.refresh(new THREE.Vector2(10, 20));
		expect(new THREE.Vector3(0, 0, 1).applyQuaternion(tool.circles[0].quaternion).dot(normal)).toBeCloseTo(1, 10);
		expect(tool.draft.points[1].position.toArray()).toEqual([2, 3, 3]);
	});
	it('renders disk feedback before measurement overlays clear the scene depth', () => {
		// The feedback scene must not be attached to the depth-free measurement overlay.
		viewer.renderer.render = vi.fn(); tool.startInsertion(); hit('z', [2, 3, 0]); click();
		viewer.dispatchEvent({type: 'render.pass.scene'});
		expect(viewer.renderer.render).toHaveBeenCalledWith(tool.scene, viewer.scene.getActiveCamera());
		expect(tool.circles[0].parent).toBe(tool.scene);
	});
	it('discards the draft and deactivates the tool on Escape', () => {
		// Explicit exit gestures still notify the host to clear toolbar selection.
		const deactivated = vi.fn(); tool.addEventListener('orthogonal_deactivated', deactivated);
		tool.startInsertion(); hit('z', [2, 3, 0]); click();
		document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
		expect(tool.active).toBe(false); expect(tool.draft).toBeNull();
		expect(viewer.scene.measurements).toHaveLength(0);
		expect(deactivated).toHaveBeenCalledTimes(1);
		expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
	});
	for (const order of [['mouseup'], ['contextmenu'], ['contextmenu', 'mouseup'], ['mouseup', 'contextmenu']]) {
		it(`keeps the tool selected after right-click cancellation (${order.join(', ')})`, () => {
			// Test native event orders, saved-result preservation and the next measurement in one flow.
			const existing = saved();
			const deactivated = vi.fn(); tool.addEventListener('orthogonal_deactivated', deactivated);
			tool.startInsertion(); hit('z', [2, 3, 0]); click();
			hit('x', [8, 9, 3]); tool.refresh(new THREE.Vector2(10, 20));
			canvas.dispatchEvent(new MouseEvent('mousedown', {button: 2, clientX: 10, clientY: 20, bubbles: true}));
			for (const type of order) canvas.dispatchEvent(new MouseEvent(type, {button: 2, clientX: 10, clientY: 20, bubbles: true}));
			expect(tool.active).toBe(true); expect(tool.draft).toBeNull();
			expect(viewer.scene.measurements).toEqual([existing]);
			expect(deactivated).not.toHaveBeenCalled();
			expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
			// Repeated cancellation before a new first point must also keep drawing enabled.
			canvas.dispatchEvent(new MouseEvent('contextmenu', {button: 2, bubbles: true}));
			hit('z', [4, 5, 0]); click();
			expect(tool.draft.points[0].position.toArray()).toEqual([4, 5, 0]);
			hit('x', [8, 9, 2]); click();
			expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledTimes(1);
			expect(tool.active).toBe(true); expect(deactivated).not.toHaveBeenCalled();
		});
	}
	it('blocks ambiguous starts but accepts any target point and saves exactly two projected points', () => {
		tool.startInsertion(); click(); expect(tool.draft).toBeNull();
		hit('z', [2, 3, 0]); click(); expect(tool.draft.points).toHaveLength(2);
		// A nonparallel target must update the line before the second click.
		hit('x', [8, 9, 3]); tool.refresh(new THREE.Vector2(10, 20));
		expect(tool.draft.points[1].position.toArray()).toEqual([2, 3, 3]);
		expect(tool.draft.showEdges).toBe(true);
		click();
		const measurement = viewer.scene.addMeasurement2platform.mock.calls[0][0];
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 3]]);
		expect(tool.active).toBe(true); expect(tool.draft).toBeNull();
		click(2); expect(viewer.scene.addMeasurement2platform).toHaveBeenCalledTimes(1);
	});
	it('keeps the live line during pointer invalidation and rejects only missing target hits', () => {
		tool.startInsertion(); hit('z', [2, 3, 0]); click();
		pickOrthogonalSurface.mockReturnValue(null);
		pickOrthogonalPoint.mockReturnValue({position: new THREE.Vector3(8, 9, 2)});
		tool.refresh(new THREE.Vector2(10, 20));
		expect(tool.draft.points[1].position.toArray()).toEqual([2, 3, 2]);
		canvas.dispatchEvent(new MouseEvent('mousemove', {clientX: 12, clientY: 22}));
		expect(tool.draft.showEdges).toBe(true);
		expect(tool.draft.spheres[1].visible).toBe(true);
		pickOrthogonalPoint.mockReturnValue(null); click();
		expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
		expect(tool.draft.points[1].position.z).toBe(2);
		expect(tool).not.toHaveProperty('hint');
	});
	it('invalidates a previously valid hover before committing', () => {
		tool.startInsertion(); hit('z', [2, 3, 0]); tool.refresh(new THREE.Vector2(10, 20));
		pickOrthogonalSurface.mockReturnValue(null); click(); expect(tool.draft).toBeNull();
	});
	it('does not read GPU pixels repeatedly while pointer, camera and scene are unchanged', () => {
		tool.startInsertion(); hit('z', [2, 3, 0]); tool.mouse = new THREE.Vector2(10, 20);
		tool.update(); tool.update();
		expect(pickOrthogonalSurface).toHaveBeenCalledTimes(1);
		viewer.scene.getActiveCamera().position.x = 2;
		viewer.scene.getActiveCamera().updateMatrixWorld(true);
		tool.update(); expect(pickOrthogonalSurface).toHaveBeenCalledTimes(2);
	});
	it('rejects zero length and cancels drafts without persistence', () => {
		tool.startInsertion(); hit('z', [2, 3, 0]); click(); click();
		expect(viewer.scene.addMeasurement2platform).not.toHaveBeenCalled();
		tool.stopInsertion(); expect(viewer.scene.measurements).toHaveLength(0);
	});
	it('moves the start transversely without changing the target height', () => {
		const measurement = saved(); const event = drag(measurement, 0);
		hit('z', [5, 6, 0.1]); tool.handleMarkerDrag(event, measurement); tool.handleMarkerDrop(event, measurement);
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[5, 6, 0.1], [5, 6, 3]]);
	});
	it('does not edit when the host disables desktop-only editing', () => {
		const measurement = saved(); tool.editingEnabled = false;
		hit('z', [5, 6, 1]); tool.handleMarkerDrag(drag(measurement, 0), measurement);
		expect(tool.edit).toBeNull();
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 3]]);
	});
	it('commits a target edit on native mouseup before InputHandler clears the drag', () => {
		// Target editing accepts a point even when no valid local plane can be recognized.
		const measurement = saved(); hit('x', [8, 9, 4]); pickOrthogonalSurface.mockReturnValue(null);
		tool.handleMarkerDrag(drag(measurement, 1), measurement);
		const changed = vi.fn(); viewer.scene.addEventListener('orthogonal_measurement_updated', changed);
		canvas.dispatchEvent(new MouseEvent('mouseup', {button: 0, clientX: 10, clientY: 20, bubbles: true}));
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 4]]);
		expect(changed).toHaveBeenCalledTimes(1); expect(tool.edit).toBeNull();
	});
	it('rolls back both endpoints on invalid release or cancellation', () => {
		const measurement = saved(); const event = drag(measurement, 0);
		hit('z', [5, 6, 1]); tool.handleMarkerDrag(event, measurement);
		hit('x', [5, 6, 1]); tool.handleMarkerDrop(event, measurement);
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 3]]);
		hit('z', [5, 6, 1]); tool.handleMarkerDrag(event, measurement); tool.stopInsertion();
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 3]]);
	});
	it('roundtrips type, visibility, two endpoints and locked axis through project serialization', () => {
		const measurement = saved(); measurement.visible = false;
		const data = createMeasurementData(measurement);
		viewer.scene.measurements = [];
		const loaded = loadMeasurement(viewer, data);
		expect(loaded.name).toBe('orthogonal'); expect(loaded.orthogonalAxis).toBe('z');
		expect(loaded.visible).toBe(false); expect(loaded.maxMarkers).toBe(2);
		expect(loaded.points.map(point => point.position.toArray())).toEqual([[2, 3, 0], [2, 3, 3]]);
	});
	it('cancels an edit at the rebased coordinates rather than restoring the previous origin', () => {
		const measurement = saved(); hit('z', [5, 6, 1]); tool.handleMarkerDrag(drag(measurement, 0), measurement);
		const delta = new THREE.Vector3(100, 200, 300);
		measurement.points.forEach(point => point.position.add(delta));
		viewer.scene.dispatchEvent({type: 'pointcloud_offset_changed', delta});
		expect(measurement.points.map(point => point.position.toArray())).toEqual([[102, 203, 300], [102, 203, 303]]);
		expect(tool.edit).toBeNull();
	});
});
