import * as THREE from "../libs/three.js/build/three.module.js";
import {readFileSync} from "node:fs";
import {beforeAll, describe, expect, test, vi} from "vitest";
import {FJDCameraControls} from "../src/FJDCameraControlsHost.js";
import {
	buildCrossSectionPreviewFrames,
	buildCrossSectionPreviewVolume,
	CrossSectionPreviewTool,
	estimateCrossSectionFrameSideLength,
} from "../src/utils/CrossSectionPreviewTool.js";

describe("buildCrossSectionPreviewFrames", () => {
	test("creates vertical squares perpendicular to the XY axis tangent", () => {
		// Preserve the explicit manual-axis bottom-edge contract.
		const frames = buildCrossSectionPreviewFrames({
			axisAnchor: "bottom",
			axisPoints: [new THREE.Vector3(0, 0, 4), new THREE.Vector3(20, 0, 4)],
			sectionStart: 0,
			sectionEnd: 20,
			sectionStep: 10,
			zRange: 12,
		});

		expect(frames).toHaveLength(3);
		expect(frames[1].position.toArray()).toEqual([10, 0, 4]);
		expect(frames[1].corners.map((corner) => corner.toArray())).toEqual([
			[10, -6, 4],
			[10, 6, 4],
			[10, 6, 16],
			[10, -6, 16],
		]);
	});

	// Verify geometric anchors at every station, including sloped axes and refined sizes.
	test.each(["bottom", "center", undefined])("anchors squares and thickness volumes using %s", (axisAnchor) => {
		for (const frameSideLength of [undefined, 6.6]) {
			const frames = buildCrossSectionPreviewFrames({
				axisAnchor, frameSideLength,
				axisPoints: [new THREE.Vector3(0, 0, 4), new THREE.Vector3(12, 16, 9)],
				sectionStart: 0, sectionEnd: 20, sectionStep: 5, zRange: 12,
			});
			expect(frames).toHaveLength(5);
			for (const frame of frames) {
				const anchorCorners = axisAnchor === "bottom" ? frame.corners.slice(0, 2) : frame.corners;
				const anchor = anchorCorners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).divideScalar(anchorCorners.length);
				expect(anchor.distanceTo(frame.position)).toBeLessThan(1e-9);
				expect(frame.corners[0].distanceTo(frame.corners[1])).toBeCloseTo(frameSideLength ?? 12);
				expect(frame.corners[1].distanceTo(frame.corners[2])).toBeCloseTo(frameSideLength ?? 12);
				const volume = buildCrossSectionPreviewVolume(frame, 2);
				for (let index = 0; index < 4; index++) {
					const midpoint = volume.leadingCorners[index].clone().add(volume.trailingCorners[index]).multiplyScalar(0.5);
					expect(midpoint.distanceTo(frame.corners[index])).toBeLessThan(1e-9);
				}
			}
		}
	});

	test("rejects a station range beyond the three-dimensional axis length", () => {
		const frames = buildCrossSectionPreviewFrames({
			axisPoints: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0)],
			sectionStart: 0,
			sectionEnd: 6,
			sectionStep: 1,
			zRange: 10,
		});

		expect(frames).toEqual([]);
	});

	test("continues mileage across multiple axis paths without adding a connector segment", () => {
		const frames = buildCrossSectionPreviewFrames({
			axisPaths: [
				[new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
				[new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0)],
			],
			sectionStart: 0,
			sectionEnd: 20,
			sectionStep: 10,
			zRange: 10,
		});

		expect(frames).toHaveLength(3);
		expect(frames.at(-1).position.toArray()).toEqual([20, 0, 0]);
	});

	test("extrudes the selected cross-section square by its configured thickness", () => {
		const [frame] = buildCrossSectionPreviewFrames({
			axisPoints: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)],
			sectionStart: 0,
			sectionEnd: 0,
			sectionStep: 1,
			zRange: 8,
		});
		const volume = buildCrossSectionPreviewVolume(frame, 2);

		expect(volume.leadingCorners[0].toArray()).toEqual([1, -4, -4]);
		expect(volume.trailingCorners[0].toArray()).toEqual([-1, -4, -4]);
	});

	test("uses only the representative local vertical envelope for the shared square size", () => {
		const frameSideLength = estimateCrossSectionFrameSideLength([
			new THREE.Vector3(0, -4, 0),
			new THREE.Vector3(0, 4, 0),
			new THREE.Vector3(0, -4, 6),
			new THREE.Vector3(0, 4, 6),
		]);

		expect(frameSideLength).toBeCloseTo(6.6);
	});


  // The parent supplies final size; native rendering must never query a profile.
  test('waits for final size and preserves it across preview parameter changes', () => {
    const request = vi.fn(() => { throw new Error('Unexpected network sampling'); });
    const axis = { uuid: 'axis', color: new THREE.Color(0x123456), getRenderablePaths: () => [{ points: [new THREE.Vector3(), new THREE.Vector3(20, 0, 0)] }] };
    const cloud = { baseUrl: 'main', getPointsInProfile: request };
    const viewer = { addEventListener() {}, removeEventListener() {}, setTopView4CameraControls: vi.fn(), scene: {
      measurements: [axis], pointclouds: [cloud], getBoundingBox: () => new THREE.Box3(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(30, 10, 30)),
    } };
    const tool = new CrossSectionPreviewTool(viewer);
    const preview = { axisUuid: 'axis', mainPointCloudBaseUrl: 'main', sectionStart: 0, sectionEnd: 20, sectionStep: 5, sectionThickness: 0.2 };
    tool.setPreview(preview);
    expect(tool.group.children).toHaveLength(0);
    tool.setPreview({ ...preview, frameSideLength: 6.6 });
    expect(tool.group.children.length).toBeGreaterThan(0);
    expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(1);
    tool.setPreview({ ...preview, sectionStep: 10, frameSideLength: 6.6 });
    expect(tool.frameSideLength).toBeCloseTo(6.6);
    expect(request).not.toHaveBeenCalled();
    tool.clear();
    expect(axis.color.getHex()).toBe(0x123456);
    expect(tool.group.children).toHaveLength(0);
    tool.dispose();
  });

	test("renders markers in Potree's three-dimensional overlay pass", () => {
		const source = readFileSync("src/utils/CrossSectionPreviewTool.js", "utf8");
		const viewerSource = readFileSync("src/viewer/viewer.js", "utf8");

		expect(source).toContain("render.pass.perspective_overlay");
		expect(source).toContain("this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera())");
		expect(source).not.toContain("this.viewer.fitToScreen");
		expect(viewerSource).toContain("this.crossSectionPreviewTool?.getPreviewPointclouds?.()");
	});
});

