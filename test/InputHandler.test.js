import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {InputHandler} from "../src/navigation/InputHandler.js";

function createMockViewer() {
	const domElement = document.createElement("canvas");
	Object.defineProperty(domElement, "clientWidth", {value: 800});
	Object.defineProperty(domElement, "clientHeight", {value: 600});
	// 模拟带有页面偏移的画布，验证触摸坐标始终转换为同一本地坐标系。
	domElement.getBoundingClientRect = () => ({
		left: 100,
		top: 50,
		width: 800,
		height: 600,
		right: 900,
		bottom: 650,
		x: 100,
		y: 50,
	});
	document.body.appendChild(domElement);

	return {
		renderer: {
			domElement,
		},
		scene: {
			view: {
				clone() {
					return {};
				},
			},
			pointclouds: [],
			scene: new THREE.Scene(),
			getActiveCamera() {
				return new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
			},
		},
	};
}

function createTouchLikeEvent(type, {touches = [], changedTouches = []} = {}) {
	return {
		type,
		touches,
		changedTouches,
		preventDefault: vi.fn(),
	};
}

describe("InputHandler", () => {
	let viewer;
	let inputHandler;

	beforeEach(() => {
		viewer = createMockViewer();
		inputHandler = new InputHandler(viewer);
		inputHandler.setScene(viewer.scene);
	});

	afterEach(() => {
		viewer.renderer.domElement.remove();
	});

	it("应将 touchstart 和 touchend 统一转换为画布本地坐标", () => {
		const startPosition = inputHandler.getEventLocalPosition(createTouchLikeEvent("touchstart", {
			touches: [{clientX: 130, clientY: 90}],
		}));
		const endPosition = inputHandler.getEventLocalPosition(createTouchLikeEvent("touchend", {
			changedTouches: [{clientX: 130, clientY: 90}],
		}));

		expect(startPosition.x).toBe(30);
		expect(startPosition.y).toBe(40);
		expect(endPosition.x).toBe(30);
		expect(endPosition.y).toBe(40);
	});

	it("应按像素阈值区分鼠标点击与触摸轻点", () => {
		expect(inputHandler.isTapGesture("mouse", new THREE.Vector2(0, 0), new THREE.Vector2(2, 0))).toBe(true);
		expect(inputHandler.isTapGesture("mouse", new THREE.Vector2(0, 0), new THREE.Vector2(3, 0))).toBe(false);
		expect(inputHandler.isTapGesture("touch", new THREE.Vector2(0, 0), new THREE.Vector2(8, 0))).toBe(true);
		expect(inputHandler.isTapGesture("touch", new THREE.Vector2(0, 0), new THREE.Vector2(9, 0))).toBe(false);
	});

	it("touchend 时应使用抬手位置刷新鼠标与悬停点", () => {
		const hoveredPoint = {id: "hovered"};
		inputHandler.getMousePointCloudIntersection = vi.fn(() => hoveredPoint);

		inputHandler.onTouchEnd(createTouchLikeEvent("touchend", {
			changedTouches: [{clientX: 160, clientY: 110}],
		}));

		expect(inputHandler.mouse.x).toBe(60);
		expect(inputHandler.mouse.y).toBe(60);
		expect(inputHandler.hoveredPoint).toBe(hoveredPoint);
	});
});
