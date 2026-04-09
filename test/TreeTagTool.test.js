import * as THREE from "../libs/three.js/build/three.module.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TreeTagTool } from "../src/utils/TreeTagTool.js";
import { TreeTag } from "../src/utils/TreeTag.js";
import { EventDispatcher } from "../src/EventDispatcher.js";

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
		this.userData = {};
		this._visible = visible;
	}

	get visible() {
		return this._visible;
	}

	set visible(v) {
		if (this._visible !== v) {
			this._visible = v;
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
		this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
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
		// 测试显式注入来源模式，避免再依赖点云数量推断。
		this.treemindPointCloudSourceMode = { sourceKind };
		this.scene.treemindPointCloudSourceMode = { sourceKind };
		this.renderArea = document.createElement("div");
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: vi.fn((target) => target.set(800, 600)),
		};
		this.isEDLSupported = vi.fn(() => edlSupported);
		this.renderArea.appendChild(this.renderer.domElement);
		document.body.appendChild(this.renderArea);
	}
}

function cleanupViewer(viewer) {
	if (viewer && viewer.renderArea && viewer.renderArea.parentNode) {
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
	target.dispatchEvent(new PointerEvent("pointerup", upInit));
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
		tool.dispose();
		cleanupViewer(viewer);
	});

	it("仅当多个点云可见时才添加标签", () => {
		cleanupViewer(viewer);
		const scene = new MockScene();
		const pc1 = createMockPointcloud("pc1");
		scene.addPointCloud(pc1);
		viewer = new MockViewer(scene, true, "group");
		tool = new TreeTagTool(viewer);

		expect(tool.tags.size).toBe(1);

		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);
		const tag1 = tool.tags.get(pc1);
		const tag2 = tool.tags.get(pc2);
		expect(tag1).toBeInstanceOf(TreeTag);
		expect(tag2).toBeInstanceOf(TreeTag);
		expect(viewer.renderArea.contains(tag1.domElement)).toBe(true);
		expect(viewer.renderArea.contains(tag2.domElement)).toBe(true);

		// 默认无选中时，多个点云都应进入 EDL 高亮态。
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("收到 pointcloud_added 且已存在多个可见点云时应补齐标签且不重复添加", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);
		expect(viewer.renderArea.contains(tool.tags.get(pc1).domElement)).toBe(true);

		viewer.scene.dispatchEvent({ type: "pointcloud_added", pointcloud: pc1 });
		expect(tool.tags.size).toBe(2);
		expect(viewer.renderArea.querySelectorAll("div").length).toBe(2);
	});

	it("点击 tag 时应将选中点云切为 EDL，未选中点云切为 XRAY", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag = tool.tags.get(pc1);
		dispatchPointerTap(tag.domElement, { clientX: 100, clientY: 100 });

		expect(tool.highlightedKeys).toContain("pc1");
		expect(tool.getHighlightedPointclouds()).toContain(pc1);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});

	it("拖拽超过阈值时不应触发选中", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const canvas = viewer.renderer.domElement;
		const pid = 1;
		canvas.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX: 100,
				clientY: 100,
				pointerId: pid,
				pointerType: "mouse",
			})
		);
		canvas.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				button: 0,
				buttons: 0,
				clientX: 116,
				clientY: 100,
				pointerId: pid,
				pointerType: "mouse",
			})
		);

		expect(tool.highlightedKeys.length).toBe(0);
		// 未发生选中变更时，应保持默认“全部 EDL”状态。
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("单选时点击已选中的唯一点云应取消选中并恢复全部 EDL", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag = tool.tags.get(pc1);
		dispatchPointerTap(tag.domElement, { ctrlKey: false });
		expect(tool.highlightedKeys).toContain("pc1");

		dispatchPointerTap(tag.domElement, { ctrlKey: false });
		expect(tool.highlightedKeys.length).toBe(0);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("Ctrl+点击应切换多选", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag1 = tool.tags.get(pc1);
		const tag2 = tool.tags.get(pc2);

		dispatchPointerTap(tag1.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys).toEqual(["pc1"]);

		dispatchPointerTap(tag2.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys.length).toBe(2);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });

		dispatchPointerTap(tag1.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys).toEqual(["pc2"]);
		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: true });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("场景切换后应解除旧场景监听并绑定新场景", () => {
		const oldScene = viewer.scene;
		const newScene = new MockScene();
		const oldPc1 = createMockPointcloud("old1");
		const oldPc2 = createMockPointcloud("old2");
		const newPc1 = createMockPointcloud("new1");
		const newPc2 = createMockPointcloud("new2");
		oldScene.addPointCloud(oldPc1);
		oldScene.addPointCloud(oldPc2);
		tool = new TreeTagTool(viewer);

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

		newScene.addPointCloud(newPc1);
		newScene.addPointCloud(newPc2);
		expect(tool.tags.has(newPc1)).toBe(true);
		expect(tool.tags.has(newPc2)).toBe(true);
		expect(viewer.renderArea.contains(tool.tags.get(newPc1).domElement)).toBe(true);
	});

	it("dispose 应清理所有标签和监听", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		const tag = tool.tags.get(pc1);
		const disposeSpy = vi.spyOn(tag, "dispose");

		tool.dispose();

		expect(disposeSpy).toHaveBeenCalled();
		expect(tool.tags.size).toBe(0);
		expect(viewer.renderArea.contains(tag.domElement)).toBe(false);
	});

	it("visibility_changed 后可见点云数小于 2 时应移除标签并清空效果", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);

		pc2.visible = false;

		expect(tool.tags.size).toBe(1);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: true, xrayEnabled: false });
	});

	it("setHighlightedPointclouds 应支持传点云对象并同步效果", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		tool.setHighlightedPointclouds([pc1]);

		expect(tool.getHighlightedPointclouds()).toContain(pc1);
		expect(tool.getHighlightedPointclouds().length).toBe(1);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});

	it("setHighlightedPointclouds 传字符串数组时应保持字符串语义，不再转数字", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		pc1.userData.key = 101;
		pc2.userData.key = 202;
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		tool.setHighlightedPointclouds(["101"]);

		expect(tool.highlightedKeys).toEqual(["101"]);
		expect(tool.getHighlightedPointclouds()).toEqual([pc1]);
		expectEffectState(pc1, { edlEnabled: true, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});

	it("内部高亮改变时应派发 tree_tag_highlight_changed 事件", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		const handler = vi.fn();
		viewer.scene.addEventListener("tree_tag_highlight_changed", handler);

		dispatchPointerTap(tool.tags.get(pc1).domElement, { ctrlKey: false });

		expect(handler).toHaveBeenCalled();
		expect(handler.mock.calls[0][0].highlightedKeys).toContain("pc1");
		expect(handler.mock.calls[0][0].highlightedPointclouds).toContain(pc1);
		expect(handler.mock.calls[0][0].scene).toBe(viewer.scene);

		viewer.scene.removeEventListener("tree_tag_highlight_changed", handler);
	});

	it("无 EDL 能力时应回退到旧的 XRAY 高亮逻辑", () => {
		cleanupViewer(viewer);
		viewer = new MockViewer(new MockScene(), false, "group");
		tool = new TreeTagTool(viewer);

		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		dispatchPointerTap(tool.tags.get(pc1).domElement, { ctrlKey: false });

		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: true });
	});
	it("single 模式下即使存在多个可见点云也不应创建标签", () => {
		cleanupViewer(viewer);
		viewer = new MockViewer(new MockScene(), true, "single");
		tool = new TreeTagTool(viewer);

		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(0);
		expectEffectState(pc1, { edlEnabled: false, xrayEnabled: false });
		expectEffectState(pc2, { edlEnabled: false, xrayEnabled: false });
	});
});
