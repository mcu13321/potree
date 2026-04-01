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
	constructor(scene = new MockScene()) {
		super();
		this.scene = scene;
		this.renderArea = document.createElement("div");
		this.renderer = {
			domElement: document.createElement("canvas"),
			getSize: vi.fn((target) => target.set(800, 600)),
		};
		this.renderArea.appendChild(this.renderer.domElement);
		document.body.appendChild(this.renderArea);
	}
}

function cleanupViewer(viewer) {
	if (viewer && viewer.renderArea && viewer.renderArea.parentNode) {
		viewer.renderArea.parentNode.removeChild(viewer.renderArea);
	}
}

/** 模拟一次无拖拽的 pointer 点击（pointerdown 于 target，pointerup 同目标并冒泡至 document） */
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

describe("TreeTagTool", () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = new MockViewer();
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
		viewer = new MockViewer(scene);
		tool = new TreeTagTool(viewer);

		expect(tool.tags.size).toBe(0);

		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);
		const tag1 = tool.tags.get(pc1);
		const tag2 = tool.tags.get(pc2);
		expect(tag1).toBeInstanceOf(TreeTag);
		expect(tag2).toBeInstanceOf(TreeTag);
		expect(viewer.renderArea.contains(tag1.domElement)).toBe(true);
		expect(viewer.renderArea.contains(tag2.domElement)).toBe(true);

		tool.dispose();
		cleanupViewer(viewer);
	});

	it("收到 pointcloud_added 且已有多个可见点云时应添加标签且不重复", () => {
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

	it("点击 tag 时应更新选择状态", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag = tool.tags.get(pc1);
		dispatchPointerTap(tag.domElement, { clientX: 100, clientY: 100 });

		expect(pc1.userData.xrayEnabled).toBe(false);
		expect(tool.highlightedKeys).toContain("pc1");
		expect(tool.getHighlightedPointclouds()).toContain(pc1);
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
	});

	it("单选时点击已选中的唯一点云应取消选中", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag = tool.tags.get(pc1);
		dispatchPointerTap(tag.domElement, { ctrlKey: false });
		expect(tool.highlightedKeys).toContain("pc1");

		dispatchPointerTap(tag.domElement, { ctrlKey: false });
		expect(tool.highlightedKeys).not.toContain("pc1");
		expect(tool.highlightedKeys.length).toBe(0);
		expect(pc1.userData.xrayEnabled).toBe(false);
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
		expect(tool.highlightedKeys.length).toBe(1);
		expect(tool.highlightedKeys).toContain("pc1");

		dispatchPointerTap(tag2.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys.length).toBe(2);

		dispatchPointerTap(tag1.domElement, { ctrlKey: true });
		expect(tool.highlightedKeys.length).toBe(1);
		expect(tool.highlightedKeys).toContain("pc2");
	});

	it("有选中时未选中的点云 xrayEnabled 应为 true", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);
		tool.update();

		const tag1 = tool.tags.get(pc1);
		dispatchPointerTap(tag1.domElement, { ctrlKey: false });

		expect(pc1.userData.xrayEnabled).toBe(false);
		expect(pc2.userData.xrayEnabled).toBe(true);
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

		// 模拟 viewer.setScene：先更新 scene 再派发事件
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
		expect(viewer.renderArea.contains(tool.tags.get(newPc1).domElement)).toBe(
			true
		);
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

	it("visibility_changed 时可见点云数小于2应移除所有标签", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		expect(tool.tags.size).toBe(2);

		pc2.visible = false;

		expect(tool.tags.size).toBe(0);
	});

	it("setHighlightedPointclouds 应更新高亮状态并同步到 userData", () => {
		const pc1 = createMockPointcloud("pc1");
		const pc2 = createMockPointcloud("pc2");
		viewer.scene.addPointCloud(pc1);
		viewer.scene.addPointCloud(pc2);

		tool.setHighlightedPointclouds([pc1]);

		expect(tool.getHighlightedPointclouds()).toContain(pc1);
		expect(tool.getHighlightedPointclouds().length).toBe(1);
		expect(pc1.userData.xrayEnabled).toBe(false);
		expect(pc2.userData.xrayEnabled).toBe(true);
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
});