describe("cross-section preview initialization camera", () => {
	let Viewer;

	beforeAll(async () => {
		// Load the real initialization entry without the unrelated map projection dependency.
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});

	// Keep rendering mocked while exercising real Viewer and FJD camera calculations.
	function createPreviewViewer(projection) {
		const camera = projection === "perspective"
			? new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 10000)
			: new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 10000);
		camera.up.set(0, 0, 1);
		const controls = new FJDCameraControls(camera);
		controls.usesRigidTopViewFit = true;
		let profileCallbacks;
		const main = {
			baseUrl: "project/main",
			position: new THREE.Vector3(),
			boundingBox: new THREE.Box3(
				new THREE.Vector3(-20, -5, 0),
				new THREE.Vector3(20, 5, 10),
			),
			getPointsInProfile: (_profile, _depth, callbacks) => {
				profileCallbacks = callbacks;
				return {cancel: () => {}};
			},
		};
		const scene = {
			pointclouds: [main],
			measurements: [{
				uuid: "axis-camera",
				getRenderablePaths: () => [{
					points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)],
				}],
			}],
			view: {radius: 0},
			getActiveCamera: () => camera,
			getBoundingBox: (pointclouds) => pointclouds.reduce(
				(bounds, pointcloud) => bounds.union(pointcloud.boundingBox),
				new THREE.Box3(),
			),
		};
		const viewer = {
			controls,
			scene,
			addEventListener: () => {},
			removeEventListener: () => {},
			renderer: {getSize: (target) => target.set(800, 600), render: () => {}},
			getBoundingBox: (pointclouds) => scene.getBoundingBox(pointclouds),
		};
		viewer.setTopView4CameraControls = vi.fn((...args) =>
			Viewer.prototype.setTopView4CameraControls.apply(viewer, args),
		);
		const tool = new CrossSectionPreviewTool(viewer);
		viewer.crossSectionPreviewTool = tool;
		const preview = {
			axisUuid: "axis-camera",
			mainPointCloudBaseUrl: main.baseUrl,
			sectionStart: 0,
			sectionEnd: 20,
			sectionStep: 10,
			sectionThickness: 0.2,
			frameSideLength: 6.6,
		};
		viewer.setTopView4CameraControls(false);
		const initialPose = controls.getRigidPose();
		viewer.setTopView4CameraControls.mockClear();
		return {camera, controls, main, viewer, tool, preview, initialPose,
			finishProfile: () => {
				// A final-size update must preserve user navigation.
				tool.setPreview({...preview, frameSideLength: 6.6});
			},
		};
	}

	// Compare the rendered pose as well as the controller target, allowing quaternion sign equivalence.
	function expectCameraPose(controls, expected) {
		expect(controls.camera.position.distanceTo(new THREE.Vector3(...expected.position))).toBeLessThan(1e-6);
		expect(controls.camera.quaternion.angleTo(new THREE.Quaternion(...expected.quaternion))).toBeLessThan(1e-6);
		expect(controls.getTarget(new THREE.Vector3()).distanceTo(new THREE.Vector3(...expected.orbitPoint))).toBeLessThan(1e-6);
		expect(Math.abs(controls.camera.zoom - expected.zoom)).toBeLessThan(1e-6);
	}

	// Give the user a visibly different position, orientation and zoom before preview entry.
	function moveCamera(controls) {
		controls.setRigidPose({
			position: [40, -30, 25],
			quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0.6)).toArray(),
			orbitPoint: [5, 2, 1],
			zoom: 2,
		}, false);
	}

	test.each(["perspective", "orthographic"])("matches the complete initial %s pose after preview entry", (projection) => {
		const {controls, tool, viewer, preview, initialPose} = createPreviewViewer(projection);
		for (const moved of [false, true]) {
			if (moved) moveCamera(controls);
			tool.setPreview(preview);
			expectCameraPose(controls, initialPose);
			expect(viewer.setTopView4CameraControls).toHaveBeenLastCalledWith(false);
			tool.clear();
		}
		tool.dispose();
	});

	test.each(["perspective", "orthographic"])("ignores oversized markers and unrelated clouds when framing the %s preview", (projection) => {
		const {controls, main, tool, viewer, preview, initialPose} = createPreviewViewer(projection);
		viewer.scene.pointclouds.push({
			baseUrl: "project/unrelated",
			boundingBox: new THREE.Box3(new THREE.Vector3(-1000, -1000, -1000), new THREE.Vector3(1000, 1000, 1000)),
		});
		moveCamera(controls);
		tool.setPreview({...preview, sectionThickness: 100});
		expect(main.boundingBox.containsBox(new THREE.Box3().setFromObject(tool.group))).toBe(false);
		expectCameraPose(controls, initialPose);
		tool.dispose();
	});

	test.each(["perspective", "orthographic"])("preserves user navigation during %s refinement and resets on a new preview", (projection) => {
		const {controls, tool, viewer, preview, initialPose, finishProfile} = createPreviewViewer(projection);
		tool.setPreview(preview);
		moveCamera(controls);
		const userPose = controls.getRigidPose();
		finishProfile();
		expect(tool.frameSideLength).toBeCloseTo(6.6);
		expectCameraPose(controls, userPose);
		tool.setPreview({...preview, activeIndex: 1});
		expectCameraPose(controls, userPose);
		expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(1);
		tool.clear();
		expectCameraPose(controls, userPose);
		tool.setPreview(preview);
		expectCameraPose(controls, initialPose);
		moveCamera(controls);
		tool.setPreview({...preview, sectionStep: 5});
		expectCameraPose(controls, initialPose);
		expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(3);
		tool.dispose();
	});


	// Alignment updates must move the frames while preserving the complete user camera pose.
	test.each(["perspective", "orthographic"])("preserves user navigation when switching %s preview alignment", (projection) => {
		const {controls, tool, viewer, preview} = createPreviewViewer(projection);
		tool.setPreview({...preview, axisAnchor: "center"});
		moveCamera(controls);
		const userPose = controls.getRigidPose();
		const centerBounds = new THREE.Box3().setFromObject(tool.group);
		for (const axisAnchor of ["bottom", "center", "bottom"]) {
			tool.setPreview({...preview, axisAnchor});
			tool.update();
			expectCameraPose(controls, userPose);
			expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(1);
			const bounds = new THREE.Box3().setFromObject(tool.group);
			expect(bounds.min.z).toBeCloseTo(centerBounds.min.z + (axisAnchor === "bottom" ? preview.frameSideLength / 2 : 0));
		}
		// A delayed size update must retain the new alignment and user navigation.
		tool.setPreview({...preview, axisAnchor: "bottom", frameSideLength: 8});
		expectCameraPose(controls, userPose);
		expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(1);
		tool.clear();
		tool.setPreview({...preview, axisAnchor: "bottom"});
		expect(viewer.setTopView4CameraControls).toHaveBeenCalledTimes(2);
		tool.dispose();
	});

	test.each(["missing", "hidden", "empty"])("does not move the camera when the main cloud is %s", (state) => {
		const {controls, main, tool, viewer, preview} = createPreviewViewer("perspective");
		moveCamera(controls);
		const userPose = controls.getRigidPose();
		if (state === "missing") viewer.scene.pointclouds = [];
		if (state === "hidden") main.visible = false;
		if (state === "empty") main.boundingBox.makeEmpty();
		tool.setPreview(preview);
		expectCameraPose(controls, userPose);
		expect(viewer.setTopView4CameraControls).not.toHaveBeenCalled();
		tool.dispose();
	});
});
