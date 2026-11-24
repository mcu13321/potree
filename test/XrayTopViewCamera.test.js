import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {Box3, PerspectiveCamera, Quaternion, Vector3} from "../libs/three.js/build/three.module.js";
import {FJDCameraControls, ensureFJDCameraControlsInstalled} from "../src/FJDCameraControlsHost.js";
import {CameraMode} from "../src/defines.js";
import {setPointCloudStationHidden} from "../src/utils/PointCloudLabelAppearance.js";
import {Scene} from "../src/viewer/Scene.js";
import {XrayTopViewCamera} from "../src/viewer/XrayTopViewCamera.js";

let Viewer;

beforeAll(async () => {
	// The native map module expects the browser host to install proj4.
	vi.stubGlobal("proj4", {defs: vi.fn()});
	({Viewer} = await import("../src/viewer/viewer.js"));
});

afterAll(() => vi.unstubAllGlobals());

const toRadians = angle => angle * Math.PI / 180;
const up = new Vector3(0, 0, 1);
const xAxis = new Vector3(1, 0, 0);

function pointCamera(camera, degrees, heading = 0){
	const tilt = new Quaternion().setFromAxisAngle(xAxis, toRadians(degrees));
	camera.quaternion.setFromAxisAngle(up, toRadians(heading)).multiply(tilt);
	camera.updateMatrixWorld(true);
}

function setup(){
	const perspective = new PerspectiveCamera(60, 1.5, 0.1, 1000);
	perspective.position.set(10, 20, 30);
	const target = new Vector3(9, 20, 10);
	const controls = {getTarget: (out) => out.copy(target)};
	return {perspective, target, controls, snap: new XrayTopViewCamera()};
}

// Run the native fit and snap against the same rigid controls used by the viewer.
function setupFit(){
	ensureFJDCameraControlsInstalled();
	const viewer = Object.create(Viewer.prototype);
	const camera = new PerspectiveCamera(60, 1.5, 0.1, 1000);
	camera.up.copy(up);
	camera.position.set(0, -15, 30);
	camera.lookAt(0, 0, 4);
	const controls = new FJDCameraControls(camera);
	const box = new Box3(new Vector3(-10, -8, 0), new Vector3(10, 8, 8));
	const center = box.getCenter(new Vector3());
	const scene = Object.assign(Object.create(Scene.prototype), {
		cameraP: camera,
		cameraMode: CameraMode.PERSPECTIVE,
		view: {},
		pointclouds: [{visible: true, material: {}, userData: {xrayEnabled: true}}],
		getBoundingBox: () => box.clone(),
	});
	viewer.scene = scene;
	viewer.controls = viewer.fjdCameraControls = controls;
	viewer.renderer = {xr: {isPresenting: false}};
	viewer.isXraySplatPipelineSupported = () => true;
	viewer.getTopViewFitOptions = () => ({viewport: {x: 0.4, y: 0, width: 0.6, height: 1}});
	viewer.setXrayTopViewEnabled(true);
	const step = (delta = 1 / 60) => {
		if (!viewer._xrayTopView.isAnimating) controls.update(delta);
		camera.updateProjectionMatrix();
		viewer.updateXrayTopViewCamera(viewer.canUseXrayTopViewCamera(), delta);
	};
	const project = () => center.clone().project(scene.getActiveCamera());
	viewer.setTopView4CameraControls(false);
	step(0);
	return {viewer, controls, center, step, project};
}

