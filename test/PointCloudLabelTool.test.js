import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {PointCloudLabelTool} from "../src/utils/PointCloudLabelTool.js";
import {setPointCloudStationHidden} from "../src/utils/PointCloudLabelAppearance.js";

let Viewer;
const tools = [];

/** Use real Three matrices and minimal scene events without allocating a WebGL context. */
function fixture(orthographic = false, clouds = [cloud()]) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const rect = {left: 35, top: 20, width: 800, height: 600};
	element.getBoundingClientRect = () => rect;
	const camera = orthographic ? new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, -100, 100) : new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
	camera.position.set(0, 0, 20);
	camera.lookAt(0, 0, 0);
	const makeScene = (items) => Object.assign(new EventDispatcher(), {pointclouds: items, getActiveCamera: () => camera});
	const scene = makeScene(clouds);
	const viewer = Object.assign(new EventDispatcher(), {
		renderArea: element, renderer: {domElement: element}, scene,
		enablePointCloudLabels: Viewer.prototype.enablePointCloudLabels,
		disablePointCloudLabels: Viewer.prototype.disablePointCloudLabels,
	});
	return {viewer, camera, scene, rect, element, makeScene};
}

/** Give each identity a finite local box, including non-origin centers. */
function cloud() {
	const pc = new THREE.Object3D();
	pc.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
	return pc;
}

/** Track tools to prove teardown works even after an assertion fails. */
function enable(viewer) {
	const tool = viewer.enablePointCloudLabels();
	tools.push(tool);
	return tool;
}

