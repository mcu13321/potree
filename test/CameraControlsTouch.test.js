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

describe("CameraControls 单指触摸仲裁", () => {
	beforeAll(() => {
		// 让测试中的 camera-controls 绑定当前 three 实例，避免依赖外部全局状态。
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
});
