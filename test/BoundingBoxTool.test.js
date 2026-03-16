import * as THREE from "../libs/three.js/build/three.module.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BoundingBoxTool } from "../src/utils/BoundingBoxTool.js";
import { BoundingBox } from "../src/utils/BoundingBox.js";
import { EventDispatcher } from "../src/EventDispatcher.js";

// 最小化的场景 mock，只提供 BoundingBoxTool 构造和事件联动所需能力。
class MockScene extends EventDispatcher {
	constructor() {
		super();
		this.boundingBoxes = [];
		this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	}

	addBoundingBox(boundingBox) {
		this.boundingBoxes.push(boundingBox);
		this.dispatchEvent({
			type: "bounding_box_added",
			scene: this,
			boundingBox,
		});
	}

	removeBoundingBox(boundingBox) {
		const index = this.boundingBoxes.indexOf(boundingBox);
		if (index !== -1) {
			this.boundingBoxes.splice(index, 1);
		}

		this.dispatchEvent({
			type: "bounding_box_removed",
			scene: this,
			boundingBox,
		});
	}

	getActiveCamera() {
		return this.camera;
	}
}

// 最小化的 viewer mock，只保留本轮单测会访问到的字段。
class MockViewer extends EventDispatcher {
	constructor(scene = new MockScene()) {
		super();
		this.scene = scene;
		this.renderArea = document.createElement("div");
		document.body.appendChild(this.renderArea);

		this.inputHandler = {
			registerInteractiveScene: vi.fn(),
		};

		this.renderer = {
			getSize: vi.fn((target) => target.set(800, 600)),
			getRenderTarget: vi.fn(() => null),
			setRenderTarget: vi.fn(),
			render: vi.fn(),
		};
	}
}

// 清理测试中挂到 document.body 上的渲染容器，避免用例间污染。
function cleanupViewer(viewer) {
	if (viewer.renderArea.parentNode) {
		viewer.renderArea.parentNode.removeChild(viewer.renderArea);
	}
}

describe("BoundingBoxTool", () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = new MockViewer();
		tool = new BoundingBoxTool(viewer);
	});

	afterEach(() => {
		cleanupViewer(viewer);
	});

	it("构造时应注册交互场景并回填已有包围盒", () => {
		cleanupViewer(viewer);

		const scene = new MockScene();
		const existing = new BoundingBox();
		scene.boundingBoxes.push(existing);
		viewer = new MockViewer(scene);

		tool = new BoundingBoxTool(viewer);

		expect(tool.scene.name).toBe("scene_bounding_box");
		expect(viewer.inputHandler.registerInteractiveScene).toHaveBeenCalledWith(tool.scene);
		expect(tool.scene.children).toContain(existing);
	});

	it("构造时应将已有包围盒的标签挂载到 renderArea", () => {
		cleanupViewer(viewer);

		const scene = new MockScene();
		const existing = new BoundingBox();
		scene.boundingBoxes.push(existing);
		viewer = new MockViewer(scene);

		tool = new BoundingBoxTool(viewer);

		expect(viewer.renderArea.contains(existing.domElement)).toBe(true);
	});

	it("开始插入包围盒时应向 viewer 派发 cancel_insertions 事件", () => {
		const cancelListener = vi.fn();
		viewer.addEventListener("cancel_insertions", cancelListener);

		tool.startInsertion();

		expect(cancelListener).toHaveBeenCalledTimes(1);
	});

	it("startInsertion 应创建带默认名称的包围盒", () => {
		const addSpy = vi.spyOn(viewer.scene, "addBoundingBox");

		const box = tool.startInsertion();

		expect(box).toBeInstanceOf(BoundingBox);
		expect(box.name).toBe("BoundingBox");
		expect(addSpy).toHaveBeenCalledWith(box);
		expect(viewer.scene.boundingBoxes).toContain(box);
		expect(tool.scene.children).toContain(box);
	});

	it("startInsertion 应应用自定义名称和位置", () => {
		const position = new THREE.Vector3(1, 2, 3);

		const box = tool.startInsertion({
			name: "Custom Box",
			position,
		});

		expect(box.name).toBe("Custom Box");
		expect(box.position.toArray()).toEqual([1, 2, 3]);
	});

	it("收到 bounding_box_added 事件时应添加包围盒并且只挂载一次标签", () => {
		const box = new BoundingBox();

		viewer.scene.addBoundingBox(box);
		const childCountAfterFirstAdd = tool.scene.children.filter((child) => child === box).length;

		expect(tool.scene.children).toContain(box);
		expect(viewer.renderArea.contains(box.domElement)).toBe(true);
		expect(childCountAfterFirstAdd).toBe(1);

		// 再次触发添加逻辑时，不应重复插入同一个对象或 DOM 标签。
		tool.onAdd({ boundingBox: box });
		const childCountAfterSecondAdd = tool.scene.children.filter((child) => child === box).length;

		expect(childCountAfterSecondAdd).toBe(1);
		expect(viewer.renderArea.querySelectorAll("div").length).toBe(1);
	});

	it("收到 bounding_box_removed 事件时应移除包围盒并销毁标签", () => {
		const box = tool.startInsertion();
		const disposeSpy = vi.spyOn(box, "dispose");

		expect(viewer.renderArea.contains(box.domElement)).toBe(true);

		viewer.scene.removeBoundingBox(box);

		expect(disposeSpy).toHaveBeenCalledTimes(1);
		expect(tool.scene.children).not.toContain(box);
		expect(viewer.renderArea.contains(box.domElement)).toBe(false);
	});

	it("场景切换后应解除旧场景监听并绑定新场景监听", () => {
		const oldScene = viewer.scene;
		const newScene = new MockScene();
		const oldBox = new BoundingBox({ number: 1 });
		const newBox = new BoundingBox({ number: 2 });

		viewer.dispatchEvent({
			type: "scene_changed",
			oldScene,
			scene: newScene,
		});
		viewer.scene = newScene;

		// 场景切换完成后，旧场景的新增事件不应再影响工具内部状态。
		oldScene.addBoundingBox(oldBox);
		expect(tool.scene.children).not.toContain(oldBox);
		expect(viewer.renderArea.contains(oldBox.domElement)).toBe(false);

		// 新场景的新增与删除事件应继续正常生效。
		newScene.addBoundingBox(newBox);
		expect(tool.scene.children).toContain(newBox);
		expect(viewer.renderArea.contains(newBox.domElement)).toBe(true);

		newScene.removeBoundingBox(newBox);
		expect(tool.scene.children).not.toContain(newBox);
		expect(viewer.renderArea.contains(newBox.domElement)).toBe(false);
	});
});