describe("Temporary top-view projection", () => {
	it("snaps at six degrees, holds through small changes and releases at nine degrees", () => {
		const {perspective, controls, snap} = setup();
		const expected = [false, true, true, false, false, true, false];
		const angles = [6.1, 6, 8.9, 9, 8, 0, 180];
		// Vary the input camera continuously across both boundaries without resetting the gesture.
		const states = angles.map(angle => {
			pointCamera(perspective, angle);
			return !!snap.update(perspective, controls, 1);
		});
		expect(states).toEqual(expected);
	});

	it("levels the camera while preserving the heading and the projection at the orbit point", () => {
		const {perspective, controls, snap, target} = setup();
		pointCamera(perspective, 2, 37);
		perspective.filmOffset = 3;
		perspective.updateProjectionMatrix();
		const inputPose = perspective.quaternion.clone();
		snap.update(perspective, controls, 1);
		const ortho = snap.update(perspective, controls, 1, 0.4);
		const horizontal = new Vector3(1, 0, 0).applyQuaternion(ortho.quaternion);
		const expected = new Vector3(1, 0, 0).applyAxisAngle(up, toRadians(37));
		const before = target.clone().project(perspective);
		const after = target.clone().project(ortho);
		expect(horizontal.distanceTo(expected)).toBeLessThan(1e-10);
		expect(ortho.getWorldDirection(new Vector3()).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
		expect(after.x).toBeCloseTo(before.x, 4);
		expect(after.y).toBeCloseTo(before.y, 4);
		expect(perspective.quaternion.equals(inputPose)).toBe(true);
	});

	it("eases from the live pose to level with a fixed frame rate-independent duration", () => {
		const {perspective, controls, snap} = setup();
		pointCamera(perspective, 6);
		const camera = snap.update(perspective, controls, 1);
		const tilt = () => Math.acos(Math.min(1, -camera.getWorldDirection(new Vector3()).z));
		// The first frame keeps the input pose and a repaint alone does not advance the animation.
		expect(camera.position.distanceTo(perspective.position)).toBeLessThan(1e-10);
		expect(tilt()).toBeCloseTo(toRadians(6), 10);
		snap.update(perspective, controls, 1, 0.1);
		expect(tilt()).toBeCloseTo(toRadians(6 * (1 - 0.15625)), 10);
		snap.update(perspective, controls, 1);
		expect(tilt()).toBeCloseTo(toRadians(6 * (1 - 0.15625)), 10);
		snap.update(perspective, controls, 1, 0.1);
		expect(tilt()).toBeCloseTo(toRadians(3), 10);
		snap.update(perspective, controls, 1, 0.2);
		expect(tilt()).toBeCloseTo(0, 7);
	});

	it("clears an unfinished transition when an external pose replaces it", () => {
		const {perspective, controls, snap} = setup();
		pointCamera(perspective, 6);
		snap.update(perspective, controls, 1);
		snap.update(perspective, controls, 1, 0.12);
		// A programmatic move can replace the input pose while the gesture controller is paused.
		pointCamera(perspective, 9);
		expect(snap.update(perspective, controls, 1, 0.02)).toBeNull();
		pointCamera(perspective, 5);
		const camera = snap.update(perspective, controls, 1, 0.02);
		expect(camera.quaternion.angleTo(perspective.quaternion)).toBeCloseTo(0, 7);
	});

	it("owns input until the animation finishes and discards the gesture that triggered it", () => {
		const {perspective, controls, snap} = setup();
		const pose = {position: perspective.position.toArray()};
		Object.assign(controls, {enabled: true, cancel: vi.fn(), getRigidPose: vi.fn(() => pose), setRigidPose: vi.fn()});
		pointCamera(perspective, 6);
		snap.update(perspective, controls, 1);
		// Cancel the pointer gesture and clear inertia before freezing the input camera.
		expect(controls.cancel).toHaveBeenCalledTimes(1);
		expect(controls.getRigidPose).toHaveBeenCalledWith(false);
		expect(controls.setRigidPose).toHaveBeenCalledWith(pose, false);
		expect(controls.enabled).toBe(false);
		snap.update(perspective, controls, 1, 0.399);
		expect(controls.enabled).toBe(false);
		snap.update(perspective, controls, 1, 0.001);
		expect(controls.enabled).toBe(true);
		expect(controls.cancel).toHaveBeenCalledTimes(1);
	});

	it("restores input on reset and respects controls that were disabled before the snap", () => {
		const {perspective, controls, snap} = setup();
		Object.assign(controls, {enabled: false, cancel: vi.fn(), getRigidPose: vi.fn(), setRigidPose: vi.fn()});
		pointCamera(perspective, 6);
		snap.update(perspective, controls, 1);
		snap.reset();
		expect(controls.enabled).toBe(false);
		expect(controls.cancel).not.toHaveBeenCalled();
		// An interrupted snap must also release its own input lock.
		controls.enabled = true;
		snap.update(perspective, controls, 1);
		expect(controls.enabled).toBe(false);
		snap.reset();
		expect(controls.enabled).toBe(true);
	});

	it("keeps the reference plane stable across picking, zoom, pan and resize", () => {
		const {perspective, target, controls, snap} = setup();
		const ortho = snap.update(perspective, controls, 1);
		const height = ortho.top - ortho.bottom;
		const width = ortho.right - ortho.left;
		target.set(15, 20, 20);
		expect(snap.update(perspective, controls, 1).top - ortho.bottom).toBeCloseTo(height);
		perspective.zoom = 2;
		perspective.aspect *= 2;
		perspective.position.x += 3;
		perspective.updateProjectionMatrix();
		snap.update(perspective, controls, 1);
		expect(ortho.top - ortho.bottom).toBeCloseTo(height / 2);
		expect(ortho.right - ortho.left).toBeCloseTo(width);
		expect(ortho.position.x).toBeCloseTo(13);
	});

	it("uses temporary projection only when all visible clouds use supported X-Ray", () => {
		const {perspective, controls} = setup();
		const viewer = Object.create(Viewer.prototype);
		const cloud = {visible: true, material: {}, userData: {}};
		const scene = Object.assign(Object.create(Scene.prototype), {
			cameraP: perspective,
			cameraO: {isOrthographicCamera: true},
			cameraMode: CameraMode.PERSPECTIVE,
			view: {radius: 10},
			pointclouds: [cloud],
		});
		viewer.scene = scene;
		viewer.controls = viewer.fjdCameraControls = controls;
		viewer.renderer = {xr: {isPresenting: false}};
		viewer.isEDLSupported = () => true;
		viewer.isXraySplatPipelineSupported = () => true;
		const update = () => viewer.updateXrayTopViewCamera(viewer.canUseXrayTopViewCamera());
		const orthoActive = () => expect(scene.getActiveCamera().isOrthographicCamera).toBe(true);
		const perspectiveActive = () => expect(scene.getActiveCamera()).toBe(perspective);
		// Native consumers see the same selected render camera while the controls retain perspective.
		update();
		perspectiveActive();
		viewer.setXrayTopViewEnabled(true);
		update();
		perspectiveActive();
		cloud.userData.edlEnabled = true;
		update();
		perspectiveActive();
		cloud.userData.edlEnabled = false;
		cloud.userData.xrayEnabled = true;
		update();
		orthoActive();
		expect(scene.getControlCamera()).toBe(perspective);
		const consumer = {supportsSetCamera: true, setCamera: vi.fn()};
		viewer.syncControlsContext(consumer);
		expect(consumer.setCamera).toHaveBeenCalledWith(perspective);

		// Direct-blend fallback keeps the regular perspective camera.
		viewer.isXraySplatPipelineSupported = () => false;
		update();
		perspectiveActive();
		viewer.isXraySplatPipelineSupported = () => true;
		update();
		orthoActive();

		// A mixed view still renders its X-Ray layer without changing the canvas projection.
		const other = {visible: true, material: {}, userData: {edlEnabled: true}};
		scene.pointclouds.push(other);
		expect(viewer.hasVisibleXRAYEffectPointclouds()).toBe(true);
		update();
		perspectiveActive();
		setPointCloudStationHidden(other, viewer, true);
		update();
		orthoActive();

		// A hidden X-Ray layer cannot keep the snap active.
		cloud.visible = false;
		update();
		perspectiveActive();
		cloud.visible = true;
		update();
		orthoActive();
		viewer.pauseRender = true;
		update();
		perspectiveActive();
		viewer.pauseRender = false;
		viewer.renderer.xr.isPresenting = true;
		update();
		perspectiveActive();
		viewer.renderer.xr.isPresenting = false;
		update();
		orthoActive();
		viewer.setCameraMode(CameraMode.ORTHOGRAPHIC);
		expect(scene.getActiveCamera()).toBe(scene.cameraO);
		expect(scene.xrayTopViewCamera).toBeNull();
		viewer.setCameraMode(CameraMode.PERSPECTIVE);
		update();
		orthoActive();
		viewer.setXrayTopViewEnabled(false);
		perspectiveActive();
	});

	it("keeps the wheel zoom visible on the first frame of an animated reset", () => {
		const {viewer, controls, step, project} = setupFit();
		controls.zoomTo(0.7, false);
		step(0);
		const before = project();
		const topBefore = viewer.scene.getActiveCamera().top;
		viewer.setTopView4CameraControls(true);
		viewer.updateXrayTopViewCamera(true);
		expect(viewer.scene.cameraP.zoom).toBe(0.7);
		expect(viewer.scene.getActiveCamera().top).toBeCloseTo(topBefore);
		expect(project().x).toBeCloseTo(before.x);
		for (let i = 0; i < 150; i++) step();
		expect(viewer.scene.cameraP.zoom).toBe(1);
		expect(project().x).toBeCloseTo(0.4);
	});

	it("switches projection near the end of a reset while the fit still owns the pose", () => {
		const {viewer, controls, step, project} = setupFit();
		controls.setLookAt(8, -15, 30, 0, 0, 4, false);
		step(0);
		expect(viewer.scene.getActiveCamera().isPerspectiveCamera).toBe(true);
		viewer.setTopView4CameraControls(true);
		let handedOff = false;
		for (let i = 0; i < 300 && controls.active; i++) {
			step();
			// The projection can change while the fit continues moving the same controls.
			expect(controls.enabled).toBe(true);
			if (!handedOff && viewer.scene.getActiveCamera().isOrthographicCamera) {
				const back = up.clone().applyQuaternion(viewer.scene.cameraP.quaternion);
				expect(back.z).toBeGreaterThanOrEqual(Math.cos(toRadians(1)) - 1e-12);
				expect(controls.active).toBe(true);
				handedOff = true;
			}
		}
		expect(handedOff).toBe(true);
		expect(controls.active).toBe(false);
		expect(viewer.scene.getActiveCamera().isOrthographicCamera).toBe(true);
		expect(project().x).toBeCloseTo(0.4, 6);
		expect(project().y).toBeCloseTo(0, 6);
	});
});
