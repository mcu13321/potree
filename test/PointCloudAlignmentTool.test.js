import {recordInitialAlignmentPose, applyAlignmentLocalMatrix} from "../src/utils/PointCloudAlignmentTransform.js";
import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {PointCloudAlignmentTool} from "../src/utils/PointCloudAlignmentTool.js";
import {getPointCloudLabelAppearance, isPointCloudAlignmentHidden, withPointCloudLabelColor} from "../src/utils/PointCloudLabelAppearance.js";
import {getPointcloudEffectState} from "../src/viewer/PointcloudEffectUtils.js";

let Viewer;
const viewers = [];

/** Exercise real label projection and public Viewer APIs without a WebGL context. */
function fixture() {
	const element = document.createElement("div");
	element.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600});
	document.body.appendChild(element);
	const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
	camera.position.set(0, 0, 20);
	camera.lookAt(0, 0, 0);
	const clouds = [0, 1, 2].map(index => {
		const cloud = new THREE.Object3D();
		cloud.position.x = index * 2;
		cloud.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
		cloud.material = {color: new THREE.Color(0x123456), activeAttributeName: "rgba"};
		cloud.userData = {edlEnabled: true, xrayEnabled: false};
		return cloud;
	});
	// Explicit fixture baselines precede the minimal scene tracker, just as a host can opt in before loading.
	clouds.forEach(cloud => recordInitialAlignmentPose(cloud));
	const makeScene = members => Object.assign(new EventDispatcher(), {pointclouds: members, getActiveCamera: () => camera});
	const scene = makeScene(clouds);
	const viewer = Object.assign(new EventDispatcher(), {renderArea: element, renderer: {domElement: element}, scene, getViewMode: () => "top", fjdCameraControls: {enabled: true, stop: vi.fn()}, inputHandler: {enabled: true}});
	for (const method of ["enablePointCloudLabels", "disablePointCloudLabels", "enablePointCloudAlignment", "disablePointCloudAlignment", "getPointCloudAlignmentResult", "exportPointCloudAlignmentResults", "enablePointCloudAlignmentTracking", "disablePointCloudAlignmentTracking"]) viewer[method] = Viewer.prototype[method];
	viewer.enablePointCloudAlignmentTracking();
	const labels = viewer.enablePointCloudLabels();
	viewers.push(viewer);
	return {viewer, labels, clouds, scene, makeScene, element, camera};
}