describe("passive point-cloud labels", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => { tools.splice(0).forEach((tool) => tool.dispose()); document.body.replaceChildren(); });

	it("is opt-in, idempotent, exported, and fully released before re-enabling", () => {
		const {viewer, scene, element} = fixture();
		expect(element.children).toHaveLength(0);
		expect(viewer.pointCloudLabelTool).toBeUndefined();
		const tool = enable(viewer);
		expect(tool).toBeInstanceOf(PointCloudLabelTool);
		expect(viewer.enablePointCloudLabels()).toBe(tool);
		const unrelated = vi.fn();
		viewer.addEventListener("update", unrelated);
		viewer.disablePointCloudLabels();
		expect(viewer.pointCloudLabelTool).toBeNull();
		expect(element.children).toHaveLength(0);
		viewer.dispatchEvent({type: "update"});
		expect(unrelated).toHaveBeenCalledOnce();
		for (const event of ["update", "scene_changed", "render.pass.end"]) expect(viewer.hasEventListener(event, event === "scene_changed" ? tool.onSceneChanged : tool.onUpdate)).toBe(false);
		for (const event of ["pointcloud_added", "pointcloud_removed"]) expect(scene.hasEventListener(event, tool.onCloudChanged)).toBe(false);
		tool.setVisible(true);
		tool.setLabel(scene.pointclouds[0], "stale");
		expect(element.children).toHaveLength(0);
		const next = enable(viewer);
		expect(next).not.toBe(tool);
		expect(next.labels.get(scene.pointclouds[0]).textContent).toBe("01");
	});

	it("preserves numbering across hiding, removal, re-addition and explicit overrides", () => {
		const a = cloud(), b = cloud(), c = cloud();
		const {viewer, scene} = fixture(false, [a, b]);
		const tool = enable(viewer);
		tool.setLabel(a, "08");
		expect(tool.labels.get(a).textContent).toBe("08");
		tool.setLabel(a, null);
		expect(tool.labels.get(a).textContent).toBe("01");
		a.visible = false;
		viewer.dispatchEvent({type: "update"});
		expect(tool.labels.get(a).style.display).toBe("none");
		scene.pointclouds = [b, c];
		scene.dispatchEvent({type: "pointcloud_removed", pointcloud: a});
		expect(tool.labels.has(a)).toBe(false);
		expect(tool.labels.get(b).textContent).toBe("02");
		expect(tool.labels.get(c).textContent).toBe("03");
		scene.pointclouds.push(a);
		scene.dispatchEvent({type: "pointcloud_added", pointcloud: a});
		expect(tool.labels.get(a).textContent).toBe("01");
		for (let i = 0; i < 97; i++) scene.pointclouds.push(cloud());
		tool.update();
		expect(tool.labels.get(scene.pointclouds.at(-1)).textContent).toBe("100");
	});

	// Station masking must cull endpoints without discarding numbering, text or relation records.
	it("restores station-hidden labels and endpoints without recreating scene identities", () => {
		const a = cloud(), b = cloud(), owner = {};
		const {viewer} = fixture(false, [a, b]);
		const tool = enable(viewer);
		tool.setLabel(b, "station B");
		tool.setConnections([{source: a, target: b}]);
		const element = tool.labels.get(b);
		setPointCloudStationHidden(b, owner, true);
		try {
			tool.update();
			expect(element.style.display).toBe("none");
			expect(tool.connectionProjections.has(b)).toBe(false);
			expect(tool.connectionProjections.has(a)).toBe(true);
			expect(tool.connections).toHaveLength(1);
		} finally {setPointCloudStationHidden(b, owner, false);}
		tool.update();
		expect(tool.labels.get(b)).toBe(element);
		expect(element.style.display).toBe("flex");
		expect(element.textContent).toBe("station B");
		expect(tool.connectionProjections.has(b)).toBe(true);
		tool.setLabel(b, null);
		expect(element.textContent).toBe("02");
	});

	it("restarts numbering and unbinds the old scene on a scene switch", () => {
		const {viewer, scene, makeScene} = fixture();
		const tool = enable(viewer);
		tool.setLabel(scene.pointclouds[0], "old");
		const next = makeScene([cloud(), scene.pointclouds[0]]);
		viewer.scene = next;
		viewer.dispatchEvent({type: "scene_changed", scene: next, oldScene: scene});
		expect([...tool.labels.values()].map((element) => element.textContent)).toEqual(["01", "02"]);
		expect(scene.hasEventListener("pointcloud_added", tool.onCloudChanged)).toBe(false);
	});

	it("anchors to tight point-cloud bounds rather than empty octree cube padding", () => {
		// Real metadata can pad a shallow cloud into a tall cube crossing the camera plane.
		const pc = cloud();
		pc.pcoGeometry = {tightBoundingBox: pc.boundingBox.clone()};
		pc.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(100, 100, 100));
		const {viewer} = fixture(false, [pc]);
		const tool = enable(viewer);
		const label = tool.labels.get(pc);
		expect(label.style.display).toBe("flex");
		expect(parseFloat(label.style.left)).toBeCloseTo(400);
		expect(parseFloat(label.style.top)).toBeCloseTo(300);
	});

	// Explicit anchors share one projection path while the legacy default remains unchanged.
	it("opts into world anchors, retains them for new scenes and releases them on disposal", () => {
		const a = cloud(), b = cloud();
		const {viewer, scene, makeScene} = fixture(false, [a]);
		const tool = enable(viewer), pose = a.matrix.clone();
		expect(tool.anchorResolver).toBeNull();
		expect(tool.getWorldAnchor(a).toArray()).toEqual([0, 0, 0]);
		const resolver = (pc, target) => target.set(1, 2, 1.2).applyMatrix4(pc.matrixWorld);
		expect(tool.setAnchorResolver(resolver)).toBe(tool);
		expect(tool.getWorldAnchor(a).toArray()).toEqual([1, 2, 1.2]);
		expect(a.matrix.equals(pose)).toBe(true);
		expect(a.userData).toEqual({});
		expect(tool.getActivePointCloud()).toBeNull();
		expect(() => tool.setAnchorResolver({})).toThrow(TypeError);
		scene.pointclouds.push(b);
		scene.dispatchEvent({type: "pointcloud_added", pointcloud: b});
		expect(tool.getWorldAnchor(b).toArray()).toEqual([1, 2, 1.2]);
		viewer.scene = makeScene([b]);
		viewer.dispatchEvent({type: "scene_changed"});
		expect(tool.anchorResolver).toBe(resolver);
		expect(tool.labels.get(b).textContent).toBe("01");
		tool.setAnchorResolver(null);
		expect(tool.getWorldAnchor(b).toArray()).toEqual([0, 0, 0]);
		tool.setAnchorResolver(resolver);
		tool.dispose();
		expect(tool.anchorResolver).toBeNull();
		expect(tool.getWorldAnchor(b)).toBeNull();
		tool.setAnchorResolver(resolver);
		expect(tool.anchorResolver).toBeNull();
		expect(enable(viewer).anchorResolver).toBeNull();
	});

	it("hides invalid custom anchors and their edges without suppressing other labels", () => {
		const a = cloud(), b = cloud();
		b.position.x = 4;
		const {viewer} = fixture(false, [a, b]), tool = enable(viewer);
		tool.setConnections([{source: a, target: b}]);
		for (const invalid of [() => null, () => undefined, (_pc, target) => target.set(NaN, 0, 0), () => {throw new Error("bad metadata");}]) {
			tool.setAnchorResolver((pc, target) => pc === a ? invalid(pc, target) : target.setFromMatrixPosition(pc.matrixWorld));
			expect(tool.labels.get(a).style.display).toBe("none");
			expect(tool.labels.get(b).style.display).toBe("flex");
			expect(tool.connections[0].element.style.display).toBe("none");
			expect(tool.connectionProjections.has(a)).toBe(false);
		}
		// Valid custom anchors do not require a bounding box, and connections use those same anchors.
		delete a.boundingBox;
		tool.setAnchorResolver((pc, target) => target.set(1, 1, 1.2).applyMatrix4(pc.matrixWorld));
		expect(tool.labels.get(a).style.display).toBe("flex");
		expect(tool.connections[0].element.style.display).toBe("");
		const clip = tool.connectionProjections.get(a).clip;
		expect(parseFloat(tool.labels.get(a).style.left)).toBeCloseTo((clip.x / clip.w + 1) * 400);
		a.position.x = 1000;
		tool.update();
		expect(tool.labels.get(a).style.display).toBe("none");
		expect(tool.connections[0].element.style.display).toBe("");
	});

	for (const orthographic of [false, true]) {
		it(`projects custom anchors across all views, parent transforms and viewport sizes (${orthographic})`, () => {
			const pc = cloud(), parent = new THREE.Object3D();
			parent.position.set(1e6, 2e6, 3e6);
			parent.rotation.set(0.2, -0.3, 0.5);
			parent.add(pc);
			pc.position.set(1, -1, 2);
			const {viewer, camera, rect} = fixture(orthographic, [pc]), tool = enable(viewer);
			tool.setAnchorResolver((pointcloud, target) => target.set(1, 2, 1.2).applyMatrix4(pointcloud.matrixWorld));
			for (const direction of [[12, 12, 12], [0, 0, 20], [0, 0, -20], [-20, 0, 0], [20, 0, 0], [0, -20, 0], [0, 20, 0]]) {
				const anchor = tool.getWorldAnchor(pc);
				camera.position.copy(anchor).add(new THREE.Vector3(...direction));
				// Avoid lookAt's pole perturbation when the viewing direction is parallel to camera up.
				camera.up.set(0, direction[2] ? 1 : 0, direction[2] ? 0 : 1);
				camera.lookAt(anchor);
				tool.update();
				const label = tool.labels.get(pc);
				expect(label.style.display).toBe("flex");
				expect(parseFloat(label.style.left)).toBeCloseTo(rect.width / 2, 5);
				expect(parseFloat(label.style.top)).toBeCloseTo(rect.height / 2, 5);
			}
			rect.width /= 2; rect.height /= 2;
			viewer.dispatchEvent({type: "render.pass.end"});
			expect(parseFloat(tool.labels.get(pc).style.left)).toBeCloseTo(rect.width / 2, 5);
			parent.visible = false; tool.update();
			expect(tool.labels.get(pc).style.display).toBe("none");
		});

		it(`projects transformed centers and large coordinates with ${orthographic ? "orthographic" : "perspective"} cameras`, () => {
			const pc = cloud();
			const parent = new THREE.Object3D();
			parent.position.set(1000000, 2000000, 3000000);
			parent.rotation.z = 0.4;
			parent.scale.set(2, 3, 4);
			parent.add(pc);
			pc.position.set(1, 2, 0);
			const {viewer, camera, rect} = fixture(orthographic, [pc]);
			camera.position.set(1000000, 2000000, 3000020);
			camera.lookAt(parent.position);
			const tool = enable(viewer);
			const label = tool.labels.get(pc);
			for (const offset of [0, 0.7]) {
				parent.rotation.z += offset;
				viewer.dispatchEvent({type: "update"});
				const projected = pc.boundingBox.clone().applyMatrix4(pc.matrixWorld).getCenter(new THREE.Vector3()).project(camera);
				expect(parseFloat(label.style.left)).toBeCloseTo((projected.x + 1) * rect.width / 2, 5);
				expect(parseFloat(label.style.top)).toBeCloseTo((1 - projected.y) * rect.height / 2, 5);
				expect(label.style.display).toBe("flex");
			}
			rect.width = 400; rect.height = 300;
			viewer.dispatchEvent({type: "render.pass.end"});
			expect(tool.layer.style.width).toBe("400px");
			expect(tool.layer.style.left).toBe("35px");
			// Compact labels retain readable white text after viewport changes.
			expect(label.style.width).toBe("40px");
			expect(label.style.height).toBe("40px");
			expect(label.style.color).toBe("rgb(255, 255, 255)");
			expect(label.style.fontSize).toBe("14px");
			// Only the button accepts input; the surrounding layer still passes through.
			expect(label.style.pointerEvents).toBe("auto");
			expect(tool.layer.style.pointerEvents).toBe("none");
			parent.visible = false; tool.update();
			expect(label.style.display).toBe("none");
		});

		it(`follows all seven camera directions and rejects hidden, offscreen and rear centers (${orthographic})`, () => {
			const {viewer, camera, scene} = fixture(orthographic);
			const tool = enable(viewer);
			const pc = scene.pointclouds[0], label = tool.labels.get(pc);
			for (const direction of [[12, 12, 12], [0, 0, 20], [0, 0, -20], [-20, 0, 0], [20, 0, 0], [0, -20, 0], [0, 20, 0]]) {
				camera.position.fromArray(direction); camera.lookAt(0, 0, 0); tool.update();
				expect(label.style.display).toBe("flex");
				expect(parseFloat(label.style.left)).toBeCloseTo(400);
			}
			camera.position.set(0, 0, 20); camera.lookAt(0, 0, 0);
			pc.position.z = 30; tool.update(); expect(label.style.display).toBe("none");
			pc.position.set(1000, 0, 0); tool.update(); expect(label.style.display).toBe("none");
			pc.position.set(0, 0, 0); tool.setVisible(false);
			expect(tool.layer.style.display).toBe("none");
			tool.setVisible(true); expect(label.style.display).toBe("flex");
		});
	}
});

