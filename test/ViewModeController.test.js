import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {FJDCameraControls} from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";
import {EventDispatcher} from "../src/EventDispatcher.js";

FJDCameraControls.install({THREE});
let Viewer;
let activeControls = [];

// Exercise the public Viewer methods with real controls and a deterministic viewport.
function createViewer(orthographic = false, box = new THREE.Box3(new THREE.Vector3(-3, -5, -2), new THREE.Vector3(7, 11, 4))) {
	const element = document.createElement("div");
	element.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600});
	document.body.appendChild(element);
	const camera = orthographic
		? new THREE.OrthographicCamera(-20, 20, 15, -15, -1000, 1000)
		: new THREE.PerspectiveCamera(75, 4 / 3, 0.1, 1000);
	camera.up.set(0, 0, 1);
	camera.position.set(0, -30, 15);
	camera.lookAt(0, 0, 0);
	const controls = new FJDCameraControls(camera, element);
	controls.syncFromCameraAndViewTarget(new THREE.Vector3());
	activeControls.push(controls);
	controls.touches.two = () => camera.isOrthographicCamera
		? FJDCameraControls.ACTION.TOUCH_ZOOM_TRUCK
		: FJDCameraControls.ACTION.TOUCH_DOLLY_TRUCK;
	const viewer = Object.assign(new EventDispatcher(), {
		renderArea: element,
		camera,
		controls,
		fjdCameraControls: controls,
		scene: {pointclouds: [{}], view: {}, cameraMode: orthographic ? 0 : 1},
		setCameraMode(mode) {this.scene.cameraMode = mode;},
		getBoundingBox: vi.fn(() => box.clone()),
		setControls(next) {this.controls = next;},
		syncControlsContext(next) {next.setCamera(this.camera);},
		setTopView4CameraControls: vi.fn((_animate, options) => controls.fitToTopViewBox(box, false, options)),
		setViewMode: Viewer.prototype.setViewMode,
		getViewMode: Viewer.prototype.getViewMode,
		fitViewMode: Viewer.prototype.fitViewMode,
		captureViewModeState: Viewer.prototype.captureViewModeState,
		restoreViewModeState: Viewer.prototype.restoreViewModeState,
	});
	return {viewer, controls, camera, element, box};
}

// Native pointer input reaches the same mouse and touch handlers used in the browser.
function pointer(target, type, x, y, {button = 0, id = 1, touch = false} = {}) {
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons: type === "pointerup" ? 0 : button === 2 ? 2 : 1});
	Object.defineProperties(event, {
		pointerId: {value: id},
		pointerType: {value: touch ? "touch" : "mouse"},
	});
	target.dispatchEvent(event);
}

// Advance both the orientation guard and the control core's release inertia.
function advance(viewer, count = 30) {
	for (let index = 0; index < count; index++) {
		viewer.dispatchEvent({type: "update_start", delta: 1 / 60});
		viewer.controls.update(1 / 60);
	}
}