describe("opt-in point-cloud alignment", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => {
		viewers.splice(0).forEach(viewer => {viewer.disablePointCloudAlignment(); viewer.disablePointCloudLabels(); viewer.disablePointCloudAlignmentTracking();});
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("does nothing before explicit start, rejects missing active and is idempotent after start", () => {
		const {viewer, labels, clouds, scene} = fixture();
		const viewerListener = vi.spyOn(viewer, "addEventListener");
		const sceneListener = vi.spyOn(scene, "addEventListener");
		expect(viewer.pointCloudAlignmentTool).toBeUndefined();
		expect(viewer.enablePointCloudAlignment()).toBeNull();
		expect(viewerListener).not.toHaveBeenCalled();
		expect(sceneListener).not.toHaveBeenCalled();
		labels.setActivePointCloud(clouds[0]);
		const tool = viewer.enablePointCloudAlignment();
		expect(tool).toBeInstanceOf(PointCloudAlignmentTool);
		expect(viewer.enablePointCloudAlignment()).toBe(tool);
		expect(tool.getState()).toEqual({phase: "waiting", activePointcloud: clouds[0], active2Pointcloud: null});
		tool.setActive2PointCloud(clouds[1]);
		expect(viewer.enablePointCloudAlignment().getState().phase).toBe("paired");
	});

	it("hides only runtime source visibility and locks direct and label-based primary changes", () => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const visible = vi.fn();
		Object.defineProperty(a, "visible", {get: () => true, set: visible, configurable: true});
		const position = a.position.clone(), world = a.matrixWorld.clone(), userData = {...a.userData};
		const tool = viewer.enablePointCloudAlignment();
		expect(isPointCloudAlignmentHidden(a)).toBe(true);
		expect(labels.labels.get(a).style.display).toBe("none");
		expect(a.visible).toBe(true);
		expect(a.position.equals(position)).toBe(true);
		expect(a.matrixWorld.equals(world)).toBe(true);
		expect(a.userData).toEqual(userData);
		expect(visible).not.toHaveBeenCalled();
		expect(() => labels.setActivePointCloud(b)).toThrow("locked");
		expect(() => labels.setActivePointCloud(null)).toThrow("locked");
		expect(labels.setActivePointCloud(a)).toBe(labels);
		expect(() => tool.setActive2PointCloud(a)).toThrow(RangeError);
		expect(() => tool.setActive2PointCloud(new THREE.Object3D())).toThrow(RangeError);
		labels.labels.get(a).click();
		expect(tool.getState().phase).toBe("waiting");
	});

	it("switches the sole yellow target while restoring a visible locked blue source", () => {
		const {viewer, labels, clouds: [a, b, c]} = fixture();
		labels.setActivePointCloud(a);
		const primaryChanged = vi.fn(), alignmentChanged = vi.fn();
		viewer.addEventListener("active_pointcloud_changed", primaryChanged);
		viewer.addEventListener("pointcloud_alignment_changed", alignmentChanged);
		const tool = viewer.enablePointCloudAlignment();
		labels.labels.get(b).click();
		expect(tool.getState()).toEqual({phase: "paired", activePointcloud: a, active2Pointcloud: b});
		expect(isPointCloudAlignmentHidden(a)).toBe(false);
		expect(labels.labels.get(a).style.display).toBe("flex");
		// Paired primary labels are now live translation handles, but remain selection-locked.
		expect(labels.labels.get(a).disabled).toBe(false);
		expect(labels.labels.get(a).style.backgroundColor).toBe("rgb(28, 126, 253)");
		// Primary, secondary and ordinary labels share one palette while cloud Xray roles remain distinct.
		for (const property of ["backgroundColor", "borderColor", "borderWidth", "color", "boxShadow", "width", "height"]) {
			expect(labels.labels.get(b).style[property]).toBe(labels.labels.get(c).style[property]);
			expect(labels.labels.get(a).style[property]).toBe(labels.labels.get(c).style[property]);
		}
		expect(labels.labels.get(b).style.backgroundColor).toBe("rgb(28, 126, 253)");
		expect(labels.labels.get(b).style.width).toBe("40px");
		expect(labels.labels.get(b).style.borderWidth).toBe("2px");
		expect(getPointcloudEffectState(a)).toMatchObject({xrayEnabled: true, edlEnabled: false});
		expect(getPointcloudEffectState(b)).toMatchObject({xrayEnabled: true, edlEnabled: false});
		withPointCloudLabelColor(b, b.material, () => expect(b.material.color.getHex()).toBe(0xffd400));
		expect(b.material.activeAttributeName).toBe("rgba");
		expect(b.material.color.getHex()).toBe(0x123456);
		labels.labels.get(b).click(); labels.labels.get(a).click();
		expect(alignmentChanged).toHaveBeenCalledTimes(2);
		labels.labels.get(c).click();
		expect(getPointCloudLabelAppearance(b)).toBe(false);
		expect(getPointcloudEffectState(b)).toMatchObject({xrayEnabled: false, edlEnabled: false});
		expect(labels.labels.get(b).style.borderColor).toBe("rgb(255, 255, 255)");
		expect(tool.getState().active2Pointcloud).toBe(c);
		expect(primaryChanged).not.toHaveBeenCalled();
		tool.setActive2PointCloud(null);
		expect(tool.getState().phase).toBe("waiting");
		expect(isPointCloudAlignmentHidden(a)).toBe(true);
	});

	it("preserves alignment while labels are hidden for screenshots and restores normal selection on exit", () => {
		const {viewer, labels, clouds: [a, b, c]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		labels.setVisible(false); labels.setVisible(true);
		expect(tool.getState().active2Pointcloud).toBe(b);
		viewer.disablePointCloudAlignment();
		expect(tool.getState()).toEqual({phase: "idle", activePointcloud: a, active2Pointcloud: null});
		expect(viewer.pointCloudAlignmentTool).toBeNull();
		expect(labels.labels.get(a).disabled).toBe(false);
		expect(getPointCloudLabelAppearance(b)).toBe(false);
		expect(isPointCloudAlignmentHidden(a)).toBe(false);
		expect(viewer.hasEventListener("scene_changed", tool.onReconcile)).toBe(false);
		labels.labels.get(c).click();
		expect(labels.getActivePointCloud()).toBe(c);
		viewer.disablePointCloudAlignment();
		expect(() => tool.setActive2PointCloud(b)).toThrow("ended");
	});

	it("reconciles target/source removal and releases locks before scene or label cleanup", () => {
		const {viewer, labels, clouds: [a, b, c], scene, makeScene} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		scene.pointclouds = [a, c];
		scene.dispatchEvent({type: "pointcloud_removed", pointcloud: b});
		expect(tool.getState().phase).toBe("waiting");
		expect(isPointCloudAlignmentHidden(a)).toBe(true);
		scene.pointclouds = [c];
		scene.dispatchEvent({type: "pointcloud_removed", pointcloud: a});
		expect(viewer.pointCloudAlignmentTool).toBeNull();
		expect(labels.getActivePointCloud()).toBeNull();
		expect(isPointCloudAlignmentHidden(a)).toBe(false);
		labels.setActivePointCloud(c);
		viewer.enablePointCloudAlignment();
		viewer.scene = makeScene([a]);
		viewer.dispatchEvent({type: "scene_changed", scene: viewer.scene});
		expect(viewer.pointCloudAlignmentTool).toBeNull();
		expect(labels.getActivePointCloud()).toBeNull();
		labels.setActivePointCloud(a);
		viewer.enablePointCloudAlignment();
		viewer.disablePointCloudLabels();
		expect(viewer.pointCloudAlignmentTool).toBeNull();
		expect(isPointCloudAlignmentHidden(a)).toBe(false);
	});

	it("does not auto-select late arrivals or change an externally hidden source's base visibility", () => {
		const {viewer, labels, clouds: [a, b], scene} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		const added = new THREE.Object3D();
		scene.pointclouds.push(added);
		scene.dispatchEvent({type: "pointcloud_added", pointcloud: added});
		expect(tool.getState().active2Pointcloud).toBeNull();
		expect(getPointCloudLabelAppearance(added)).toBe(false);
		a.visible = false;
		tool.setActive2PointCloud(b);
		expect(labels.labels.get(a).style.display).toBe("none");
		viewer.disablePointCloudAlignment();
		expect(a.visible).toBe(false);
	});
});