import {getPointCloudLabelAppearance} from "../src/utils/PointCloudLabelAppearance.js";
import {getPointcloudEffectState, setPointcloudEDLEnabled, setPointcloudXRAYEnabled} from "../src/viewer/PointcloudEffectUtils.js";

/** Simulate a full mouse/touch pointer gesture while retaining native button click semantics. */
function labelPointer(element, type, x, y, id = 1, pointerType = "mouse") {
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
	Object.defineProperties(event, {pointerId: {value: id}, pointerType: {value: pointerType}});
	element.dispatchEvent(event);
}

describe("single active point-cloud label", () => {
	beforeAll(async () => {
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});
	afterEach(() => { tools.splice(0).forEach(tool => tool.dispose()); document.body.replaceChildren(); });

	it("starts unselected, switches only one active identity, and emits only actual changes", () => {
		const a = cloud(), b = cloud();
		a.userData.edlEnabled = true;
		b.userData.xrayEnabled = true;
		const {viewer, element} = fixture(false, [a, b]);
		const tool = enable(viewer);
		const changed = vi.fn();
		viewer.addEventListener("active_pointcloud_changed", changed);
		expect(tool.getActivePointCloud()).toBeNull();
		expect(getPointcloudEffectState(a).edlEnabled).toBe(true);
		expect(tool.labels.get(a).tagName).toBe("BUTTON");
		expect(tool.labels.get(a).getAttribute("aria-label")).toBe("Select point cloud 01");
		expect(tool.layer.hasAttribute("aria-hidden")).toBe(false);
		tool.labels.get(a).click();
		expect(tool.getActivePointCloud()).toBe(a);
		// Only the active cloud owns EDL; other members retain their color under Xray.
		expect(getPointcloudEffectState(a)).toMatchObject({xrayEnabled: false, edlEnabled: true});
		expect(getPointcloudEffectState(b)).toMatchObject({xrayEnabled: true, edlEnabled: false});
		expect(tool.labels.get(a).getAttribute("aria-pressed")).toBe("true");
		tool.labels.get(a).click();
		element.click();
		expect(changed).toHaveBeenCalledTimes(1);
		tool.labels.get(b).click();
		expect(tool.getActivePointCloud()).toBe(b);
		expect(tool.labels.get(a).getAttribute("aria-pressed")).toBe("false");
		// Switching active transfers EDL without overwriting either base configuration.
		expect(getPointcloudEffectState(a)).toMatchObject({xrayEnabled: true, edlEnabled: false});
		expect(getPointcloudEffectState(b)).toMatchObject({xrayEnabled: false, edlEnabled: true});
		expect(changed.mock.calls[1][0]).toMatchObject({pointcloud: b, previousPointcloud: a});
		expect(a.userData).toEqual({edlEnabled: true});
		expect(b.userData).toEqual({xrayEnabled: true});
		expect(() => tool.setActivePointCloud(cloud())).toThrow(RangeError);
		tool.setActivePointCloud(null);
		expect(getPointcloudEffectState(a).edlEnabled).toBe(true);
		expect(getPointCloudLabelAppearance(b)).toBeUndefined();
	});

	it("makes paired non-primary labels inert without changing their shared palette", () => {
		const a = cloud(), b = cloud(), c = cloud(), {viewer} = fixture(false, [a, b, c]);
		const tool = enable(viewer);
		tool.setActivePointCloud(a);
		const style = tool.labels.get(b).style.backgroundColor;
		// Isolate label interaction policy from the alignment transaction and its gesture calculations.
		tool.alignmentTool = {active2PointCloud: b};
		try {
			tool.syncAppearance();
			for (const pc of [b, c]) {
				const label = tool.labels.get(pc);
				expect(label.disabled).toBe(true);
				expect(label.style.pointerEvents).toBe("none");
				expect(label.style.backgroundColor).toBe(style);
				const event = new MouseEvent("click", {bubbles: true, cancelable: true});
				label.dispatchEvent(event);
				expect(event.defaultPrevented).toBe(true);
			}
			expect(tool.labels.get(a).disabled).toBe(false);
			expect(tool.labels.get(a).style.pointerEvents).toBe("auto");
			expect(tool.getActivePointCloud()).toBe(a);
		} finally { tool.alignmentTool = null; tool.syncAppearance(); }
		for (const label of tool.labels.values()) {
			expect(label.disabled).toBe(false);
			expect(label.style.pointerEvents).toBe("auto");
		}
	});

	it("keeps one 40px blue and white-bordered palette across all selection changes", () => {
		const a = cloud(), b = cloud();
		const {viewer} = fixture(false, [a, b]);
		const tool = enable(viewer);
		const first = tool.labels.get(a), second = tool.labels.get(b);
		// Selecting, switching, editing text and clearing must never alter the shared style.
		const uniform = element => {
			expect(element.style.width).toBe("40px");
			expect(element.style.height).toBe("40px");
			expect(element.style.backgroundColor).toBe("rgb(28, 126, 253)");
			expect(element.style.borderColor).toBe("rgb(255, 255, 255)");
			expect(element.style.borderWidth).toBe("2px");
			expect(element.style.borderStyle).toBe("solid");
			expect(element.style.color).toBe("rgb(255, 255, 255)");
		};
		uniform(first); uniform(second);
		tool.setActivePointCloud(a);
		uniform(first); uniform(second);
		tool.setLabel(a, "08");
		tool.setVisible(false); tool.setVisible(true);
		uniform(first); uniform(second);
		tool.setActivePointCloud(b);
		uniform(first); uniform(second);
		tool.setActivePointCloud(null);
		uniform(first); uniform(second);
	});

	it("keeps selection above settings and restores the latest base preferences when cleared", () => {
		const a = cloud(), b = cloud();
		const {viewer} = fixture(false, [a, b]);
		const tool = enable(viewer);
		tool.setActivePointCloud(a);
		// The same setters are used by the settings panel and TreeTag selection.
		setPointcloudXRAYEnabled(a, true);
		setPointcloudEDLEnabled(b, true);
		expect(a.userData).toMatchObject({edlEnabled: false, xrayEnabled: true});
		expect(b.userData).toMatchObject({edlEnabled: true, xrayEnabled: false});
		// Selection owns EDL/Xray routing until cleared, even when opposite base effects are saved.
		expect(getPointcloudEffectState(a)).toMatchObject({edlEnabled: true, xrayEnabled: false});
		expect(getPointcloudEffectState(b)).toMatchObject({edlEnabled: false, xrayEnabled: true});
		tool.setActivePointCloud(null);
		expect(getPointcloudEffectState(a).xrayEnabled).toBe(true);
		expect(getPointcloudEffectState(b).edlEnabled).toBe(true);
	});

	it("retains hidden selection and covers late arrivals but clears when the active member is removed", () => {
		const a = cloud(), b = cloud();
		const {viewer, scene} = fixture(false, [a]);
		const tool = enable(viewer);
		tool.setActivePointCloud(a);
		a.visible = false; tool.update();
		expect(tool.getActivePointCloud()).toBe(a);
		tool.setVisible(false);
		scene.pointclouds.push(b);
		scene.dispatchEvent({type: "pointcloud_added", pointcloud: b});
		expect(getPointCloudLabelAppearance(b)).toBe(false);
		// Late members inherit the current Xray override, including when labels are hidden.
		expect(getPointcloudEffectState(b)).toMatchObject({edlEnabled: false, xrayEnabled: true});
		expect(tool.getActivePointCloud()).toBe(a);
		tool.setVisible(true);
		expect(tool.getActivePointCloud()).toBe(a);
		scene.pointclouds = [b];
		scene.dispatchEvent({type: "pointcloud_removed", pointcloud: a});
		expect(tool.getActivePointCloud()).toBeNull();
		expect(getPointCloudLabelAppearance(a)).toBeUndefined();
		expect(getPointCloudLabelAppearance(b)).toBeUndefined();
		expect(getPointcloudEffectState(b)).toMatchObject({edlEnabled: false, xrayEnabled: false});
	});

	it("clears old scene overrides and releases detached button handlers on disposal", () => {
		const a = cloud(), b = cloud();
		const {viewer, makeScene} = fixture(false, [a]);
		const tool = enable(viewer);
		tool.setActivePointCloud(a);
		viewer.scene = makeScene([b]);
		viewer.dispatchEvent({type: "scene_changed", scene: viewer.scene});
		expect(tool.getActivePointCloud()).toBeNull();
		expect(getPointCloudLabelAppearance(a)).toBeUndefined();
		tool.setActivePointCloud(b);
		const button = tool.labels.get(b);
		tool.dispose();
		button.click();
		tool.setActivePointCloud(b);
		expect(tool.getActivePointCloud()).toBeNull();
		expect(getPointCloudLabelAppearance(b)).toBeUndefined();
	});

	it("blocks camera/tool events, drag activation and cancelled taps while allowing taps and keyboard clicks", () => {
		const a = cloud(), b = cloud();
		const {viewer, element} = fixture(false, [a, b]);
		const tool = enable(viewer);
		const button = tool.labels.get(a), next = tool.labels.get(b);
		const parentInput = vi.fn();
		for (const type of ["pointerdown", "pointerup", "click", "dblclick", "keydown"]) element.addEventListener(type, parentInput);
		labelPointer(button, "pointerdown", 10, 10);
		labelPointer(button, "pointermove", 40, 10);
		labelPointer(button, "pointerup", 10, 10);
		button.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
		expect(tool.getActivePointCloud()).toBeNull();
		labelPointer(button, "pointerdown", 10, 10, 2, "touch");
		labelPointer(button, "pointercancel", 10, 10, 2, "touch");
		button.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
		expect(tool.getActivePointCloud()).toBeNull();
		labelPointer(button, "pointerdown", 10, 10, 3, "touch");
		labelPointer(button, "pointerup", 12, 10, 3, "touch");
		button.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
		expect(tool.getActivePointCloud()).toBe(a);
		// Native buttons produce detail-zero clicks for Enter and Space activation.
		next.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, key: "Enter"}));
		next.click();
		expect(tool.getActivePointCloud()).toBe(b);
		expect(parentInput).not.toHaveBeenCalled();
	});
});

