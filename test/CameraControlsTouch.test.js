import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import CameraControls from "../libs/camera-controls/dist/camera-controls.module.js";

function createPointerEvent(type, {
	clientX,
	clientY,
	pointerId = 1,
	pointerType = "touch",
	buttons = 1,
	movementX = 0,
	movementY = 0,
} = {}) {
	const EventCtor = window.PointerEvent ?? window.MouseEvent;
	const event = new EventCtor(type, {
		bubbles: true,
		cancelable: true,
		clientX,
		clientY,
		buttons,
	});

	Object.defineProperty(event, "pointerId", {value: pointerId});
	Object.defineProperty(event, "pointerType", {value: pointerType});
	Object.defineProperty(event, "movementX", {value: movementX});
	Object.defineProperty(event, "movementY", {value: movementY});

	return event;
}

function createTouchEvent(type, {
	touches = [],
	changedTouches = [],
} = {}) {
	const event = new Event(type, {
		bubbles: true,
		cancelable: true,
	});

	Object.defineProperty(event, "touches", {value: touches});
	Object.defineProperty(event, "changedTouches", {value: changedTouches});

	return event;
}

function createMockScene(camera) {
	return {
		getActiveCamera() {
			return camera;
		},
	};
}

function createDomElement() {
	const domElement = document.createElement("div");
	domElement.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 300,
		height: 200,
		right: 300,
		bottom: 200,
		x: 0,
		y: 0,
	});
	document.body.appendChild(domElement);
	return domElement;
}