/** Dispatch real bubbling pointer-shaped DOM input through the gizmo capture path. */
function alignmentPointer(element, type, x, y, id = 1, pointerType = "mouse") {
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
	Object.defineProperty(event, "pointerId", {value: id});
	// Exercise touch pointers through the same native Pointer Events path as mouse input.
	Object.defineProperty(event, "pointerType", {value: pointerType});
	element.dispatchEvent(event);
}

describe("alignment transform gizmo", () => {
	afterEach(() => {
		viewers.splice(0).forEach(viewer => {viewer.disablePointCloudAlignment(); viewer.disablePointCloudLabels();});
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("shows only a paired, visible source and translates it without touching the target or camera", () => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		expect(tool.gizmo.element.style.display).toBe("none");
		expect(tool.commit()).toBe(false);
		tool.setActive2PointCloud(b);
		expect(tool.gizmo.element.style.display).toBe("block");
		// Ring dimensions and visible stroke must match the requested CSS border geometry.
		expect(tool.gizmo.element.style.width).toBe("180px");
		expect(tool.gizmo.element.style.height).toBe("180px");
		const svg = tool.gizmo.element.querySelector("svg");
		expect(svg.getAttribute("viewBox")).toBe("0 0 180 180");
		expect(svg.style.width).toBe("180px");
		expect(svg.style.height).toBe("180px");
		const [visibleRing, hitRing] = svg.querySelectorAll("circle");
		expect(visibleRing.getAttribute("stroke")).toBe("#1c7efd");
		expect(visibleRing.getAttribute("stroke-width")).toBe("2");
		expect(visibleRing.getAttribute("cx")).toBe("90");
		expect(visibleRing.getAttribute("cy")).toBe("90");
		expect(visibleRing.getAttribute("r")).toBe("89");
		expect(hitRing.getAttribute("r")).toBe("89");
		expect(hitRing.style.pointerEvents).toBe("stroke");
		// The sector is also an SVG path, so count only the four retained direction arrows.
		const arrows = tool.gizmo.directionArrows;
		expect(arrows).toHaveLength(4);
		// Every rotated arrow has an 18px shaft starting 2px beyond the 40px label's edge.
		arrows.forEach((arrow, index) => {
			const [startX, startY, endX] = arrow.getAttribute("d").match(/-?\d+(?:\.\d+)?/g).map(Number);
			expect(startX - 90 - parseFloat(labels.labels.get(a).style.width) / 2).toBe(2);
			expect(endX - startX).toBe(18);
			expect(startY).toBe(90);
			expect(arrow.getAttribute("transform")).toBe(`rotate(${index * 90} 90 90)`);
			expect(arrow.getAttribute("stroke")).toBe("#1c7efd");
			// Idle arrows preserve their original thin strokes without gesture highlights.
			expect(arrow.getAttribute("stroke-width")).toBe("2");
			expect(arrow.style.filter).toBe("");
		});
		const label = labels.labels.get(a), targetPosition = b.position.clone();
		const changed = vi.fn(event => { event.matrix.elements[12] = 999; });
		viewer.addEventListener("pointcloud_alignment_transform_changed", changed);
		alignmentPointer(label, "pointerdown", 400, 300);
		// Translation hides both rotation hit areas and the orbit badge, leaving direction arrows visible.
		expect(visibleRing.style.display).toBe("none");
		expect(hitRing.style.display).toBe("none");
		expect(tool.gizmo.rotationHandle.style.display).toBe("none");
		expect(arrows.every(arrow => arrow.style.display !== "none")).toBe(true);
		// Thicker arrows and blue glows are scoped to the translation gesture.
		for (const arrow of arrows) {
			expect(arrow.getAttribute("stroke-width")).toBe("3");
			expect(arrow.style.filter).toBe("drop-shadow(0px 0px 8px #1c7efd) drop-shadow(0px 0px 4px #1c7efd66)");
		}
		expect(viewer.fjdCameraControls.enabled).toBe(false);
		expect(viewer.inputHandler.enabled).toBe(false);
		alignmentPointer(label, "pointermove", 440, 325);
		alignmentPointer(label, "pointerup", 440, 325);
		// Completing translation restores the rotation controls without changing the active pair.
		expect(visibleRing.style.display).toBe("");
		expect(hitRing.style.display).toBe("");
		expect(tool.gizmo.rotationHandle.style.display).toBe("flex");
		for (const arrow of arrows) {
			expect(arrow.getAttribute("stroke-width")).toBe("2");
			expect(arrow.style.filter).toBe("");
		}
		expect(a.position.x).toBeCloseTo(40 * 40 * Math.tan(Math.PI / 6) / 600, 7);
		expect(a.position.y).toBeLessThan(0);
		expect(a.position.z).toBe(0);
		expect(b.position.equals(targetPosition)).toBe(true);
		expect(viewer.fjdCameraControls.enabled).toBe(true);
		expect(viewer.inputHandler.enabled).toBe(true);
		expect(changed.mock.calls.map(([event]) => event.stage)).toEqual(["start", "change", "change", "end"]);
		expect(tool.commit()).toBe(true);
		const committed = a.matrix.clone();
		expect(tool.gizmo.element.isConnected).toBe(false);
		viewer.disablePointCloudAlignment();
		expect(a.matrix.equals(committed)).toBe(true);
	});

	it.each([
		["front", [0, -20, 0]], ["back", [0, 20, 0]],
		["left", [-20, 0, 0]], ["right", [20, 0, 0]],
	])("allows translation but hides and rejects rotation in %s view", (mode, eye) => {
		const {viewer, labels, camera, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		// Exercise the real projection and locked translation plane for each side view.
		viewer.getViewMode = () => mode;
		camera.position.fromArray(eye);
		camera.up.set(0, 0, 1);
		camera.lookAt(0, 0, 0);
		labels.update();
		viewer.dispatchEvent({type: "view_mode_changed"});
		const [visibleRing, hitRing] = tool.gizmo.rotationRings;
		expect(tool.gizmo.rotationHandle.style.display).toBe("none");
		expect(hitRing.style.display).toBe("none");
		expect(visibleRing.style.display).not.toBe("none");
		// Hidden or stale DOM input and direct gesture calls must not bypass the view restriction.
		alignmentPointer(hitRing, "pointerdown", 489, 300);
		tool.gizmo.startGesture({clientX: 489, clientY: 300}, "rotate");
		expect(tool.gizmo.gesture).toBeUndefined();
		expect(viewer.inputHandler.enabled).toBe(true);
		const label = labels.labels.get(a);
		alignmentPointer(label, "pointerdown", 400, 300);
		expect(tool.gizmo.gesture.operation).toBe("translate");
		alignmentPointer(label, "pointerup", 430, 300);
		expect(a.position.length()).toBeGreaterThan(0);
		expect(a.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-10);
		expect(tool.gizmo.rotationHandle.style.display).toBe("none");
		expect(hitRing.style.display).toBe("none");
		// Returning to top view restores rotation handles without requiring a new selection.
		viewer.getViewMode = () => "top";
		viewer.dispatchEvent({type: "view_mode_changed"});
		expect(tool.gizmo.rotationHandle.style.display).toBe("flex");
		expect(hitRing.style.display).not.toBe("none");
	});

	it("cancels a live rotation when leaving top view even before the view event arrives", () => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const ring = tool.gizmo.rotationRings[1];
		alignmentPointer(ring, "pointerdown", 489, 300);
		alignmentPointer(ring, "pointermove", 400, 211);
		expect(a.rotation.z).toBeCloseTo(Math.PI / 2);
		// A render update must enforce the restriction even if the camera object is unchanged.
		viewer.getViewMode = () => "front";
		tool.gizmo.update();
		expect(tool.gizmo.gesture).toBeNull();
		expect(a.rotation.z).toBeCloseTo(0);
		expect(tool.gizmo.rotationHandle.style.display).toBe("none");
		expect(ring.style.display).toBe("none");
		expect(tool.gizmo.directionArrows.every(arrow => arrow.style.display !== "none")).toBe(true);
		expect(viewer.inputHandler.enabled).toBe(true);
	});

	it("keeps the rotation icon on the ring while mouse and touch pointers drag beyond it", () => {
		const {viewer, labels, element, clouds: [a, b]} = fixture();
		// A nonzero viewport origin must not shift the pointer's orbit relative to its label.
		element.getBoundingClientRect = () => ({left: 70, top: 40, width: 800, height: 600});
		labels.update();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const handle = tool.gizmo.rotationHandle;
		const ring = tool.gizmo.element.querySelector("circle.potree-point-cloud-alignment-ring");
		// Only the visible ring receives emphasis; the hit area retains its original size.
		const visibleRing = tool.gizmo.rotationRings[0];
		const arrows = tool.gizmo.directionArrows;
		expect(handle.style.width).toBe("32px");
		expect(handle.style.height).toBe("32px");
		expect(handle.style.borderWidth).toBe("2px");
		expect(handle.style.borderColor).toBe("rgb(255, 255, 255)");
		expect(handle.style.backgroundColor).toBe(labels.labels.get(a).style.backgroundColor);
		expect(handle.querySelector("svg path").getAttribute("stroke")).toBe("currentColor");
		// The badge starts on the right side of the ring, centered on its stroke.
		expect(parseFloat(handle.style.left)).toBe(179);
		expect(parseFloat(handle.style.top)).toBe(90);
		for (const [index, pointerType] of ["mouse", "touch"].entries()) {
			// Start either on the track or directly on the badge; captured input may leave both.
			const target = index === 0 ? ring : handle.querySelector("path");
			alignmentPointer(target, "pointerdown", 559, 340, 1, pointerType);
			// Rotation must keep its own orbit and badge visible throughout the gesture.
			expect(ring.style.display).not.toBe("none");
			expect(handle.style.display).toBe("flex");
			expect(visibleRing.getAttribute("stroke-width")).toBe("4");
			expect(visibleRing.style.filter).toBe("drop-shadow(0px 0px 8px #1c7efd) drop-shadow(0px 0px 4px #1c7efd66)");
			expect(ring.getAttribute("stroke-width")).toBe("12");
			expect(arrows.every(arrow => arrow.style.display === "none")).toBe(true);
			expect(parseFloat(handle.style.left)).toBeCloseTo(179);
			expect(parseFloat(handle.style.top)).toBeCloseTo(90);
			expect(handle.style.cursor).toBe("grabbing");
			alignmentPointer(target, "pointermove", 670, 540, 2, pointerType);
			expect(parseFloat(handle.style.left)).toBeCloseTo(179);
			alignmentPointer(target, "pointermove", 670, 540, 1, pointerType);
			const offset = 89 / Math.sqrt(2);
			expect(parseFloat(handle.style.left)).toBeCloseTo(90 + offset);
			expect(parseFloat(handle.style.top)).toBeCloseTo(90 + offset);
			alignmentPointer(target, "pointerup", 470, 540, 1, pointerType);
			expect(parseFloat(handle.style.left)).toBeCloseTo(90);
			expect(parseFloat(handle.style.top)).toBeCloseTo(179);
			expect(handle.style.cursor).toBe("grab");
			// Releasing rotation restores thin, unhighlighted controls and the direction arrows.
			expect(visibleRing.getAttribute("stroke-width")).toBe("2");
			expect(visibleRing.style.filter).toBe("");
			expect(arrows.every(arrow => arrow.style.display !== "none")).toBe(true);
			expect(a.rotation.z).toBeCloseTo(-(index + 1) * Math.PI / 2);
			expect(labels.getActivePointCloud()).toBe(a);
			expect(viewer.inputHandler.enabled).toBe(true);
		}
		// Screenshot visibility and disposal apply to the badge together with the existing gizmo.
		labels.setVisible(false);
		viewer.dispatchEvent({type: "render.pass.end"});
		expect(tool.gizmo.element.style.display).toBe("none");
		labels.setVisible(true);
		viewer.dispatchEvent({type: "render.pass.end"});
		expect(tool.gizmo.element.style.display).toBe("block");
		alignmentPointer(handle, "pointerdown", 470, 429);
		alignmentPointer(handle, "pointermove", 559, 340);
		alignmentPointer(handle, "pointercancel", 559, 340);
		// Cancellation restores appearance together with the transform baseline.
		expect(visibleRing.getAttribute("stroke-width")).toBe("2");
		expect(visibleRing.style.filter).toBe("");
		expect(arrows.every(arrow => arrow.style.display !== "none" && arrow.style.filter === "")).toBe(true);
		expect(handle.style.cursor).toBe("grab");
		expect(a.rotation.z).toBeCloseTo(-Math.PI);
		viewer.disablePointCloudAlignment();
		expect(handle.isConnected).toBe(false);
	});

	it.each([["perspective", "mouse"], ["orthographic", "touch"]])("shows gesture-local translation distance with a %s camera and %s pointer", (projection, pointerType) => {
		const {viewer, labels, scene, element, clouds: [a, b]} = fixture();
		// Offset the viewport and press off-center to distinguish pointer endpoints from label centers.
		element.getBoundingClientRect = () => ({left: 70, top: 40, width: 800, height: 600});
		if (projection === "orthographic") {
			const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 1000);
			camera.position.set(0, 0, 20);
			camera.lookAt(0, 0, 0);
			scene.getActiveCamera = () => camera;
		}
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const gizmo = tool.gizmo, label = labels.labels.get(a);
		const overlay = gizmo.translationFeedback, line = gizmo.translationLine;
		const readout = gizmo.translationDistanceLabel, origin = gizmo.translationOrigin;
		expect(overlay.style.display).toBe("none");
		expect(overlay.style.pointerEvents).toBe("none");
		expect(line.getAttribute("stroke-width")).toBe("2");
		expect(line.getAttribute("stroke-dasharray")).toBe("4 4");
		expect(line.getAttribute("stroke")).toBe("#fff");
		expect(origin.getAttribute("r")).toBe("4");
		// Both the dashed line and its starting marker use the requested white palette.
		expect(origin.getAttribute("fill")).toBe("#fff");
		// Distance text can grow beyond 50px while retaining the angle readout's other styles.
		expect(readout.style.width).toBe("max-content");
		expect(readout.style.minWidth).toBe("50px");
		expect(readout.style.whiteSpace).toBe("nowrap");
		for (const property of ["height", "borderRadius", "padding", "backgroundColor", "color", "fontSize", "fontWeight", "lineHeight"]) {
			expect(readout.style[property]).toBe(gizmo.rotationAngleLabel.style[property]);
		}
		alignmentPointer(label, "pointerdown", 478, 345, 1, pointerType);
		expect(overlay.style.display).toBe("block");
		// Starting a gesture shows its markers while suppressing a zero distance readout.
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		expect(origin.getAttribute("cx")).toBe("408");
		expect(origin.getAttribute("cy")).toBe("305");
		alignmentPointer(label, "pointermove", 538, 425, 2, pointerType);
		expect(line.getAttribute("x2")).toBe("408");
		alignmentPointer(label, "pointermove", 538, 425, 1, pointerType);
		expect(line.getAttribute("x1")).toBe("408");
		expect(line.getAttribute("y1")).toBe("305");
		expect(line.getAttribute("x2")).toBe("468");
		expect(line.getAttribute("y2")).toBe("385");
		expect(readout.style.left).toBe("446px");
		expect(readout.style.top).toBe("333px");
		// Distance is the net world translation, not the 100px screen distance or a path integral.
		const worldPerPixel = projection === "perspective" ? 40 * Math.tan(Math.PI / 6) / 600 : 18 / 600;
		expect(readout.textContent).toBe(`${(100 * worldPerPixel).toFixed(2)} m`);
		expect(readout.style.display).toBe("flex");
		expect(a.position.length()).toBeCloseTo(100 * worldPerPixel);
		alignmentPointer(label, "pointermove", 478, 345, 1, pointerType);
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		alignmentPointer(label, "pointerup", 438, 345, 1, pointerType);
		expect(overlay.style.display).toBe("none");
		expect(readout.textContent).toBe("");
		const completed = a.position.clone();
		alignmentPointer(label, "pointerdown", 438, 345, 1, pointerType);
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		expect(origin.getAttribute("cx")).toBe("368");
		alignmentPointer(label, "pointermove", 478, 345, 1, pointerType);
		expect(readout.textContent).toBe(`${(40 * worldPerPixel).toFixed(2)} m`);
		alignmentPointer(label, "pointercancel", 478, 345, 1, pointerType);
		expect(overlay.style.display).toBe("none");
		expect(a.position.distanceTo(completed)).toBeLessThan(1e-8);
		alignmentPointer(label, "pointerdown", 438, 345, 1, pointerType);
		alignmentPointer(label, "pointermove", 478, 345, 1, pointerType);
		labels.setVisible(false);
		expect(overlay.style.display).toBe("none");
		labels.setVisible(true);
		alignmentPointer(gizmo.rotationRings[1], "pointerdown", 489, 300, 1, pointerType);
		expect(overlay.style.display).toBe("none");
		viewer.disablePointCloudAlignment();
		expect(overlay.isConnected).toBe(false);
	});

	it("hides a nonzero translation that rounds to zero meters until its displayed value becomes nonzero", () => {
		const {viewer, labels, camera, clouds: [a, b]} = fixture();
		// Strong zoom produces accepted screen drags whose world distance is below 0.005m.
		camera.zoom = 1000;
		camera.updateProjectionMatrix();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const label = labels.labels.get(a), readout = tool.gizmo.translationDistanceLabel;
		alignmentPointer(label, "pointerdown", 400, 300);
		alignmentPointer(label, "pointermove", 404, 300);
		expect(a.position.length()).toBeGreaterThan(0);
		expect(tool.gizmo.translationFeedback.style.display).toBe("block");
		expect(readout.style.display).toBe("none");
		expect(readout.textContent).toBe("");
		alignmentPointer(label, "pointermove", 600, 300);
		expect(readout.style.display).toBe("flex");
		expect(readout.textContent).toBe("0.01 m");
	});

	it.each([
		[450.1, "90.1°"], [-450.1, "-90.1°"],
		[720.1, "0.1°"], [-720.1, "-0.1°"],
		[1080.2, "0.2°"], [-1080.2, "-0.2°"],
		[359.96, ""], [-359.96, ""],
	])("formats %s accumulated degrees without floating-point tails", (angle, expected) => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		alignmentPointer(tool.gizmo.rotationRings[1], "pointerdown", 489, 300);
		// Isolate fractional multi-turn formatting from pointer sampling and camera projection.
		tool.gizmo.gesture.angle = angle * Math.PI / 180;
		tool.gizmo.updateRotationFeedback();
		expect(tool.gizmo.rotationAngleLabel.textContent).toBe(expected);
		expect(tool.gizmo.rotationAngleLabel.style.display).toBe(expected ? "flex" : "none");
	});

	it.each(["perspective", "orthographic"])("shows a gesture-local sector and angle through turns and reversals with a %s camera", projection => {
		const {viewer, labels, scene, clouds: [a, b]} = fixture();
		if (projection === "orthographic") {
			// Both camera types must report the actual transform angle with identical screen sectors.
			const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 1000);
			camera.position.set(0, 0, 20);
			camera.lookAt(0, 0, 0);
			scene.getActiveCamera = () => camera;
		}
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const {rotationSector: sector, rotationAngleLabel: readout} = tool.gizmo;
		const ring = tool.gizmo.rotationRings[1];
		expect(sector.getAttribute("fill")).toBe("#1c7efd80");
		expect(sector.style.display).toBe("none");
		expect(readout.style.display).toBe("none");
		expect(readout.style.width).toBe("50px");
		expect(readout.style.height).toBe("24px");
		expect(readout.style.borderRadius).toBe("4px");
		expect(readout.style.padding).toBe("2px 8px");
		expect(readout.style.fontSize).toBe("14px");
		expect(readout.style.fontFamily).toBe("");
		// The readout fits between the center label and ring instead of using fixed page offsets.
		expect(parseFloat(readout.style.left)).toBeGreaterThan(110);
		expect(parseFloat(readout.style.left) + 50).toBeLessThan(177);
		alignmentPointer(ring, "pointerdown", 489, 300);
		// Zero angles stay hidden, including nonzero rotations below the displayed precision.
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		expect(sector.getAttribute("d")).toBe("");
		alignmentPointer(ring, "pointermove", 589, 299.99);
		expect(tool.gizmo.gesture.angle).not.toBe(0);
		expect(readout.style.display).toBe("none");
		alignmentPointer(ring, "pointermove", 400, 211);
		expect(readout.textContent).toBe("90°");
		expect(readout.style.display).toBe("flex");
		expect(sector.getAttribute("d")).toContain("M90 90L177 90A87 87 0 0 0");
		alignmentPointer(ring, "pointermove", 311, 300);
		alignmentPointer(ring, "pointermove", 400, 389);
		expect(readout.textContent).toBe("270°");
		expect(sector.getAttribute("d")).toContain("A87 87 0 1 0");
		alignmentPointer(ring, "pointermove", 489, 300);
		// Whole turns hide the zero remainder; further turns display only the signed remainder.
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		expect(sector.getAttribute("d").match(/A/g)).toHaveLength(2);
		alignmentPointer(ring, "pointermove", 400, 211);
		expect(readout.textContent).toBe("90°");
		expect(readout.style.display).toBe("flex");
		expect(tool.gizmo.gesture.angle).toBeCloseTo(5 * Math.PI / 2);
		expect(sector.getAttribute("d").match(/A/g)).toHaveLength(2);
		// Reversing shrinks the signed sweep rather than retaining stale filled areas.
		for (const [x, y] of [[489, 300], [400, 389], [311, 300], [400, 211], [489, 300]]) alignmentPointer(ring, "pointermove", x, y);
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		expect(sector.getAttribute("d")).toBe("");
		alignmentPointer(ring, "pointermove", 400, 389);
		expect(readout.textContent).toBe("-90°");
		expect(sector.getAttribute("d")).toContain("A87 87 0 0 1");
		// Clockwise multi-turn gestures retain their sign and follow the same zero handling.
		for (const [x, y] of [[311, 300], [400, 211], [489, 300]]) alignmentPointer(ring, "pointermove", x, y);
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		alignmentPointer(ring, "pointermove", 400, 389);
		expect(readout.textContent).toBe("-90°");
		expect(readout.style.display).toBe("flex");
		expect(tool.gizmo.gesture.angle).toBeCloseTo(-5 * Math.PI / 2);
		alignmentPointer(ring, "pointerup", 400, 389);
		expect(sector.style.display).toBe("none");
		expect(sector.getAttribute("d")).toBe("");
		expect(readout.style.display).toBe("none");
		// A new press resets the angle and sector origin despite the cloud's existing rotation.
		alignmentPointer(ring, "pointerdown", 311, 300);
		expect(readout.textContent).toBe("");
		expect(readout.style.display).toBe("none");
		alignmentPointer(ring, "pointermove", 400, 211);
		expect(readout.textContent).toBe("-90°");
		expect(sector.getAttribute("d")).toMatch(/^M90 90L3 /);
		alignmentPointer(ring, "pointercancel", 400, 211);
		expect(a.rotation.z).toBeCloseTo(-Math.PI / 2);
		expect(sector.style.display).toBe("none");
		expect(readout.style.display).toBe("none");
		expect(readout.textContent).toBe("");
		alignmentPointer(labels.labels.get(a), "pointerdown", 400, 300);
		expect(sector.style.display).toBe("none");
		expect(readout.style.display).toBe("none");
	});

	it("rotates around the label center, unwraps full turns and rolls back on target change or later", () => {
		const {viewer, labels, clouds: [a, b, c]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const ring = tool.gizmo.element.querySelector(".potree-point-cloud-alignment-ring");
		// Exercise rotation on the enlarged ring's actual 89px stroke centerline.
		alignmentPointer(ring, "pointerdown", 489, 300);
		for (const [x, y] of [[400, 211], [311, 300], [400, 389], [489, 300], [400, 211]]) alignmentPointer(ring, "pointermove", x, y);
		expect(tool.gizmo.gesture.angle).toBeCloseTo(5 * Math.PI / 2, 7);
		alignmentPointer(ring, "pointerup", 400, 211);
		expect(a.position.length()).toBeLessThan(1e-7);
		expect(a.rotation.z).toBeCloseTo(Math.PI / 2, 7);
		tool.setActive2PointCloud(b);
		expect(a.rotation.z).toBeCloseTo(Math.PI / 2, 7);
		tool.setActive2PointCloud(c);
		expect(a.rotation.z).toBeCloseTo(0, 10);
		const label = labels.labels.get(a);
		alignmentPointer(label, "pointerdown", 400, 300);
		alignmentPointer(label, "pointerup", 430, 300);
		expect(a.position.x).toBeGreaterThan(0);
		tool.cancel();
		expect(a.position.toArray()).toEqual([0, 0, 0]);
		expect(a.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-10);
	});

	it("cancels just the in-flight gesture on pointer loss, screenshot hide, projection change or blur", () => {
		const {viewer, labels, camera, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const label = labels.labels.get(a);
		alignmentPointer(label, "pointerdown", 400, 300);
		alignmentPointer(label, "pointerup", 430, 300);
		const completed = a.position.clone();
		const x = parseFloat(label.style.left), y = parseFloat(label.style.top);
		for (const cancel of [() => alignmentPointer(label, "pointercancel", x + 30, y), () => labels.setVisible(false), () => {camera.zoom = 2; camera.updateProjectionMatrix(); tool.gizmo.update();}, () => window.dispatchEvent(new Event("blur")), () => viewer.dispatchEvent({type: "view_mode_changed"})]) {
			labels.setVisible(true);
			alignmentPointer(label, "pointerdown", x, y);
			alignmentPointer(label, "pointermove", x + 30, y);
			expect(a.position.x).toBeGreaterThan(completed.x);
			cancel();
			// Every cancellation path restores rotation controls, including screenshot and view changes.
			expect(tool.gizmo.directionArrows.every(arrow => arrow.getAttribute("stroke-width") === "2" && arrow.style.filter === "")).toBe(true);
			expect(tool.gizmo.rotationRings.every(ring => ring.style.display !== "none")).toBe(true);
			expect(tool.gizmo.rotationHandle.style.display).toBe("flex");
			expect(a.position.distanceTo(completed)).toBeLessThan(1e-8);
			expect(tool.gizmo.gesture).toBeNull();
			expect(viewer.fjdCameraControls.enabled).toBe(true);
		}
		labels.setVisible(true);
		expect(tool.getState().active2Pointcloud).toBe(b);
	});
});

