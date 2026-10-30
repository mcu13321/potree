import * as THREE from "../libs/three.js/build/three.module.js";
import {readFileSync} from "node:fs";
import {describe, expect, test, vi} from "vitest";
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
    // Geometry-only mocks have no measurable camera viewport.
    expect(tool.needsFit).toBe(true);
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


describe("cross-section axis camera framing", () => {
	// Keep only drawing mocked; pose application and point projection use real native code.
	function createViewer(projection, points = [[-40, -20, 2], [0, 50, 8], [60, 15, 5]]) {
		const camera = projection === "perspective"
			? new THREE.PerspectiveCamera(60, 1200 / 800, 0.1, 100000)
			: new THREE.OrthographicCamera(-90, 90, 60, -60, 0.1, 100000);
		camera.up.set(0, 0, 1);
		// The standalone host installs its THREE dependency explicitly.
		FJDCameraControls.install({THREE});
		const controls = new FJDCameraControls(camera);
		const axis = {uuid: "axis", getRenderablePaths: () => [{points: points.map(point => new THREE.Vector3(...point))}]};
		const events = [];
		const viewer = {
			controls, addEventListener() {}, removeEventListener() {},
			dispatchEvent: event => events.push(event.type),
			scene: {measurements: [axis], pointclouds: [], getActiveCamera: () => camera,
				getBoundingBox: clouds => clouds.reduce((box, cloud) => box.union(cloud.boundingBox), new THREE.Box3())},
			renderer: {domElement: {clientWidth: 1200, clientHeight: 800}, getSize: target => target.set(1200, 800)},
			render: () => {camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);},
		};
		const tool = new CrossSectionPreviewTool(viewer);
		const viewport = {x: 300, y: 160, width: 640, height: 480};
		const preview = {axisUuid: "axis", mainPointCloudBaseUrl: "main", cameraViewport: viewport,
			sectionStart: 0, sectionEnd: 20, sectionStep: 10, sectionThickness: 0.2, frameSideLength: 6.6};
		return {camera, controls, axis, viewer, tool, viewport, preview, events};
	}

	function project(camera, point) {
		camera.updateMatrixWorld(true);
		const projected = point.clone().project(camera);
		return [(projected.x + 1) * 600, (1 - projected.y) * 400];
	}

	function expectFramed(h) {
		const points = h.axis.getRenderablePaths().flatMap(path => path.points);
		const bounds = new THREE.Box3().setFromPoints(points);
		const center = project(h.camera, bounds.getCenter(new THREE.Vector3()));
		expect(center[0]).toBeCloseTo(h.viewport.x + h.viewport.width / 2, 6);
		expect(center[1]).toBeCloseTo(h.viewport.y + h.viewport.height / 2, 6);
		for (const point of points) {
			const [x, y] = project(h.camera, point);
			expect(x).toBeGreaterThanOrEqual(h.viewport.x - 1e-6);
			expect(x).toBeLessThanOrEqual(h.viewport.x + h.viewport.width + 1e-6);
			expect(y).toBeGreaterThanOrEqual(h.viewport.y - 1e-6);
			expect(y).toBeLessThanOrEqual(h.viewport.y + h.viewport.height + 1e-6);
		}
		expect(h.camera.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
		expect(h.controls.getTarget(new THREE.Vector3()).distanceTo(bounds.getCenter(new THREE.Vector3()))).toBeLessThan(1e-6);
	}

	// Include curved samples, vertical/horizontal paths, depth, and sub-meter geometry.
	test.each(["perspective", "orthographic"])("centers and contains the entire %s axis in the safe viewport", projection => {
		for (const points of [undefined, [[0, 0, 0], [0, 100, 0]], [[0, 0, 0], [100, 0, 0]],
			[[0, 0, 0], [0.3, 0.2, 0.1]], [[10000, -4000, -100], [10200, -3900, 100]]]) {
			const h = createViewer(projection, points);
			// Unrelated cloud extents must not affect axis framing.
			h.viewer.scene.pointclouds.push({boundingBox: new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6))});
			h.tool.setPreview(h.preview);
			expectFramed(h);
			expect(h.tool.needsFit).toBe(false);
			expect(h.events).toEqual(["cross_section_preview_camera_fitted"]);
			h.controls.update(1 / 60);
			h.viewer.render();
			expectFramed(h);
			h.tool.dispose();
		}
	});

	test.each(["perspective", "orthographic"])("keeps the %s user pose through parameter, size, and layout updates", projection => {
		const h = createViewer(projection);
		h.tool.setPreview(h.preview);
		h.controls.setRigidPose({position: [100, -40, 30], quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0.6)).toArray(), orbitPoint: [5, 2, 1], zoom: 2}, false);
		const pose = h.controls.getRigidPose(false);
		for (const change of [{sectionStep: 5}, {sectionStart: 1, sectionEnd: 10}, {sectionThickness: 100}, {frameSideLength: 8}, {axisAnchor: "bottom"}, {activeIndex: 1}]) {
			h.tool.setPreview({...h.preview, ...change});
			h.tool.update();
			expect(h.controls.getRigidPose(false)).toEqual(pose);
		}
		h.viewport = {x: 0, y: 100, width: 500, height: 400};
		h.tool.setCameraViewport(h.viewport);
		h.tool.update();
		expect(h.controls.getRigidPose(false)).toEqual(pose);
		expect(h.events).toHaveLength(1);
		h.tool.requestCameraFit();
		expectFramed(h);
		expect(h.events).toEqual(["cross_section_preview_camera_fitted", "cross_section_preview_camera_fit_requested", "cross_section_preview_camera_fitted"]);
		h.tool.clear();
		h.tool.setPreview(h.preview);
		h.viewport = h.preview.cameraViewport;
		expectFramed(h);
		h.tool.dispose();
	});

	test("waits for late axis, canvas and viewport readiness without consuming the fit", () => {
		const h = createViewer("orthographic");
		h.viewer.scene.measurements = [];
		h.viewer.renderer.domElement.clientWidth = 0;
		h.tool.setPreview({...h.preview, cameraViewport: null});
		h.tool.update();
		expect(h.tool.needsFit).toBe(true);
		h.viewer.scene.measurements = [h.axis];
		h.viewer.renderer.domElement.clientWidth = 1200;
		h.tool.update();
		expect(h.events).toEqual([]);
		h.tool.setCameraViewport(h.viewport);
		h.tool.update();
		expectFramed(h);
		expect(h.events).toHaveLength(1);
		// Closing a pending preview cancels retries and later reset requests.
		h.tool.setCameraViewport({x: 0, y: 0, width: 0, height: 0});
		h.tool.requestCameraFit();
		expect(h.tool.needsFit).toBe(true);
		h.tool.clear();
		h.tool.setCameraViewport(h.viewport);
		h.tool.update();
		h.tool.requestCameraFit();
		expect(h.events.filter(type => type === "cross_section_preview_camera_fitted")).toHaveLength(1);
		h.tool.dispose();
	});

	test.each(["perspective", "orthographic"])("centers a degenerate %s XY extent while preserving zoom", projection => {
		const h = createViewer(projection, [[4, 8, -2], [4, 8, 2]]);
		h.controls.setRigidPose({position: [20, 0, 50], quaternion: [0, 0, 0, 1], orbitPoint: [20, 0, 0], zoom: 2}, false);
		h.tool.setPreview(h.preview);
		expectFramed(h);
		expect(h.camera.zoom).toBe(2);
		h.tool.dispose();
	});
	// A flat axis must occupy exactly the padded limiting dimension, even below one meter.
	test.each(["perspective", "orthographic"])("uses axis scale and 1.05 padding for a small flat %s axis", projection => {
		const h = createViewer(projection, [[0, 0, 0], [0.3, 0.2, 0]]);
		h.tool.setPreview(h.preview);
		const first = project(h.camera, new THREE.Vector3(0, 0, 0));
		const last = project(h.camera, new THREE.Vector3(0.3, 0.2, 0));
		expect(Math.max(Math.abs(last[0] - first[0]) / h.viewport.width, Math.abs(last[1] - first[1]) / h.viewport.height)).toBeCloseTo(1 / 1.05, 6);
		expectFramed(h);
		h.tool.dispose();
	});

	// Disconnected rendered paths contribute bounds without connecting their station geometry.
	test.each(["perspective", "orthographic"])("frames every disconnected %s axis path", projection => {
		const h = createViewer(projection);
		h.axis.getRenderablePaths = () => [
			{points: [new THREE.Vector3(-80, -20, 0), new THREE.Vector3(-40, 30, 10)]},
			{points: [new THREE.Vector3(70, 60, 8), new THREE.Vector3(100, -60, 3)]},
		];
		h.tool.setPreview(h.preview);
		expectFramed(h);
		h.tool.dispose();
	});

	// Owned cloud height prevents roof clipping without allowing cloud width to shrink the axis.
	test("keeps the orthographic camera above the roof while framing only the axis XY extent", () => {
		const h = createViewer("orthographic", [[0, 0, 0], [100, 0, 0]]);
		h.tool.setPreview(h.preview);
		const axisZoom = h.camera.zoom;
		h.viewer.scene.pointclouds.push({baseUrl: "main", boundingBox: new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -10), new THREE.Vector3(1e5, 1e5, 100))});
		h.tool.requestCameraFit();
		expect(h.camera.position.z).toBeGreaterThan(100);
		expect(h.camera.zoom).toBeCloseTo(axisZoom, 6);
		expectFramed(h);
		h.tool.dispose();
	});

});
