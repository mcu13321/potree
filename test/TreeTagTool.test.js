import * as THREE from "../libs/three.js/build/three.module.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TreeTagTool } from "../src/utils/TreeTagTool.js";
import { TreeTag } from "../src/utils/TreeTag.js";
import { EventDispatcher } from "../src/EventDispatcher.js";
import { Utils } from "../src/utils.js";

class MockPointcloud extends EventDispatcher {
	constructor(id = "pc1", visible = true) {
		super();

		const box = new THREE.Box3(
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(10, 10, 10)
		);

		this.name = id;
		this.boundingBox = box;
		this.pcoGeometry = { tightBoundingBox: box };
		this.matrixWorld = new THREE.Matrix4();
		this.userData = {
			offset: { x: 0, y: 0, z: 0 },
		};
		this._visible = visible;
	}

	updateMatrixWorld() {}

	get visible() {
		return this._visible;
	}

	set visible(value) {
		if (this._visible !== value) {
			this._visible = value;
			this.dispatchEvent({ type: "visibility_changed", pointcloud: this });
		}
	}
}

function createMockPointcloud(id = "pc1", visible = true) {
	return new MockPointcloud(id, visible);
}

class MockScene extends EventDispatcher {
	constructor() {
		super();
		this.pointclouds = [];
		// TreeTag 离屏遮挡方案会同时访问普通场景和点云场景。
		this.scene = new THREE.Scene();
		this.scenePointCloud = new THREE.Scene();
		this.volumes = [];
		this.camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
		this.camera.position.set(5, -25, 15);
		this.camera.lookAt(new THREE.Vector3(5, 5, 0));
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld();
	}

	addPointCloud(pointcloud) {
		this.pointclouds.push(pointcloud);
		this.dispatchEvent({ type: "pointcloud_added", pointcloud });
	}

	getActiveCamera() {
		return this.camera;
	}
}

class MockViewer extends EventDispatcher {
	constructor(scene = new MockScene(), edlSupported = true, sourceKind = "single") {
		super();

		this.scene = scene;
		this.treemindPointCloudSourceMode = { sourceKind };
		this.scene.treemindPointCloudSourceMode = { sourceKind };
		this.controls = { enabled: true };
		this.measuringTool = { eventMeasurement: null };
		this.renderArea = document.createElement("div");
		// 补齐离屏合成链需要的渲染接口，避免测试环境依赖真实 WebGL。
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: vi.fn((target) => target.set(800, 600)),
			getRenderTarget: vi.fn(() => null),
			setRenderTarget: vi.fn(),
			clear: vi.fn(),
			render: vi.fn(),
		};
		// point cloud 渲染单独走 pRenderer，这里只校验调用参数。
		this.pRenderer = {
			render: vi.fn(),
		};
		this.isEDLSupported = vi.fn(() => edlSupported);

		Object.defineProperty(this.renderer.domElement, "clientWidth", { value: 800 });
		Object.defineProperty(this.renderer.domElement, "clientHeight", { value: 600 });
		this.renderer.domElement.getBoundingClientRect = vi.fn(() => ({
			left: 0,
			top: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
		}));

		this.renderArea.appendChild(this.renderer.domElement);
		document.body.appendChild(this.renderArea);
	}
}

function cleanupViewer(viewer) {
	if (viewer?.renderArea?.parentNode) {
		viewer.renderArea.parentNode.removeChild(viewer.renderArea);
	}
}

/** 模拟一次无拖拽的 pointer 点击。 */
function dispatchPointerTap(target, options = {}) {
	const {
		clientX = 100,
		clientY = 100,
		ctrlKey = false,
		metaKey = false,
		pointerId = 1,
	} = options;

	const downInit = {
		bubbles: true,
		button: 0,
		buttons: 1,
		clientX,
		clientY,
		ctrlKey,
		metaKey,
		pointerId,
		pointerType: "mouse",
	};
	const upInit = {
		bubbles: true,
		button: 0,
		buttons: 0,
		clientX,
		clientY,
		ctrlKey,
		metaKey,
		pointerId,
		pointerType: "mouse",
	};

	target.dispatchEvent(new PointerEvent("pointerdown", downInit));
	document.dispatchEvent(new PointerEvent("pointerup", upInit));
}

function expectEffectState(pointcloud, { edlEnabled, xrayEnabled }) {
	expect(pointcloud.userData.edlEnabled).toBe(edlEnabled);
	expect(pointcloud.userData.xrayEnabled).toBe(xrayEnabled);
}