describe("host-owned label connections", () => {
 afterEach(() => { tools.splice(0).forEach(tool => tool.dispose()); document.body.replaceChildren(); });

 it.each([false, true])("projects border-to-border edges and tracks transformed clouds and viewport changes (ortho=%s)", orthographic => {
  const a = cloud(), b = cloud();
  a.position.x = -3;
  b.position.x = 3;
  const {viewer, rect} = fixture(orthographic, [a, b]);
  const labels = enable(viewer);
  expect(labels.connectionLayer).toBeUndefined();
  labels.setConnections([]);
  expect(labels.connectionLayer).toBeUndefined();
  labels.setConnections([{source: a, target: b}]);
  const edge = labels.connectionLayer.querySelector("line");
  expect(labels.layer.firstChild).toBe(labels.connectionLayer);
  expect(labels.connectionLayer.style.pointerEvents).toBe("none");
  // Relationship edges use the same blue as the label background.
  expect(edge.getAttribute("stroke")).toBe("#1c7efd");
  expect(edge.getAttribute("stroke-width")).toBe("2");
  expect(Number(edge.getAttribute("x1"))).toBeCloseTo(parseFloat(labels.labels.get(a).style.left) + 20, 7);
  expect(Number(edge.getAttribute("x2"))).toBeCloseTo(parseFloat(labels.labels.get(b).style.left) - 20, 7);
  const initial = edge.getAttribute("x1");
  const parent = new THREE.Object3D();
  parent.add(a);
  parent.position.y = 2;
  labels.update();
  expect(Number(edge.getAttribute("y1"))).toBeLessThan(Number(edge.getAttribute("y2")));
  rect.width = 1000;
  viewer.dispatchEvent({type: "render.pass.end"});
  expect(edge.getAttribute("x1")).not.toBe(initial);
 });

 it("remembers independent connection visibility across labels, scene changes and new pairs", () => {
  const a = cloud(), b = cloud(); a.position.x = -3; b.position.x = 3;
  const {viewer} = fixture(false, [a, b]);
  const labels = enable(viewer);
  // Defaults preserve existing callers, and hiding edges never consumes relationship data.
  expect(labels.connectionsVisible).toBe(true);
  labels.setConnections([{source: a, target: b}]);
  expect(labels.setConnectionsVisible(false)).toBe(labels);
  expect(labels.connectionLayer.style.display).toBe("none");
  expect(labels.labels.get(a).style.display).toBe("flex");
  expect(labels.connections).toHaveLength(1);
  labels.setVisible(false); labels.setVisible(true);
  expect(labels.connectionsVisible).toBe(false);
  expect(labels.connectionLayer.style.display).toBe("none");
  labels.setConnections([{source: b, target: a}]);
  expect(labels.connectionLayer.style.display).toBe("none");
  labels.setVisible(false); labels.setConnectionsVisible(true);
  expect(labels.layer.style.display).toBe("none");
  labels.setVisible(true);
  expect(labels.connectionLayer.style.display).toBe("block");
  labels.setConnectionsVisible(false);
  // Changing scenes clears pairs but retains the tool's display preference.
  const camera = viewer.scene.getActiveCamera();
  const next = Object.assign(new EventDispatcher(), {pointclouds: [a, b], getActiveCamera: () => camera});
  viewer.scene = next;
  viewer.dispatchEvent({type: "scene_changed", scene: next});
  labels.setConnections([{source: a, target: b}]);
  expect(labels.connectionsVisible).toBe(false);
  expect(labels.connectionLayer.style.display).toBe("none");
  labels.dispose();
  expect(() => labels.setConnectionsVisible(true)).not.toThrow();
 });

 it("hides during alignment and screenshots, clips offscreen endpoints and suppresses hidden or overlapping objects", () => {
  const a = cloud(), b = cloud(); a.position.x = -3; b.position.x = 3;
  const {viewer} = fixture(false, [a, b]);
  const labels = enable(viewer);
  labels.setConnections([{source: a, target: b}]);
  const edge = labels.connectionLayer.querySelector("line");
  expect(edge.style.display).toBe("");
  labels.alignmentTool = {reconcile() {}, disposed: false};
  labels.update();
  expect(labels.connectionLayer.style.display).toBe("none");
  labels.alignmentTool = null;
  labels.update();
  expect(labels.connectionLayer.style.display).toBe("block");
  labels.setVisible(false);
  expect(labels.layer.style.display).toBe("none");
  labels.setVisible(true);
  b.visible = false; labels.update(); expect(edge.style.display).toBe("none");
  // Offscreen labels disappear, while the connected visible segment reaches the viewport edge.
  b.visible = true; b.position.x = 10000; labels.update(); expect(edge.style.display).toBe("");
  expect(labels.labels.get(b).style.display).toBe("none");
  expect(Number(edge.getAttribute("x2"))).toBeCloseTo(800, 7);
  b.position.copy(a.position); labels.update(); expect(edge.style.display).toBe("none");
  b.position.set(3, 0, 0); labels.update(); expect(edge.style.display).toBe("");
 });

 it("clears foreign scene relations, ignores missing members and releases all SVG references", () => {
  const a = cloud(), b = cloud(); a.position.x = -3; b.position.x = 3;
  const {viewer, makeScene} = fixture(false, [a, b]);
  const labels = enable(viewer);
  labels.setConnections([{source: a, target: b}, {source: a, target: cloud()}]);
  expect(labels.connections[1].element.style.display).toBe("none");
  viewer.scene = makeScene([cloud()]);
  expect(() => viewer.dispatchEvent({type: "scene_changed"})).not.toThrow();
  expect(labels.connections).toEqual([]);
  expect(labels.connectionLayer.children).toHaveLength(0);
  const layer = labels.connectionLayer;
  labels.dispose();
  expect(layer.isConnected).toBe(false);
  expect(labels.connectionLayer).toBeNull();
 });
});