describe("CameraControls 触摸状态回收", () => {
	beforeAll(() => {
		// 让测试使用当前 three 实例，避免依赖外部全局状态。
		CameraControls.install({THREE});
		if (!window.PointerEvent) {
			window.PointerEvent = window.MouseEvent;
		}
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("待决单指轻点不应触发控制事件", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const domElement = createDomElement();
		const controlStart = vi.fn();
		const control = vi.fn();
		const controlEnd = vi.fn();

		controls.addEventListener("controlstart", controlStart);
		controls.addEventListener("control", control);
		controls.addEventListener("controlend", controlEnd);
		controls.touchTapThreshold = 8;
		controls.shouldCaptureSingleTouch = () => true;
		controls.connect(domElement);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {clientX: 10, clientY: 10}));
		document.dispatchEvent(createPointerEvent("pointermove", {clientX: 14, clientY: 14, movementX: 4, movementY: 4}));
		document.dispatchEvent(createPointerEvent("pointerup", {clientX: 14, clientY: 14, buttons: 0}));

		expect(controlStart).not.toHaveBeenCalled();
		expect(control).not.toHaveBeenCalled();
		expect(controlEnd).not.toHaveBeenCalled();

		controls.disconnect();
	});

	it("单指拖动超过阈值后应恢复正常控制", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const domElement = createDomElement();
		const controlStart = vi.fn();
		const control = vi.fn();
		const controlEnd = vi.fn();

		controls.addEventListener("controlstart", controlStart);
		controls.addEventListener("control", control);
		controls.addEventListener("controlend", controlEnd);
		controls.touchTapThreshold = 8;
		controls.shouldCaptureSingleTouch = () => true;
		controls.connect(domElement);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {clientX: 10, clientY: 10}));
		document.dispatchEvent(createPointerEvent("pointermove", {clientX: 20, clientY: 20, movementX: 10, movementY: 10}));
		document.dispatchEvent(createPointerEvent("pointermove", {clientX: 28, clientY: 24, movementX: 8, movementY: 4}));
		document.dispatchEvent(createPointerEvent("pointerup", {clientX: 28, clientY: 24, buttons: 0}));

		expect(controlStart).toHaveBeenCalledTimes(1);
		expect(control).toHaveBeenCalled();
		expect(controlEnd).toHaveBeenCalledTimes(1);

		controls.disconnect();
	});

	it("双指缩放后即使漏掉一根手指的 pointerup，也应回退为单指旋转", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const domElement = createDomElement();

		controls.connect(domElement);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 1, clientX: 20, clientY: 20}));
		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 2, clientX: 80, clientY: 80}));

		// 用 touchend 快照模拟 WebView 只告诉页面还剩下一根手指，但漏掉了另一根手指的 pointerup。
		domElement.dispatchEvent(createTouchEvent("touchend", {
			touches: [{clientX: 84, clientY: 84}],
			changedTouches: [{clientX: 20, clientY: 20}],
		}));

		expect(controls._activePointers.length).toBe(1);
		expect(controls._activePointers[0].pointerId).toBe(2);

		document.dispatchEvent(createPointerEvent("pointermove", {
			pointerId: 2,
			clientX: 90,
			clientY: 88,
			movementX: 6,
			movementY: 4,
		}));

		expect(controls._activePointers.length).toBe(1);
		expect(controls._state).toBe(CameraControls.ACTION.TOUCH_ROTATE);

		controls.disconnect();
	});

	it("touchcancel 快照为 0 时应清空残留触点并结束控制", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const domElement = createDomElement();
		const controlEnd = vi.fn();

		controls.addEventListener("controlend", controlEnd);
		controls.connect(domElement);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 1, clientX: 20, clientY: 20}));
		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 2, clientX: 80, clientY: 80}));
		domElement.dispatchEvent(createTouchEvent("touchcancel", {
			touches: [],
			changedTouches: [{clientX: 20, clientY: 20}, {clientX: 80, clientY: 80}],
		}));

		expect(controls._activePointers.length).toBe(0);
		expect(controls._state).toBe(CameraControls.ACTION.NONE);
		expect(controlEnd).toHaveBeenCalled();

		controls.disconnect();
	});

	it("正常浏览器路径下完整的 pointerup 仍应回退为单指旋转", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const domElement = createDomElement();

		controls.connect(domElement);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 1, clientX: 20, clientY: 20}));
		domElement.dispatchEvent(createPointerEvent("pointerdown", {pointerId: 2, clientX: 80, clientY: 80}));
		document.dispatchEvent(createPointerEvent("pointerup", {
			pointerId: 1,
			clientX: 20,
			clientY: 20,
			buttons: 0,
		}));

		expect(controls._activePointers.length).toBe(1);
		expect(controls._activePointers[0].pointerId).toBe(2);

		document.dispatchEvent(createPointerEvent("pointermove", {
			pointerId: 2,
			clientX: 88,
			clientY: 84,
			movementX: 8,
			movementY: 4,
		}));

		expect(controls._state).toBe(CameraControls.ACTION.TOUCH_ROTATE);

		controls.disconnect();
	});

	it("setCamera 切换到正交相机后应刷新默认滚轮和双指语义", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const nextCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
		nextCamera.zoom = 4;

		expect(controls.mouseButtons.wheel).toBe(CameraControls.ACTION.DOLLY);
		expect(controls.touches.two()).toBe(CameraControls.ACTION.TOUCH_DOLLY_TRUCK);

		controls.setCamera(nextCamera);

		expect(controls.camera).toBe(nextCamera);
		expect(controls.mouseButtons.wheel).toBe(CameraControls.ACTION.ZOOM);
		expect(controls.touches.two()).toBe(CameraControls.ACTION.TOUCH_ZOOM_TRUCK);
	});

	it("setCamera 不应覆盖业务层自定义的滚轮和双指语义", () => {
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		const controls = new CameraControls(createMockScene(camera));
		const nextCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);

		controls.mouseButtons.wheel = CameraControls.ACTION.NONE;
		controls.touches.two = () => CameraControls.ACTION.TOUCH_ROTATE;

		controls.setCamera(nextCamera);

		expect(controls.mouseButtons.wheel).toBe(CameraControls.ACTION.NONE);
		expect(controls.touches.two()).toBe(CameraControls.ACTION.TOUCH_ROTATE);
	});
});