describe("TreeTagTool", () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = new MockViewer(new MockScene(), true, "group");
		tool = new TreeTagTool(viewer);
	});

	afterEach(() => {
		tool?.dispose();
		cleanupViewer(viewer);
		vi.restoreAllMocks();
	});

	it("group 模式下为可见点云创建 sprite 标签，并挂到独立 overlay scene", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);
		const tag1 = tool.tags.get(pc1);
		const tag2 = tool.tags.get(pc2);
		expect(tag1).toBeInstanceOf(TreeTag);
		expect(tag2).toBeInstanceOf(TreeTag);
		expect(tool.scene.children).toContain(tag1);
		expect(tool.scene.children).toContain(tag2);
		expect(tag1.domElement).toBeUndefined();
		// 透明背景像素必须被 alpha test 丢弃，避免标签之间按整块矩形互相遮挡。
		expect(tag1.material.alphaTest).toBeGreaterThan(0);

		// 默认无选中时，多个点云都应进入 EDL 高亮态。
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("update 会同步 sprite 的世界位置与基础缩放", () => {
		const pc1 = createMockPointcloud("pc1");
		viewer.scene.addPointCloud(pc1);

		tool.update();

		const tag = tool.tags.get(pc1);
		expect(tag.position.x).toBeCloseTo(5);
		expect(tag.position.y).toBeCloseTo(5);
		expect(tag.position.z).toBeCloseTo(0);
		expect(tag.scale.x).toBeGreaterThan(0);
		expect(tag.visible).toBe(true);
	});

	it("点击 sprite 标签时应将选中点云切为 EDL，未选中点云切为 XRAY", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const tag = tool.tags.get(pc1);
		vi.spyOn(tool, "_pickTag").mockReturnValue(tag);

		dispatchPointerTap(viewer.renderer.domElement, { clientX: 100, clientY: 100 });

		expect(tool.highlightedKeys).toContain("pc1");
		expect(tool.getHighlightedPointclouds()).toContain(pc1);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});

	it("未命中 sprite 时仍会回退到点云拾取逻辑", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		vi.spyOn(tool, "_pickTag").mockReturnValue(null);
		vi.spyOn(Utils, "getMousePointCloudIntersection").mockReturnValue({
			pointcloud: pc2,
			location: new THREE.Vector3(1, 2, 3),
		});

		dispatchPointerTap(viewer.renderer.domElement, { clientX: 200, clientY: 160 });

		expect(tool.highlightedKeys).toEqual(["pc2"]);
		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: true });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("拖拽超过阈值时不应触发选中", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const pickSpy = vi.spyOn(tool, "_pickTag");
		viewer.renderer.domElement.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX: 100,
				clientY: 100,
				pointerId: 1,
				pointerType: "mouse",
			})
		);
		document.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				button: 0,
				buttons: 0,
				clientX: 116,
				clientY: 100,
				pointerId: 1,
				pointerType: "mouse",
			})
		);

		expect(pickSpy).not.toHaveBeenCalled();
		expect(tool.highlightedKeys.length).toBe(0);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("单选时再次点击已选中标签会取消选中并恢复全部 EDL", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const tag = tool.tags.get(pc1);
		vi.spyOn(tool, "_pickTag").mockReturnValue(tag);

		dispatchPointerTap(viewer.renderer.domElement);
		expect(tool.highlightedKeys).toEqual(["pc1"]);

		dispatchPointerTap(viewer.renderer.domElement);
		expect(tool.highlightedKeys).toEqual([]);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("Ctrl+点击应支持多选切换", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const pickSpy = vi.spyOn(tool, "_pickTag");
		pickSpy.mockReturnValueOnce(tool.tags.get(pc1));
		dispatchPointerTap(viewer.renderer.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys).toEqual(["pc1"]);

		pickSpy.mockReturnValueOnce(tool.tags.get(pc2));
		dispatchPointerTap(viewer.renderer.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys.length).toBe(2);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });

		pickSpy.mockReturnValueOnce(tool.tags.get(pc1));
		dispatchPointerTap(viewer.renderer.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys).toEqual(["pc2"]);
		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: true });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("场景切换后应解绑旧场景并在新场景中重建 sprite 标签", () => {
		const oldScene = viewer.scene;
		const newScene = new MockScene();
		const oldPc1 = createMockPointcloud("old1");
		const oldPc2 = createMockPointcloud("old2");
		const newPc1 = createMockPointcloud("new1");
		const newPc2 = createMockPointcloud("new2");

		oldScene.addPointCloud(oldPc1);
		oldScene.addPointCloud(oldPc2);

		expect(tool.tags.has(oldPc1)).toBe(true);
		expect(tool.tags.has(oldPc2)).toBe(true);

		viewer.scene = newScene;
		viewer.dispatchEvent({
			type: "scene_changed",
			oldScene,
			scene: newScene,
		});

		expect(tool.tags.has(oldPc1)).toBe(false);
		expect(tool.tags.has(oldPc2)).toBe(false);
		expect(tool.scene.children.length).toBe(0);

		newScene.addPointCloud(newPc1);
		newScene.addPointCloud(newPc2);
		expect(tool.tags.has(newPc1)).toBe(true);
		expect(tool.tags.has(newPc2)).toBe(true);
		expect(tool.scene.children).toContain(tool.tags.get(newPc1));
	});

	it("dispose 应清理所有 sprite 标签和监听", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const tag = tool.tags.get(pc1);
		const disposeSpy = vi.spyOn(tag, "dispose");

		tool.dispose();

		expect(disposeSpy).toHaveBeenCalled();
		expect(tool.tags.size).toBe(0);
		expect(tool.scene.children.length).toBe(0);
	});

	it("visibility_changed 后移除不可见点云的 sprite，并清理选择状态", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		tool.setHighlightedPointclouds([pc2]);
		expect(tool.tags.size).toBe(2);

		pc2.visible = false;

		expect(tool.tags.size).toBe(1);
		expect(tool.highlightedKeys).toEqual([]);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("setHighlightedPointclouds 应支持传点云对象和字符串键", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		pc1.userData.key = 101;
		pc2.userData.key = 202;
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		tool.setHighlightedPointclouds([pc1]);
		expect(tool.getHighlightedPointclouds()).toEqual([pc1]);

		tool.setHighlightedPointclouds(["202"]);
		expect(tool.highlightedKeys).toEqual(["202"]);
		expect(tool.getHighlightedPointclouds()).toEqual([pc2]);
	});

	it("内部高亮改变时应派发 tree_tag_highlight_changed 事件", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const handler = vi.fn();
		viewer.scene.addEventListener("tree_tag_highlight_changed", handler);
		vi.spyOn(tool, "_pickTag").mockReturnValue(tool.tags.get(pc1));

		dispatchPointerTap(viewer.renderer.domElement);

		expect(handler).toHaveBeenCalled();
		expect(handler.mock.calls[0][0].highlightedKeys).toContain("pc1");
		expect(handler.mock.calls[0][0].highlightedPointclouds).toContain(pc1);
		expect(handler.mock.calls[0][0].scene).toBe(viewer.scene);
	});

	it("无 EDL 能力时应回退到旧的 XRAY 高亮逻辑", () => {
		tool.dispose();
		cleanupViewer(viewer);

		viewer = new MockViewer(new MockScene(), false, "group");
		tool = new TreeTagTool(viewer);

		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		vi.spyOn(tool, "_pickTag").mockReturnValue(tool.tags.get(pc1));
		dispatchPointerTap(viewer.renderer.domElement);

		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});

	it("single 模式下即使存在多个可见点云也不应创建标签", () => {
		tool.dispose();
		cleanupViewer(viewer);

		viewer = new MockViewer(new MockScene(), true, "single");
		tool = new TreeTagTool(viewer);

		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(0);
		expect(tool.scene.children.length).toBe(0);
		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: false });
	});

	it("render.pass.perspective_overlay 阶段会渲染 treeTag overlay scene", () => {
		const pc1 = createMockPointcloud("pc1");
		viewer.scene.addPointCloud(pc1);
		tool.update();

		// 监听最终全屏合成调用，确认不再直接把标签画到主场景之上。
		const screenPassSpy = vi.spyOn(Utils.screenPass, "render");

		viewer.dispatchEvent({ type: "render.pass.perspective_overlay" });

		expect(viewer.pRenderer.render).toHaveBeenCalledWith(
			viewer.scene.scenePointCloud,
			viewer.scene.getActiveCamera(),
			tool.occlusionRenderTarget,
			expect.objectContaining({
				pointclouds: [pc1],
			})
		);
		expect(viewer.renderer.render).toHaveBeenCalledWith(
			tool.scene,
			viewer.scene.getActiveCamera(),
			tool.tagRenderTarget
		);
		expect(screenPassSpy).toHaveBeenCalledWith(
			viewer.renderer,
			tool.compositeMaterial
		);
	});
});