describe("independent connection viewport clipping", () => {
 afterEach(() => { tools.splice(0).forEach(tool => tool.dispose()); document.body.replaceChildren(); });

 it.each([false, true])("keeps all shared-endpoint and unrelated edges when a label leaves the viewport (ortho=%s)", orthographic => {
  const clouds = [-6, -2, 2, 6].map(x => {const pc = cloud(); pc.position.x = x; return pc;});
  const {viewer, camera} = fixture(orthographic, clouds);
  const labels = enable(viewer);
  labels.setConnections([1, 2, 3].map(index => ({source: clouds[0], target: clouds[index]})));
  expect(labels.connections.every(({element}) => element.style.display === "")).toBe(true);
  camera.position.x = orthographic ? 5 : 11;
  camera.lookAt(camera.position.x, 0, 0);
  viewer.dispatchEvent({type: "render.pass.end"});
  expect(labels.labels.get(clouds[0]).style.display).toBe("none");
  expect(labels.connectionLayer.style.display).toBe("block");
  for (const {element} of labels.connections) {
   expect(element.style.display).toBe("");
   expect(Number(element.getAttribute("x1"))).toBeCloseTo(0, 7);
  }
  // Independent visible edges must be unaffected, and relationship identities must remain intact.
  labels.setConnections([[0, 1], [1, 2], [2, 3]].map(([a, b]) => ({source: clouds[a], target: clouds[b]})));
  expect(labels.connections.every(({element}) => element.style.display === "")).toBe(true);
  expect(labels.connections).toHaveLength(3);
  camera.position.x = 0;
  camera.lookAt(0, 0, 0);
  labels.update();
  expect(labels.labels.get(clouds[0]).style.display).toBe("flex");
  expect(Number(labels.connections[0].element.getAttribute("x1"))).toBeCloseTo(parseFloat(labels.labels.get(clouds[0]).style.left) + 20, 7);
 });

 it.each([false, true])("clips both-offscreen endpoints and all viewport boundaries without stale label positions (ortho=%s)", orthographic => {
  const a = cloud(), b = cloud();
  a.position.x = -100; b.position.x = 100;
  const {viewer, rect} = fixture(orthographic, [a, b]);
  const labels = enable(viewer);
  labels.setConnections([{source: a, target: b}]);
  const edge = labels.connections[0].element;
  expect(labels.labels.get(a).style.display).toBe("none");
  expect(labels.labels.get(b).style.display).toBe("none");
  expect(edge.style.display).toBe("");
  expect(Number(edge.getAttribute("x1"))).toBeCloseTo(0, 7);
  expect(Number(edge.getAttribute("x2"))).toBeCloseTo(800, 7);
  a.position.x = 0;
  for (const [x, y, boundary, expected] of [[100, 0, "x2", 800], [-100, 0, "x2", 0], [0, 100, "y2", 0], [0, -100, "y2", 600], [400 / 3, 100, "x2", 800]]) {
   b.position.set(x, y, 0);
   labels.update();
   expect(edge.style.display).toBe("");
   expect(Number(edge.getAttribute(boundary))).toBeCloseTo(expected, 6);
   for (const key of ["x1", "x2"]) expect(Number(edge.getAttribute(key))).toBeGreaterThanOrEqual(0);
   for (const key of ["y1", "y2"]) expect(Number(edge.getAttribute(key))).toBeGreaterThanOrEqual(0);
  }
  b.position.set(100, 0, 0);
  rect.width = 1200;
  viewer.dispatchEvent({type: "render.pass.end"});
  expect(Number(edge.getAttribute("x2"))).toBeCloseTo(1200, 7);
  a.position.x = 100; b.position.x = 200;
  labels.update();
  expect(edge.style.display).toBe("none");
  expect(labels.connections).toHaveLength(1);
 });

 it.each([false, true])("handles camera-plane and near/far crossings while respecting hidden parents (ortho=%s)", orthographic => {
  const a = cloud(), b = cloud(); a.position.x = -3; b.position.set(3, 0, 25);
  const {viewer, camera} = fixture(orthographic, [a, b]);
  const labels = enable(viewer);
  labels.setConnections([{source: a, target: b}]);
  const edge = labels.connections[0].element;
  expect(labels.labels.get(b).style.display).toBe("none");
  expect(edge.style.display).toBe("");
  for (const key of ["x1", "y1", "x2", "y2"]) expect(Number.isFinite(Number(edge.getAttribute(key)))).toBe(true);
  a.position.z = 30;
  labels.update();
  expect(edge.style.display).toBe("none");
  a.position.z = 0;
  camera.near = 1; camera.far = 50; camera.updateProjectionMatrix();
  b.position.z = -100;
  labels.update();
  expect(edge.style.display).toBe("");
  const parent = new THREE.Object3D(); parent.add(a); parent.visible = false;
  labels.update();
  expect(edge.style.display).toBe("none");
  parent.visible = true;
  labels.update();
  expect(edge.style.display).toBe("");
  expect(labels.connections).toHaveLength(1);
 });
});