it("rolls back an in-flight gesture before source removal and releases every owner", () => {
	const {viewer, labels, scene, clouds: [a, b]} = fixture();
	labels.setActivePointCloud(a);
	const tool = viewer.enablePointCloudAlignment();
	tool.setActive2PointCloud(b);
	const label = labels.labels.get(a);
	alignmentPointer(label, "pointerdown", 400, 300);
	alignmentPointer(label, "pointermove", 430, 300);
	scene.pointclouds = [b];
	expect(() => scene.dispatchEvent({type: "pointcloud_removed", pointcloud: a})).not.toThrow();
	expect(a.position.length()).toBe(0);
	expect(viewer.fjdCameraControls.enabled).toBe(true);
	expect(viewer.pointCloudAlignmentTool).toBeNull();
	expect(tool.gizmo.element.isConnected).toBe(false);
	viewer.disablePointCloudLabels();
});

describe("alignment input ownership edges", () => {
	afterEach(() => {
		viewers.splice(0).forEach(viewer => {viewer.disablePointCloudAlignment(); viewer.disablePointCloudLabels();});
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("hides handles during free-view and animated camera transitions and rejects singular parents", () => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		viewer.getViewMode = () => "3d";
		tool.gizmo.update();
		expect(tool.gizmo.element.style.display).toBe("none");
		viewer.getViewMode = () => "top";
		viewer.viewModeController = {transition: {}};
		tool.gizmo.update();
		expect(tool.gizmo.element.style.display).toBe("none");
		viewer.viewModeController.transition = null;
		labels.update();
		const parent = new THREE.Object3D();
		parent.scale.set(0, 1, 1);
		parent.add(a);
		labels.update();
		alignmentPointer(labels.labels.get(a), "pointerdown", 400, 300);
		expect(tool.gizmo.gesture).toBeUndefined();
		expect(a.position.toArray()).toEqual([0, 0, 0]);
	});

	it("cancels multi-pointer input and full previews on target removal, scene switch and label disposal", () => {
		for (const ending of ["target", "scene", "labels"]) {
			const {viewer, labels, scene, makeScene, clouds: [a, b]} = fixture();
			labels.setActivePointCloud(a);
			const tool = viewer.enablePointCloudAlignment();
			tool.setActive2PointCloud(b);
			const label = labels.labels.get(a);
			alignmentPointer(label, "pointerdown", 400, 300, 1);
			alignmentPointer(label, "pointermove", 430, 300, 1);
			alignmentPointer(label, "pointerdown", 430, 300, 2);
			expect(a.position.length()).toBe(0);
			alignmentPointer(label, "pointerdown", 400, 300);
			alignmentPointer(label, "pointerup", 430, 300);
			expect(a.position.x).toBeGreaterThan(0);
			if (ending === "target") {
				scene.pointclouds = [a];
				scene.dispatchEvent({type: "pointcloud_removed", pointcloud: b});
				expect(tool.getState().phase).toBe("waiting");
				expect(tool.gizmo.element.style.display).toBe("none");
			} else if (ending === "scene") {
				viewer.scene = makeScene([b]);
				viewer.dispatchEvent({type: "scene_changed"});
				expect(viewer.pointCloudAlignmentTool).toBeNull();
			} else viewer.disablePointCloudLabels();
			expect(a.position.length()).toBe(0);
			expect(viewer.fjdCameraControls.enabled).toBe(true);
		}
	});

	it("rolls back a live preview before disabling tracking and releasing its records", () => {
		const {viewer, labels, clouds: [a, b]} = fixture();
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		const original = a.matrix.clone();
		applyAlignmentLocalMatrix(a, new THREE.Matrix4().makeTranslation(9, 0, 0).multiply(a.matrix));
		viewer.disablePointCloudAlignmentTracking();
		expect(a.matrix.equals(original)).toBe(true);
		expect(tool.disposed).toBe(true);
		expect(viewer.pointCloudAlignmentTool).toBeNull();
		expect(() => viewer.exportPointCloudAlignmentResults()).toThrow("Enable");
	});

	it("exports hidden and unchanged members, commits cumulatively, and excludes previews and cancellation", () => {
		const {viewer, labels, clouds: [a, b, c]} = fixture();
		c.visible = false;
		expect(viewer.exportPointCloudAlignmentResults().pointclouds).toHaveLength(3);
		expect(() => viewer.getPointCloudAlignmentResult(new THREE.Object3D())).toThrow(RangeError);
		labels.setActivePointCloud(a);
		const tool = viewer.enablePointCloudAlignment();
		tool.setActive2PointCloud(b);
		applyAlignmentLocalMatrix(a, new THREE.Matrix4().makeTranslation(2, 3, 0).multiply(a.matrix));
		expect(viewer.getPointCloudAlignmentResult(a).deltaMatrix).toEqual(new THREE.Matrix4().toArray());
		expect(tool.commit()).toBe(true);
		const confirmed = viewer.getPointCloudAlignmentResult(a);
		expect(confirmed.deltaMatrix.slice(12, 15)).toEqual([2, 3, 0]);
		const next = viewer.enablePointCloudAlignment();
		next.setActive2PointCloud(b);
		applyAlignmentLocalMatrix(a, new THREE.Matrix4().makeTranslation(7, 0, 0).multiply(a.matrix));
		expect(viewer.getPointCloudAlignmentResult(a)).toEqual(confirmed);
		next.cancel();
		expect(viewer.getPointCloudAlignmentResult(a)).toEqual(confirmed);
		viewer.disablePointCloudLabels();
		expect(viewer.getPointCloudAlignmentResult(a)).toEqual(confirmed);
		viewer.scene = {pointclouds: []};
		expect(viewer.exportPointCloudAlignmentResults().pointclouds).toEqual([]);
		expect(() => viewer.getPointCloudAlignmentResult(a)).toThrow(RangeError);
	});
});