describe("opt-in Viewer axis modes", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => {
		activeControls.forEach((controls) => controls.dispose());
		activeControls = [];
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("leaves an untouched Viewer and its input configuration unchanged", () => {
		const {viewer, controls} = createViewer();
		const left = controls.mouseButtons.left;
		viewer.setViewMode("3d", {animate: false});
		expect(viewer.getViewMode()).toBe("3d");
		expect(viewer.viewModeController).toBeUndefined();
		// Axis-mode access must not implicitly initialize DOM labels.
		expect(viewer.pointCloudLabelTool).toBeUndefined();
		expect(controls.mouseButtons.left).toBe(left);
		expect(viewer.setTopView4CameraControls).not.toHaveBeenCalled();
	});

	// Frame-driven transitions must preserve the starting pose and reach an exact locked endpoint.
	for (const orthographic of [false, true]) {
		it(`animates orientation, position and zoom over 350ms, ortho=${orthographic}`, () => {
			const {viewer, controls, camera} = createViewer(orthographic);
			viewer.setViewMode("front", {animate: false});
			const start = controls.getRigidPose(false);
			viewer.setViewMode("left");
			expect(controls.getRigidPose(false)).toEqual(start);
			expect(controls.enabled).toBe(false);
			advance(viewer, 10);
			const middle = controls.getRigidPose(false);
			expect(middle.position).not.toEqual(start.position);
			expect(middle.quaternion).not.toEqual(start.quaternion);
			expect(Math.abs(camera.getWorldDirection(new THREE.Vector3()).x)).toBeLessThan(0.999);
			if (orthographic) expect(middle.zoom).not.toBeCloseTo(start.zoom);
			advance(viewer, 11);
			expect(viewer.viewModeController.transition).toBeNull();
			expect(controls.enabled).toBe(true);
			expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-8);
			const final = controls.getRigidPose(false);
			advance(viewer);
			expect(controls.getRigidPose(false)).toEqual(final);
		});
	}

	it("orbits around the cloud during opposite-axis transitions instead of crossing its center", () => {
		const {viewer, controls, box} = createViewer();
		viewer.setViewMode("top", {animate: false});
		viewer.setViewMode("bottom", {duration: 400});
		advance(viewer, 12);
		const pose = controls.getRigidPose(false);
		const distance = new THREE.Vector3().fromArray(pose.position).distanceTo(box.getCenter(new THREE.Vector3()));
		expect(distance).toBeGreaterThan(5);
		expect(Math.abs(controls.camera.getWorldDirection(new THREE.Vector3()).z)).toBeLessThan(1e-7);
		advance(viewer, 12);
		expect(viewer.viewModeController.transition).toBeNull();
	});

	it("replaces rapid requests at the current interpolated pose without queuing old targets", () => {
		const {viewer, controls, camera} = createViewer();
		viewer.setViewMode("front", {animate: false});
		viewer.setViewMode("left");
		advance(viewer, 5);
		const current = controls.getRigidPose(false);
		viewer.setViewMode("right");
		expect(controls.getRigidPose(false)).toEqual(current);
		expect(controls.enabled).toBe(false);
		advance(viewer, 21);
		expect(viewer.getViewMode()).toBe("right");
		expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-8);
		expect(controls.enabled).toBe(true);
	});

	it("cancels mid-animation when returning to 3D and retains the current framing", () => {
		const {viewer, controls} = createViewer();
		viewer.setViewMode("front", {animate: false});
		viewer.setViewMode("left");
		advance(viewer, 7);
		const current = controls.getRigidPose(false);
		viewer.setViewMode("3d");
		advance(viewer);
		expect(controls.getRigidPose(false)).toEqual(current);
		expect(controls.enabled).toBe(true);
		expect(controls.mouseButtons.left).toBe(FJDCameraControls.ACTION.ROTATE);
		expect(viewer.viewModeController.transition).toBeNull();
	});

	it("blocks competing pointer and wheel input during the transition", () => {
		const {viewer, controls, element} = createViewer();
		viewer.setViewMode("front", {animate: false});
		viewer.setViewMode("left");
		advance(viewer, 5);
		const current = controls.getRigidPose(false);
		pointer(element, "pointerdown", 100, 100, {button: 2});
		pointer(document, "pointermove", 180, 170, {button: 2});
		pointer(document, "pointerup", 180, 170, {button: 2});
		element.dispatchEvent(new WheelEvent("wheel", {deltaY: -120, cancelable: true}));
		pointer(element, "pointerdown", 100, 100, {touch: true});
		pointer(document, "pointerup", 180, 170, {touch: true});
		expect(controls.getRigidPose(false)).toEqual(current);
		advance(viewer, 16);
		expect(controls.enabled).toBe(true);
	});

	it("settles tool snapshots and explicit refits without leaving a stale animation", () => {
		const {viewer, controls} = createViewer();
		viewer.setViewMode("left");
		advance(viewer, 3);
		const state = viewer.captureViewModeState();
		expect(viewer.viewModeController.transition).toBeNull();
		expect(controls.enabled).toBe(true);
		expect(state.mode).toBe("left");
		viewer.setViewMode("top");
		advance(viewer, 4);
		viewer.restoreViewModeState(state);
		advance(viewer);
		expect(controls.getRigidPose(false)).toEqual(state.pose);
		viewer.setViewMode("right");
		viewer.fitViewMode();
		expect(viewer.viewModeController.transition).toBeNull();
		expect(controls.enabled).toBe(true);
	});

	it("supports zero-duration switches and restores a host-disabled input state", () => {
		const {viewer, controls} = createViewer();
		viewer.setViewMode("left", {duration: 0});
		expect(viewer.viewModeController.transition).toBeNull();
		controls.enabled = false;
		viewer.setViewMode("right");
		advance(viewer, 21);
		expect(controls.enabled).toBe(false);
	});

	for (const orthographic of [false, true]) {
		for (const [mode, direction, up] of [
			["top", [0, 0, -1], [0, 1, 0]],
			["bottom", [0, 0, 1], [0, 1, 0]],
			["left", [1, 0, 0], [0, 0, 1]],
			["right", [-1, 0, 0], [0, 0, 1]],
			["front", [0, 1, 0], [0, 0, 1]],
			["back", [0, -1, 0], [0, 0, 1]],
		]) {
			it(`fits all corners and preserves screen orientation in ${mode}, ortho=${orthographic}`, () => {
				const {viewer, camera, box} = createViewer(orthographic);
				viewer.setViewMode(mode, {animate: false});
				camera.updateMatrixWorld(true);
				expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(...direction))).toBeLessThan(1e-8);
				expect(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).distanceTo(new THREE.Vector3(...up))).toBeLessThan(1e-8);
				expect(camera.isOrthographicCamera === true).toBe(orthographic);
				for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
					const point = new THREE.Vector3(x, y, z).project(camera);
					expect(Math.abs(point.x)).toBeLessThanOrEqual(1.000001);
					expect(Math.abs(point.y)).toBeLessThanOrEqual(1.000001);
				}
			});
		}
	}

	it("preserves top-view framing and restores callback input values without resetting 3D", () => {
		const {viewer, controls, camera} = createViewer();
		const left = () => FJDCameraControls.ACTION.ROTATE;
		const one = () => FJDCameraControls.ACTION.ROTATE;
		const two = controls.touches.two;
		controls.mouseButtons.left = left;
		controls.touches.one = one;
		const changed = vi.fn();
		viewer.addEventListener("view_mode_changed", changed);
		viewer.setViewMode("top", {animate: false});
		expect(viewer.setTopView4CameraControls).toHaveBeenCalledWith(false, {});
		viewer.setViewMode("left", {animate: false});
		controls.truck(10, 20, false);
		const pose = controls.getRigidPose();
		viewer.setViewMode("3d", {animate: false});
		expect(controls.getRigidPose()).toEqual(pose);
		expect(controls.mouseButtons.left).toBe(left);
		expect(controls.touches.one).toBe(one);
		expect(controls.touches.two).toBe(two);
		const rotation = camera.quaternion.clone();
		controls.rotate(0.2, 0.1, false);
		expect(camera.quaternion.angleTo(rotation)).toBeGreaterThan(0.01);
		expect(changed).toHaveBeenCalledTimes(3);
		expect(viewer._listeners.update_start).toHaveLength(0);
	});

	it("blocks left and single-touch rotation but keeps right drag and wheel input", () => {
		const {viewer, controls, camera, element} = createViewer();
		viewer.setViewMode("front", {animate: false});
		const quaternion = camera.quaternion.clone();
		const position = camera.position.clone();
		for (const touch of [false, true]) {
			pointer(element, "pointerdown", 100, 100, {touch});
			pointer(document, "pointermove", 170, 160, {touch});
			pointer(document, "pointerup", 170, 160, {touch});
		}
		advance(viewer);
		expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
		pointer(element, "pointerdown", 100, 100, {button: 2});
		pointer(document, "pointermove", 170, 160, {button: 2});
		pointer(document, "pointerup", 170, 160, {button: 2});
		advance(viewer);
		expect(camera.position.distanceTo(position)).toBeGreaterThan(0.1);
		const distance = controls.getPosition(new THREE.Vector3()).distanceTo(controls.getTarget(new THREE.Vector3()));
		element.dispatchEvent(new WheelEvent("wheel", {deltaY: -120, cancelable: true}));
		advance(viewer);
		expect(controls.getPosition(new THREE.Vector3()).distanceTo(controls.getTarget(new THREE.Vector3()))).not.toBeCloseTo(distance);
		expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-8);
	});

	for (const orthographic of [false, true]) {
		it(`supports two-touch pan and pinch with release inertia, ortho=${orthographic}`, () => {
			const {viewer, controls, camera, element} = createViewer(orthographic);
			viewer.setViewMode("bottom", {animate: false});
			const pose = controls.getRigidPose();
			pointer(element, "pointerdown", 100, 100, {touch: true, id: 1});
			pointer(element, "pointerdown", 200, 100, {touch: true, id: 2});
			pointer(document, "pointermove", 60, 130, {touch: true, id: 1});
			pointer(document, "pointermove", 260, 130, {touch: true, id: 2});
			pointer(document, "pointerup", 60, 130, {touch: true, id: 1});
			pointer(document, "pointerup", 260, 130, {touch: true, id: 2});
			advance(viewer);
			expect(camera.quaternion.angleTo(new THREE.Quaternion().fromArray(pose.quaternion))).toBeLessThan(1e-8);
			expect(controls.getRigidPose().position).not.toEqual(pose.position);
			if (orthographic) expect(camera.zoom).not.toBeCloseTo(pose.zoom);
		});
	}

	it("cancels release inertia when unlocking while retaining the visible pose", () => {
		const {viewer, controls, element} = createViewer();
		viewer.setViewMode("front", {animate: false});
		pointer(element, "pointerdown", 100, 100, {button: 2});
		pointer(document, "pointermove", 170, 160, {button: 2});
		pointer(document, "pointerup", 170, 160, {button: 2});
		const pose = controls.getRigidPose(false);
		viewer.setViewMode("3d", {animate: false});
		advance(viewer);
		expect(controls.getRigidPose(false)).toEqual(pose);
	});

	it("guards external orientation changes, refits the current axis, and rejects invalid modes", () => {
		const {viewer, controls, camera} = createViewer();
		viewer.setViewMode("right", {animate: false});
		const quaternion = camera.quaternion.clone();
		controls.rotate(0.5, 0.5, false);
		advance(viewer);
		expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-8);
		controls.truck(20, 20, false);
		viewer.setViewMode("right", {animate: false});
		const position = camera.position.clone();
		viewer.fitViewMode();
		expect(camera.position.distanceTo(position)).toBeGreaterThan(0.1);
		expect(() => viewer.setViewMode("invalid", {animate: false})).toThrow(RangeError);
		expect(viewer.getViewMode()).toBe("right");
	});

	it("restores temporary view sessions without truncating large array coordinates", () => {
		const box = new THREE.Box3(new THREE.Vector3(1132890, 5509490, 850), new THREE.Vector3(1132990, 5509590, 950));
		const {viewer, controls} = createViewer(false, box);
		viewer.setViewMode("right", {animate: false});
		const state = viewer.captureViewModeState();
		viewer.setViewMode("top", {animate: false});
		viewer.scene.cameraMode = 0;
		viewer.restoreViewModeState(state);
		expect(viewer.getViewMode()).toBe("right");
		expect(viewer.scene.cameraMode).toBe(1);
		expect(controls.getRigidPose(false)).toEqual(state.pose);
		advance(viewer);
		expect(controls.getRigidPose(false)).toEqual(state.pose);
	});

	it("keeps empty and zero-extent scenes finite and honors visible-cloud filtering", () => {
		const {viewer, camera} = createViewer(false, new THREE.Box3());
		const hidden = {visible: false};
		const visible = {};
		viewer.scene.pointclouds = [hidden, visible];
		viewer.setViewMode("back", {animate: false});
		expect(viewer.fitViewMode()).toBe(false);
		expect(viewer.getBoundingBox).toHaveBeenLastCalledWith([visible]);
		viewer.getBoundingBox.mockReturnValue(new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3)));
		expect(viewer.fitViewMode()).toBe(true);
		expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
		expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
	});
});
