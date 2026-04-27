import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {FJDCameraControls} from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";

// 测试直接引用 controls core 时，需要先安装当前测试环境使用的 THREE。
FJDCameraControls.install({THREE});

// 创建带 pointerId 和 pointerType 的指针事件，供桌面端与触摸端测试复用。
function createPointerEvent(type, {
	clientX,
	clientY,
	pointerId = 1,
	button = 0,
	buttons = 1,
	pointerType = "mouse",
} = {}) {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX,
		clientY,
		button,
		buttons,
	});

	Object.defineProperty(event, "pointerId", {value: pointerId});
	Object.defineProperty(event, "pointerType", {value: pointerType});
	return event;
}

// 创建滚轮事件。
function createWheelEvent(deltaY) {
	return new WheelEvent("wheel", {
		bubbles: true,
		cancelable: true,
		deltaY,
	});
}

// 创建透视相机测试场景和对应的 DOM 容器。
function createCameraAndDom() {
	const domElement = document.createElement("div");
	document.body.appendChild(domElement);

	domElement.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 800,
		height: 600,
		right: 800,
		bottom: 600,
		x: 0,
		y: 0,
	});

	const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
	camera.position.set(0, -10, 3);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateMatrixWorld(true);

	const scene = {
		getActiveCamera() {
			return camera;
		},
	};

	return {camera, domElement, scene};
}

// 创建正交相机测试场景和对应的 DOM 容器。
function createOrthographicCameraAndDom() {
	const domElement = document.createElement("div");
	document.body.appendChild(domElement);

	domElement.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 800,
		height: 600,
		right: 800,
		bottom: 600,
		x: 0,
		y: 0,
	});

	const camera = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
	camera.zoom = 1;
	camera.position.set(0, -10, 3);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);

	const scene = {
		getActiveCamera() {
			return camera;
		},
	};

	return {camera, domElement, scene};
}

// 按当前相机姿态把世界包围盒投影到相机右轴、上轴和后向轴，用于校验 fitToBox 的框景尺寸。
function computeProjectedBoxSize(box, quaternion) {
	const size = box.getSize(new THREE.Vector3());
	const halfX = size.x * 0.5;
	const halfY = size.y * 0.5;
	const halfZ = size.z * 0.5;
	const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize();
	const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
	const backAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();

	return {
		width: 2 * (
			Math.abs(rightAxis.x) * halfX +
			Math.abs(rightAxis.y) * halfY +
			Math.abs(rightAxis.z) * halfZ
		),
		height: 2 * (
			Math.abs(upAxis.x) * halfX +
			Math.abs(upAxis.y) * halfY +
			Math.abs(upAxis.z) * halfZ
		),
		depth: 2 * (
			Math.abs(backAxis.x) * halfX +
			Math.abs(backAxis.y) * halfY +
			Math.abs(backAxis.z) * halfZ
		),
	};
}

describe("FJDCameraControls", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("左键单击未拖动时应恢复按下前的旋转中心", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(1, 2, 3));
		controls.setOrbitPointResolver(() => new THREE.Vector3(10, 20, 30));

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 100,
			clientY: 120,
		}));
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 100,
			clientY: 120,
			pointerId: 1,
			button: 0,
			buttons: 0,
		}));

		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual([1, 2, 3]);
		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.NONE);
	});

	it("左键拖动时应围绕按下命中的旋转中心做刚体旋转并保持投影稳定", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const orbitPoint = new THREE.Vector3(0, 0, 0);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(1, 2, 3));
		controls.setOrbitPointResolver(() => orbitPoint.clone());

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 180,
		}));

		const ndcAfterPointerDown = orbitPoint.clone().project(camera);

		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 260,
			clientY: 210,
			pointerId: 1,
			button: 0,
			buttons: 1,
		}));

		controls.update(1 / 60);
		const ndcAfterRotate = orbitPoint.clone().project(camera);

		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.ROTATE);
		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual([0, 0, 0]);
		expect(ndcAfterRotate.distanceTo(ndcAfterPointerDown)).toBeLessThan(1e-6);
	});

	it("单指触摸拖动应触发旋转", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const orbitPoint = new THREE.Vector3(0, 0, 0);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(1, 2, 3));
		controls.setOrbitPointResolver(() => orbitPoint.clone());

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 180,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 260,
			clientY: 210,
			pointerId: 1,
			button: 0,
			buttons: 1,
			pointerType: "touch",
		}));

		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.ROTATE);
		expect(camera.position.toArray()).not.toEqual([0, -10, 3]);
	});

	it("右键平移后旋转中心世界坐标应保持不变", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 300,
			clientY: 220,
			button: 2,
			buttons: 2,
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 330,
			clientY: 260,
			pointerId: 1,
			button: 2,
			buttons: 2,
		}));
		controls.update(1 / 60);
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 330,
			clientY: 260,
			pointerId: 1,
			button: 2,
			buttons: 0,
		}));

		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual([0, 0, 0]);
		expect(camera.position.toArray()).not.toEqual([0, -10, 3]);
	});

	it("双指触摸应执行平移与镜头推进的复合操作", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalTarget = controls.getTarget(new THREE.Vector3()).clone();
		const originalPosition = camera.position.clone();

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 200,
			pointerId: 1,
			pointerType: "touch",
		}));
		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 260,
			clientY: 200,
			pointerId: 2,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 190,
			clientY: 210,
			pointerId: 1,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 290,
			clientY: 220,
			pointerId: 2,
			pointerType: "touch",
		}));

		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.TRUCK);
		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual(originalTarget.toArray());
		expect(camera.position.distanceTo(originalPosition)).toBeGreaterThan(0);
	});

	it("滚轮前后移动不应改变旋转中心世界坐标", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalOrbitPoint = controls.getTarget(new THREE.Vector3()).clone();
		const originalPosition = camera.position.clone();

		domElement.dispatchEvent(createWheelEvent(-120));

		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual(originalOrbitPoint.toArray());
		expect(camera.position.distanceTo(originalPosition)).toBeGreaterThan(0);
	});

	it("交互事件顺序应保持 controlstart -> control -> controlend", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.setOrbitPointResolver(() => new THREE.Vector3(0, 0, 0));

		const events = [];
		controls.addEventListener("controlstart", () => events.push("start"));
		controls.addEventListener("control", () => events.push("control"));
		controls.addEventListener("controlend", () => events.push("end"));

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 120,
			clientY: 140,
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 180,
			clientY: 180,
			pointerId: 1,
			button: 0,
			buttons: 1,
		}));
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 180,
			clientY: 180,
			pointerId: 1,
			button: 0,
			buttons: 0,
		}));

		expect(events).toEqual(["start", "control", "end"]);
	});

	it("顶视图适配应把相机放到包围盒上方并保持包围盒投影落入视锥", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const box = new THREE.Box3(
			new THREE.Vector3(-10, -20, 0),
			new THREE.Vector3(10, 20, 30),
		);

		controls.fitToTopViewBox(box, false);

		const target = controls.getTarget(new THREE.Vector3());
		expect(target.toArray()).toEqual([0, 0, 15]);
		expect(camera.position.z).toBeGreaterThan(box.max.z);
		expect(camera.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);

		// 顶视图适配的核心目标是让包围盒所有角点都落入当前视锥范围。
		const corners = [
			new THREE.Vector3(box.min.x, box.min.y, box.min.z),
			new THREE.Vector3(box.min.x, box.min.y, box.max.z),
			new THREE.Vector3(box.min.x, box.max.y, box.min.z),
			new THREE.Vector3(box.min.x, box.max.y, box.max.z),
			new THREE.Vector3(box.max.x, box.min.y, box.min.z),
			new THREE.Vector3(box.max.x, box.min.y, box.max.z),
			new THREE.Vector3(box.max.x, box.max.y, box.min.z),
			new THREE.Vector3(box.max.x, box.max.y, box.max.z),
		];

		for (const corner of corners) {
			const projected = corner.clone().project(camera);
			expect(Math.abs(projected.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(projected.y)).toBeLessThanOrEqual(1);
		}
	});

	it("顶视图动画应逐帧收敛到目标位姿而不是立刻跳到最终位置", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const box = new THREE.Box3(
			new THREE.Vector3(-10, -20, 0),
			new THREE.Vector3(10, 20, 30),
		);

		const startPosition = camera.position.clone();

		controls.fitToTopViewBox(box, true);

		const endPosition = controls.getPosition(new THREE.Vector3(), true).clone();
		expect(controls.getPosition(new THREE.Vector3(), false).distanceTo(startPosition)).toBeLessThan(1e-9);
		expect(camera.position.distanceTo(startPosition)).toBeLessThan(1e-9);
		expect(endPosition.distanceTo(startPosition)).toBeGreaterThan(0);

		controls.update(1 / 60);

		expect(camera.position.distanceTo(startPosition)).toBeGreaterThan(0);
		expect(camera.position.distanceTo(endPosition)).toBeGreaterThan(0);

		for (let i = 0; i < 180; i++) {
			controls.update(1 / 60);
		}

		expect(camera.position.distanceTo(endPosition)).toBeLessThan(1e-3);
		expect(camera.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-3);
	});
	it("双指捏合推进距离应使用放大后的移动端系数", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const orbitDistance = controls.getPosition(new THREE.Vector3()).distanceTo(controls.getTarget(new THREE.Vector3()));
		const expectedDistance = orbitDistance * (60 / 600) * 4;

		expect(controls._computePinchForwardDistance(60)).toBeCloseTo(expectedDistance);
	});

	it("桌面端滚轮缩放步长应使用放大后的 PC 系数", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const orbitDistance = controls.getPosition(new THREE.Vector3()).distanceTo(controls.getTarget(new THREE.Vector3()));
		const wheelEvent = createWheelEvent(-120);
		const expectedStep = Math.max(0.2, orbitDistance * (1 / 5));

		expect(controls._computeWheelStep(wheelEvent)).toBeCloseTo(expectedStep);
	});

	it("正交相机滚轮缩放应调整 zoom 而不是移动相机位置", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalOrbitPoint = controls.getTarget(new THREE.Vector3()).clone();
		const originalPosition = camera.position.clone();
		const originalZoom = camera.zoom;

		domElement.dispatchEvent(createWheelEvent(-120));

		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual(originalOrbitPoint.toArray());
		// 双指事件会按指针逐个到达，过程中允许存在少量复合平移，但缩放应由 zoom 生效。
		expect(camera.zoom).toBeGreaterThan(originalZoom);
	});

	it("正交相机双指缩放应调整 zoom 而不是移动相机位置", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalOrbitPoint = controls.getTarget(new THREE.Vector3()).clone();
		const originalPosition = camera.position.clone();
		const originalZoom = camera.zoom;

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 200,
			pointerId: 1,
			pointerType: "touch",
		}));
		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 260,
			clientY: 200,
			pointerId: 2,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 180,
			clientY: 200,
			pointerId: 1,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 280,
			clientY: 200,
			pointerId: 2,
			pointerType: "touch",
		}));

		expect(controls.getTarget(new THREE.Vector3()).toArray()).toEqual(originalOrbitPoint.toArray());
		// 双指事件会按指针逐个到达，过程中允许存在少量复合平移，但缩放应由 zoom 生效。
		expect(camera.zoom).toBeGreaterThan(originalZoom);
	});

	it("正交相机顶视图动画应同时平滑过渡 zoom", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const box = new THREE.Box3(
			new THREE.Vector3(-10, -20, 0),
			new THREE.Vector3(10, 20, 30),
		);

		const startZoom = camera.zoom;

		controls.fitToTopViewBox(box, true);

		expect(camera.zoom).toBe(startZoom);
		expect(controls._zoomEnd).toBeGreaterThan(startZoom);

		controls.update(1 / 60);

		expect(camera.zoom).toBeGreaterThan(startZoom);
		expect(camera.zoom).toBeLessThan(controls._zoomEnd);

		for (let i = 0; i < 180; i++) {
			controls.update(1 / 60);
		}

		expect(camera.zoom).toBeCloseTo(controls._zoomEnd, 3);
	});

	it("getSpherical 应返回与当前位置和旋转中心一致的球坐标", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const spherical = controls.getSpherical(new THREE.Spherical(), true);
		const expectedDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(controls.getTarget(new THREE.Vector3(), true));

		expect(spherical.radius).toBeCloseTo(expectedDistance);
		expect(controls.distance).toBeCloseTo(expectedDistance);
		expect(controls.azimuthAngle).toBeCloseTo(spherical.theta);
		expect(controls.polarAngle).toBeCloseTo(spherical.phi);
	});

	it("rotateTo 应采用绝对语义，多次传入相同角度不应继续累积旋转", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		controls.rotateTo(Math.PI / 6, Math.PI / 3, false);
		const positionAfterFirstRotate = controls.getPosition(new THREE.Vector3(), true).clone();
		const sphericalAfterFirstRotate = controls.getSpherical(new THREE.Spherical(), true).clone();

		controls.rotateTo(Math.PI / 6, Math.PI / 3, false);
		const positionAfterSecondRotate = controls.getPosition(new THREE.Vector3(), true).clone();
		const sphericalAfterSecondRotate = controls.getSpherical(new THREE.Spherical(), true).clone();

		expect(positionAfterSecondRotate.distanceTo(positionAfterFirstRotate)).toBeLessThan(1e-9);
		expect(sphericalAfterSecondRotate.theta).toBeCloseTo(sphericalAfterFirstRotate.theta);
		expect(sphericalAfterSecondRotate.phi).toBeCloseTo(sphericalAfterFirstRotate.phi);
	});

	it("rotateAzimuthTo 与 rotatePolarTo 应只修改各自负责的角度", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const initialSpherical = controls.getSpherical(new THREE.Spherical(), true).clone();

		controls.rotateAzimuthTo(Math.PI / 4, false);
		const sphericalAfterAzimuth = controls.getSpherical(new THREE.Spherical(), true).clone();
		expect(sphericalAfterAzimuth.theta).toBeCloseTo(Math.PI / 4);
		expect(sphericalAfterAzimuth.phi).toBeCloseTo(initialSpherical.phi);

		controls.rotatePolarTo(Math.PI / 2.5, false);
		const sphericalAfterPolar = controls.getSpherical(new THREE.Spherical(), true).clone();
		expect(sphericalAfterPolar.theta).toBeCloseTo(Math.PI / 4);
		expect(sphericalAfterPolar.phi).toBeCloseTo(Math.PI / 2.5);
	});

	it("setTarget 应与 moveTo 保持一致并在平移旋转中心时保留相对位姿", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(controls.getTarget(new THREE.Vector3(), true));

		controls.setTarget(5, 6, 7, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(nextTarget);

		expect(nextTarget.toArray()).toEqual([5, 6, 7]);
		expect(nextOffset.distanceTo(originalOffset)).toBeLessThan(1e-9);
	});

	it("透视相机 dollyTo 应只修改旋转中心距离而不改变旋转中心", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();

		controls.dollyTo(5, false);

		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual(originalTarget.toArray());
		expect(controls.getSpherical(new THREE.Spherical(), true).radius).toBeCloseTo(5);
	});

	it("正交相机 zoomTo 应只调整 zoom，不应移动相机位置和旋转中心", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();
		const originalPosition = controls.getPosition(new THREE.Vector3(), true).clone();

		controls.zoomTo(3, false);

		expect(camera.zoom).toBeCloseTo(3);
		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual(originalTarget.toArray());
		expect(controls.getPosition(new THREE.Vector3(), true).distanceTo(originalPosition)).toBeLessThan(1e-9);
	});

	it("开启单指捕获兼容后轻触范围内的单指滑动不应触发现有控制链路", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const controlStart = vi.fn();
		const control = vi.fn();
		const controlEnd = vi.fn();

		// 显式开启阶段二兼容逻辑后，单指轻触范围内的移动应继续让位给上层点击语义。
		controls.touchTapThreshold = 8;
		controls.shouldCaptureSingleTouch = () => true;
		controls.addEventListener("controlstart", controlStart);
		controls.addEventListener("control", control);
		controls.addEventListener("controlend", controlEnd);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 180,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 204,
			clientY: 184,
			pointerId: 1,
			button: 0,
			buttons: 1,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 204,
			clientY: 184,
			pointerId: 1,
			button: 0,
			buttons: 0,
			pointerType: "touch",
		}));

		expect(controlStart).not.toHaveBeenCalled();
		expect(control).not.toHaveBeenCalled();
		expect(controlEnd).not.toHaveBeenCalled();
		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.NONE);
	});

	it("开启单指捕获兼容后，超过阈值应恢复现有单指旋转流程", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const controlStart = vi.fn();
		const control = vi.fn();
		const controlEnd = vi.fn();

		controls.touchTapThreshold = 8;
		controls.shouldCaptureSingleTouch = () => true;
		controls.addEventListener("controlstart", controlStart);
		controls.addEventListener("control", control);
		controls.addEventListener("controlend", controlEnd);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 200,
			clientY: 180,
			pointerType: "touch",
		}));
		// 第一次 move 仅用于解除单指捕获，不应直接产生旋转跳变。
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 212,
			clientY: 192,
			pointerId: 1,
			button: 0,
			buttons: 1,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 224,
			clientY: 198,
			pointerId: 1,
			button: 0,
			buttons: 1,
			pointerType: "touch",
		}));
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 224,
			clientY: 198,
			pointerId: 1,
			button: 0,
			buttons: 0,
			pointerType: "touch",
		}));

		expect(controlStart).toHaveBeenCalledTimes(1);
		expect(control).toHaveBeenCalled();
		expect(controlEnd).toHaveBeenCalledTimes(1);
		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.NONE);
		// 这里验证的是控制链路恢复，而不是具体旋转量，避免把不同相机初值或极小位姿变化误判为回归。
		expect(controls._pendingSingleTouchCapture).toBe(false);
	});

	it("过渡动画应按 camera-controls 兼容层补发 transitionstart、wake、rest、sleep", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const events = [];

		for (const type of ["transitionstart", "wake", "rest", "sleep"]) {
			// 用数组记录事件顺序，验证阶段二新增事件不会打乱现有过渡结果。
			controls.addEventListener(type, () => events.push(type));
		}

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.zoomTo(2, true);

		for (let i = 0; i < 240; i++) {
			controls.update(1 / 60);
		}
		// 再推进一帧空更新，确保 sleep 有机会在停止后的下一帧补发。
		controls.update(1 / 60);

		expect(events[0]).toBe("transitionstart");
		expect(events).toContain("wake");
		expect(events).toContain("rest");
		expect(events).toContain("sleep");
		expect(events.indexOf("transitionstart")).toBeLessThan(events.indexOf("wake"));
		expect(events.indexOf("wake")).toBeLessThan(events.indexOf("rest"));
		expect(events.indexOf("rest")).toBeLessThan(events.indexOf("sleep"));
	});

	it("即时生效路径不应补发 transitionstart", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const transitionStart = vi.fn();

		// 非补间路径仍保持现有 FJD 语义，只同步位姿，不引入新的动画开始事件。
		controls.addEventListener("transitionstart", transitionStart);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.setTarget(5, 6, 7, false);

		expect(transitionStart).not.toHaveBeenCalled();
	});

	it("透视相机 fitToSphere 应保持当前视向并把球体纳入视锥", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const targetSphere = new THREE.Sphere(new THREE.Vector3(5, 6, 7), 2);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalViewDirection = controls
			.getTarget(new THREE.Vector3(), true)
			.sub(controls.getPosition(new THREE.Vector3(), true))
			.normalize();

		controls.fitToSphere(targetSphere, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextPosition = controls.getPosition(new THREE.Vector3(), true);
		const nextViewDirection = nextTarget.clone().sub(nextPosition).normalize();
		const expectedDistance = Math.sqrt(3) * targetSphere.radius;

		expect(nextTarget.distanceTo(targetSphere.center)).toBeLessThan(1e-9);
		expect(nextPosition.distanceTo(nextTarget)).toBeCloseTo(expectedDistance);
		expect(nextViewDirection.distanceTo(originalViewDirection)).toBeLessThan(1e-9);
	});

	it("正交相机 fitToSphere 应保持相对位姿并通过 zoom 完成框景", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const targetSphere = new THREE.Sphere(new THREE.Vector3(-4, 8, 3), 5);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(controls.getTarget(new THREE.Vector3(), true));
		const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
		const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
		const projectedWidth = 2 * targetSphere.radius * (
			Math.abs(rightAxis.x) +
			Math.abs(rightAxis.y) +
			Math.abs(rightAxis.z)
		);
		const projectedHeight = 2 * targetSphere.radius * (
			Math.abs(upAxis.x) +
			Math.abs(upAxis.y) +
			Math.abs(upAxis.z)
		);
		const expectedZoom = Math.min(
			(camera.right - camera.left) / projectedWidth,
			(camera.top - camera.bottom) / projectedHeight,
		);

		controls.fitToSphere(targetSphere, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(nextTarget);

		expect(nextTarget.distanceTo(targetSphere.center)).toBeLessThan(1e-9);
		expect(nextOffset.distanceTo(originalOffset)).toBeLessThan(1e-9);
		expect(camera.zoom).toBeCloseTo(expectedZoom);
	});

	it("fitToSphere 应支持直接传入 Object3D 并按其世界包围球对齐", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 4, 6),
			new THREE.MeshBasicMaterial(),
		);

		mesh.position.set(10, -3, 8);
		mesh.updateMatrixWorld(true);
		const expectedSphere = new THREE.Box3()
			.expandByObject(mesh)
			.getBoundingSphere(new THREE.Sphere());

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(mesh, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(nextTarget);
		const expectedDiagonalHalf = new THREE.Box3()
			.expandByObject(mesh)
			.getSize(new THREE.Vector3())
			.length() * 0.5;

		expect(nextTarget.distanceTo(expectedSphere.center)).toBeLessThan(1e-9);
		expect(nextDistance).toBeCloseTo(expectedDiagonalHalf);
	});

	it("fitToSphere 在注入参考包围盒后应让普通 Object3D 沿用场景尺度计算透视距离", () => {
		const {camera, domElement} = createCameraAndDom();
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-100, -60, -20),
			new THREE.Vector3(140, 80, 40),
		);
		const controls = new FJDCameraControls(camera, domElement, {
			// 所有目标统一沿用宿主场景尺度，避免只有测量对象才应用参考包围盒语义。
			fitReferenceBoundsResolver() {
				return sceneBounds.clone();
			},
		});
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 4, 6),
			new THREE.MeshBasicMaterial(),
		);

		mesh.position.set(10, -3, 8);
		mesh.updateMatrixWorld(true);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(mesh, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(nextTarget);
		const expectedTarget = new THREE.Box3()
			.expandByObject(mesh)
			.getCenter(new THREE.Vector3());
		const expectedDistance = sceneBounds.getSize(new THREE.Vector3()).length() * 0.5;

		expect(nextTarget.distanceTo(expectedTarget)).toBeLessThan(1e-9);
		expect(nextDistance).toBeCloseTo(expectedDistance);
	});

	it("线测量 fitToSphere 应优先按测量点包围盒对齐而不是辅助子对象包围盒", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const measurement = new THREE.Object3D();
		const helperMesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 2, 2),
			new THREE.MeshBasicMaterial(),
		);

		measurement.points = [
			{position: new THREE.Vector3(2, 4, 6)},
			{position: new THREE.Vector3(12, 4, 6)},
		];
		// 模拟测量对象树里偏离线中心的辅助几何，旧逻辑会把它错误纳入中心计算。
		helperMesh.position.set(100, 50, -30);
		measurement.add(helperMesh);
		measurement.updateMatrixWorld(true);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(measurement, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(nextTarget);

		expect(nextTarget.toArray()).toEqual([7, 4, 6]);
		expect(nextDistance).toBeCloseTo(5);
	});

	it("线测量 fitToSphere 在注入参考包围盒后应沿用场景尺度计算透视距离", () => {
		const {camera, domElement} = createCameraAndDom();
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-100, -60, -20),
			new THREE.Vector3(140, 80, 40),
		);
		const controls = new FJDCameraControls(camera, domElement, {
			// 测量对象统一沿用宿主场景尺度，避免非退化线目标继续按自身长度贴脸。
			fitReferenceBoundsResolver() {
				return sceneBounds.clone();
			},
		});
		const measurement = {
			points: [
				{position: new THREE.Vector3(2, 4, 6)},
				{position: new THREE.Vector3(12, 4, 6)},
			],
		};

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(measurement, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(nextTarget);
		const expectedDistance = sceneBounds.getSize(new THREE.Vector3()).length() * 0.5;

		expect(nextTarget.toArray()).toEqual([7, 4, 6]);
		expect(nextDistance).toBeCloseTo(expectedDistance);
	});

	it("单点目标 fitToSphere 应回退到整个场景包围盒作为透视距离基准", () => {
		const {camera, domElement} = createCameraAndDom();
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-100, -60, -20),
			new THREE.Vector3(140, 80, 40),
		);
		const scene = {
			getActiveCamera() {
				return camera;
			},
		};
		const controls = new FJDCameraControls(camera, domElement, {
			// 独立模块场景下由宿主显式提供尺度基准，避免依赖 Potree 特有的 scene.getBoundingBox 接口。
			fitReferenceBoundsResolver() {
				return sceneBounds.clone();
			},
		});
		const pointMeasurement = {
			name: "point",
			points: [{position: new THREE.Vector3(5, 6, 7)}],
		};

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(pointMeasurement, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(nextTarget);
		const expectedDistance = sceneBounds.getSize(new THREE.Vector3()).length() * 0.5;

		expect(nextTarget.toArray()).toEqual([5, 6, 7]);
		expect(nextDistance).toBeCloseTo(expectedDistance);
	});

	it("单点目标 fitToSphere 应回退到整个场景包围盒作为正交 zoom 基准", () => {
		const {camera, domElement} = createOrthographicCameraAndDom();
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-30, -50, -10),
			new THREE.Vector3(50, 70, 20),
		);
		const scene = {
			getActiveCamera() {
				return camera;
			},
		};
		const controls = new FJDCameraControls(camera, domElement, {
			// 正交 fit 也走同一套注入式尺度基准，保证 FJD 脱离 Potree 后仍可复用。
			fitReferenceBoundsResolver() {
				return sceneBounds.clone();
			},
		});
		const pointMeasurement = {
			name: "point",
			points: [{position: new THREE.Vector3(1, 2, 3)}],
		};

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(pointMeasurement, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const sceneSize = sceneBounds.getSize(new THREE.Vector3());
		const halfX = sceneSize.x * 0.5;
		const halfY = sceneSize.y * 0.5;
		const halfZ = sceneSize.z * 0.5;
		const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
		const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
		const projectedWidth = 2 * (
			Math.abs(rightAxis.x) * halfX +
			Math.abs(rightAxis.y) * halfY +
			Math.abs(rightAxis.z) * halfZ
		);
		const projectedHeight = 2 * (
			Math.abs(upAxis.x) * halfX +
			Math.abs(upAxis.y) * halfY +
			Math.abs(upAxis.z) * halfZ
		);
		const expectedZoom = Math.min(
			(camera.right - camera.left) / projectedWidth,
			(camera.top - camera.bottom) / projectedHeight,
		);

		expect(nextTarget.toArray()).toEqual([1, 2, 3]);
		expect(camera.zoom).toBeCloseTo(expectedZoom);
	});

	it("setFitReferenceBoundsResolver 应允许宿主在运行时切换退化目标的尺度基准", () => {
		const {camera, domElement} = createCameraAndDom();
		const scene = {
			getActiveCamera() {
				return camera;
			},
		};
		const controls = new FJDCameraControls(camera, domElement);
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-20, -20, -20),
			new THREE.Vector3(20, 20, 20),
		);
		const pointMeasurement = {
			name: "point",
			points: [{position: new THREE.Vector3(2, 3, 4)}],
		};

		controls.setFitReferenceBoundsResolver(() => sceneBounds.clone());
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToSphere(pointMeasurement, false);

		const nextDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(controls.getTarget(new THREE.Vector3(), true));

		expect(nextDistance).toBeCloseTo(sceneBounds.getSize(new THREE.Vector3()).length() * 0.5);
	});

	it("透视相机 fitToBox 应保持当前视向并按包围盒投影视尺寸完成框景", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const targetBox = new THREE.Box3(
			new THREE.Vector3(-6, -4, -2),
			new THREE.Vector3(8, 10, 6),
		);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalViewDirection = controls
			.getTarget(new THREE.Vector3(), true)
			.sub(controls.getPosition(new THREE.Vector3(), true))
			.normalize();
		const projectedSize = computeProjectedBoxSize(
			targetBox,
			controls.camera.quaternion.clone(),
		);
		const expectedDistance = controls.getDistanceToFitBox(
			projectedSize.width,
			projectedSize.height,
			projectedSize.depth,
			false,
		);

		controls.fitToBox(targetBox, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextPosition = controls.getPosition(new THREE.Vector3(), true);
		const nextViewDirection = nextTarget.clone().sub(nextPosition).normalize();

		expect(nextTarget.distanceTo(targetBox.getCenter(new THREE.Vector3()))).toBeLessThan(1e-9);
		expect(nextPosition.distanceTo(nextTarget)).toBeCloseTo(expectedDistance);
		expect(nextViewDirection.distanceTo(originalViewDirection)).toBeLessThan(1e-9);
	});

	it("正交相机 fitToBox 应保持相对位姿并通过 zoom 完成框景", () => {
		const {camera, domElement, scene} = createOrthographicCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const targetBox = new THREE.Box3(
			new THREE.Vector3(-12, -5, -3),
			new THREE.Vector3(6, 15, 9),
		);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(controls.getTarget(new THREE.Vector3(), true));
		const projectedSize = computeProjectedBoxSize(
			targetBox,
			controls.camera.quaternion.clone(),
		);
		const expectedZoom = Math.min(
			(camera.right - camera.left) / projectedSize.width,
			(camera.top - camera.bottom) / projectedSize.height,
		);

		controls.fitToBox(targetBox, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextOffset = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(nextTarget);

		expect(nextTarget.distanceTo(targetBox.getCenter(new THREE.Vector3()))).toBeLessThan(1e-9);
		expect(nextOffset.distanceTo(originalOffset)).toBeLessThan(1e-9);
		expect(camera.zoom).toBeCloseTo(expectedZoom);
	});

	it("fitToBox 应支持直接传入 Object3D 并按其世界包围盒中心对齐", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(4, 6, 8),
			new THREE.MeshBasicMaterial(),
		);

		mesh.position.set(12, -7, 5);
		mesh.rotation.set(0.2, 0.4, 0.1);
		mesh.updateMatrixWorld(true);
		const expectedBox = new THREE.Box3().expandByObject(mesh);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToBox(mesh, false);

		expect(
			controls.getTarget(new THREE.Vector3(), true)
				.distanceTo(expectedBox.getCenter(new THREE.Vector3())),
		).toBeLessThan(1e-9);
	});

	it("退化包围盒 fitToBox 应回退到宿主注入的参考包围盒作为透视视距基准", () => {
		const {camera, domElement} = createCameraAndDom();
		const sceneBounds = new THREE.Box3(
			new THREE.Vector3(-80, -40, -10),
			new THREE.Vector3(100, 60, 30),
		);
		const scene = {
			getActiveCamera() {
				return camera;
			},
		};
		const controls = new FJDCameraControls(camera, domElement, {
			// 独立模块场景下由宿主提供参考包围盒，退化目标只负责给出聚焦中心。
			fitReferenceBoundsResolver() {
				return sceneBounds.clone();
			},
		});
		const point = new THREE.Vector3(4, 5, 6);
		const pointBox = new THREE.Box3(point.clone(), point.clone());
		const projectedSize = computeProjectedBoxSize(
			sceneBounds,
			camera.quaternion.clone(),
		);
		const expectedDistance = controls.getDistanceToFitBox(
			projectedSize.width,
			projectedSize.height,
			projectedSize.depth,
			false,
		);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.fitToBox(pointBox, false);

		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual([4, 5, 6]);
		expect(
			controls.getPosition(new THREE.Vector3(), true)
				.distanceTo(controls.getTarget(new THREE.Vector3(), true)),
		).toBeCloseTo(expectedDistance);
	});

	it("dollyInFixed 应沿当前视线整体平移相机与旋转中心并保持视距不变", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();
		const originalPosition = controls.getPosition(new THREE.Vector3(), true).clone();
		const originalDistance = originalPosition.distanceTo(originalTarget);
		const forward = originalTarget.clone().sub(originalPosition).normalize();

		controls.dollyInFixed(5, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextPosition = controls.getPosition(new THREE.Vector3(), true);
		const expectedDelta = forward.multiplyScalar(5);

		expect(nextTarget.clone().sub(originalTarget).distanceTo(expectedDelta)).toBeLessThan(1e-9);
		expect(nextPosition.clone().sub(originalPosition).distanceTo(expectedDelta)).toBeLessThan(1e-9);
		expect(nextPosition.distanceTo(nextTarget)).toBeCloseTo(originalDistance);
	});

	it("elevate 应沿相机 up 方向整体移动相机与旋转中心", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(1, 2, 3));
		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();
		const originalPosition = controls.getPosition(new THREE.Vector3(), true).clone();
		const up = camera.up.clone().normalize().multiplyScalar(4);

		controls.elevate(4, false);

		expect(
			controls.getTarget(new THREE.Vector3(), true).sub(originalTarget).distanceTo(up),
		).toBeLessThan(1e-9);
		expect(
			controls.getPosition(new THREE.Vector3(), true).sub(originalPosition).distanceTo(up),
		).toBeLessThan(1e-9);
	});

	it("lookInDirectionOf 应保持旋转中心与视距不变，只重建观察方向", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const lookPoint = new THREE.Vector3(10, 20, 30);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();
		const originalDistance = controls
			.getPosition(new THREE.Vector3(), true)
			.distanceTo(originalTarget);

		controls.lookInDirectionOf(lookPoint.x, lookPoint.y, lookPoint.z, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextPosition = controls.getPosition(new THREE.Vector3(), true);
		const expectedViewDirection = lookPoint.clone().sub(originalTarget).normalize();
		const nextViewDirection = nextTarget.clone().sub(nextPosition).normalize();

		expect(nextTarget.distanceTo(originalTarget)).toBeLessThan(1e-9);
		expect(nextPosition.distanceTo(nextTarget)).toBeCloseTo(originalDistance);
		expect(nextViewDirection.distanceTo(expectedViewDirection)).toBeLessThan(1e-9);
	});

	it("toJSON 与 fromJSON 应能往返恢复 FJD 位姿约束与保存状态", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.minDistance = 2;
		controls.maxDistance = 200;
		controls.minAzimuthAngle = -1.5;
		controls.maxAzimuthAngle = 1.5;
		controls.touchTapThreshold = 12;
		controls.setLookAt(12, -8, 6, 3, 4, 5, false);
		controls.saveState();
		controls.moveTo(7, 8, 9, false);
		const snapshot = controls.toJSON();

		controls.moveTo(0, 0, 0, false);
		controls.setPosition(1, 1, 1, false);
		controls.fromJSON(snapshot, false);

		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual([7, 8, 9]);
		expect(controls.getPosition(new THREE.Vector3(), true).toArray()).toEqual([16, -4, 10]);
		expect(controls.minDistance).toBe(2);
		expect(controls.maxDistance).toBe(200);
		expect(controls.minAzimuthAngle).toBeCloseTo(-1.5);
		expect(controls.maxAzimuthAngle).toBeCloseTo(1.5);
		expect(controls.touchTapThreshold).toBe(12);
		expect(controls._orbitPoint0.toArray()).toEqual([3, 4, 5]);
		expect(controls._position0.toArray()).toEqual([12, -8, 6]);
	});

	it("fromJSON 在缺少 quaternion 时应回退到由 position 与 target 重建朝向", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const state = JSON.stringify({
			target: [2, 4, 6],
			position: [12, 4, 6],
			zoom: 1.5,
		});

		controls.fromJSON(state, false);

		const nextTarget = controls.getTarget(new THREE.Vector3(), true);
		const nextPosition = controls.getPosition(new THREE.Vector3(), true);
		const nextViewDirection = nextTarget.clone().sub(nextPosition).normalize();

		expect(nextTarget.toArray()).toEqual([2, 4, 6]);
		expect(nextPosition.toArray()).toEqual([12, 4, 6]);
		expect(nextViewDirection.toArray()).toEqual([-1, 0, 0]);
		expect(controls.camera.zoom).toBeCloseTo(1.5);
	});

	it("active 与 cancel 应反映并终止当前补间动画", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.setTarget(5, 6, 7, true);

		expect(controls.active).toBe(true);

		controls.cancel();

		expect(controls.active).toBe(false);
	});

	it("lerp 应支持 position 状态的线性插值", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const stateA = {
			position: [0, 0, 10],
			target: [0, 0, 0],
		};
		const stateB = {
			position: [10, 0, 10],
			target: [10, 0, 0],
		};

		controls.lerp(stateA, stateB, 0.25, false);

		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual([2.5, 0, 0]);
		expect(controls.getPosition(new THREE.Vector3(), true).toArray()).toEqual([2.5, 0, 10]);
	});

	it("lerp 应支持 spherical 状态并在相同球坐标下保持相对偏移一致", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const stateA = {
			spherical: [10, Math.PI / 2, 0],
			target: [0, 0, 0],
		};
		const stateB = {
			spherical: [10, Math.PI / 2, 0],
			target: [10, 0, 0],
		};

		controls.lerp(stateA, stateA, 0, false);
		const offsetA = controls
			.getPosition(new THREE.Vector3(), true)
			.sub(controls.getTarget(new THREE.Vector3(), true))
			.clone();

		controls.lerp(stateA, stateB, 0.5, false);

		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual([5, 0, 0]);
		expect(
			controls.getPosition(new THREE.Vector3(), true)
				.sub(controls.getTarget(new THREE.Vector3(), true))
				.distanceTo(offsetA),
		).toBeLessThan(1e-9);
	});

	it("lerpLookAt 应按两组 lookAt 状态线性插值", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.lerpLookAt(
			0, 0, 10,
			0, 0, 0,
			10, 10, 20,
			10, 10, 10,
			0.5,
			false,
		);

		expect(controls.getPosition(new THREE.Vector3(), true).toArray()).toEqual([5, 5, 15]);
		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual([5, 5, 5]);
	});

	it("setFocalOffset 与 getFocalOffset 应保留兼容占位值且不影响当前位姿", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(1, 2, 3));
		const originalTarget = controls.getTarget(new THREE.Vector3(), true).clone();
		const originalPosition = controls.getPosition(new THREE.Vector3(), true).clone();

		controls.setFocalOffset(7, 8, 9, false);

		expect(controls.getFocalOffset(new THREE.Vector3(), true).toArray()).toEqual([7, 8, 9]);
		expect(controls.getTarget(new THREE.Vector3(), true).toArray()).toEqual(originalTarget.toArray());
		expect(controls.getPosition(new THREE.Vector3(), true).toArray()).toEqual(originalPosition.toArray());
	});

	it("setBoundary、setViewport、normalizeRotations 与指针锁接口应可安全调用", () => {
		const {camera, domElement, scene} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const boundary = new THREE.Box3(
			new THREE.Vector3(-1, -2, -3),
			new THREE.Vector3(4, 5, 6),
		);
		const viewport = new THREE.Vector4(1, 2, 3, 4);

		controls.setBoundary(boundary);
		controls.setViewport(viewport);

		expect(controls.normalizeRotations()).toBe(controls);
		expect(controls._boundary.equals(boundary)).toBe(true);
		expect(controls._viewport.toArray()).toEqual([1, 2, 3, 4]);

		controls.lockPointer();
		controls.unlockPointer();
		controls.updateCameraUp();
		controls.applyCameraUp();
	});
	it("setCamera 应允许核心层直接切换 three.js 相机", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const nextCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
		nextCamera.position.set(3, -4, 5);
		nextCamera.lookAt(new THREE.Vector3(0, 0, 0));
		nextCamera.zoom = 2;
		nextCamera.updateProjectionMatrix();
		nextCamera.updateMatrixWorld(true);

		controls.setCamera(nextCamera);

		expect(controls.camera).toBe(nextCamera);
		expect(controls.getPosition(new THREE.Vector3(), true).toArray()).toEqual([3, -4, 5]);
		expect(controls.camera.zoom).toBeCloseTo(2);
	});

	it("应暴露宿主分发所需的能力元信息", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		expect(controls.isDomDrivenControls).toBe(true);
		expect(controls.drivesCameraDirectly).toBe(true);
		expect(controls.supportsSetCamera).toBe(true);
		expect(controls.usesRigidTopViewFit).toBe(true);
		expect(controls.sceneControls?.isScene).toBe(true);
	});

	it("应暴露独立模块与宿主包装层依赖的最小稳定接口", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);

		expect(typeof FJDCameraControls.install).toBe("function");
		expect(typeof controls.connect).toBe("function");
		expect(typeof controls.disconnect).toBe("function");
		expect(typeof controls.dispose).toBe("function");
		expect(typeof controls.update).toBe("function");
		expect(typeof controls.setCamera).toBe("function");
		expect(typeof controls.setOrbitPointResolver).toBe("function");
		expect(typeof controls.setFitReferenceBoundsResolver).toBe("function");
		expect(typeof controls.getTarget).toBe("function");
		expect(typeof controls.getPosition).toBe("function");
		expect(typeof controls.getSpherical).toBe("function");
		expect(typeof controls.moveTo).toBe("function");
		expect(typeof controls.rotateTo).toBe("function");
		expect(typeof controls.dollyTo).toBe("function");
	});

	it("enabled 为 false 时不应接管任何输入事件", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const controlStart = vi.fn();
		const control = vi.fn();
		const controlEnd = vi.fn();

		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));
		controls.enabled = false;
		controls.addEventListener("controlstart", controlStart);
		controls.addEventListener("control", control);
		controls.addEventListener("controlend", controlEnd);

		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 120,
			clientY: 140,
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 180,
			clientY: 200,
			pointerId: 1,
			button: 0,
			buttons: 1,
		}));
		document.dispatchEvent(createWheelEvent(-120));
		document.dispatchEvent(createPointerEvent("pointerup", {
			clientX: 180,
			clientY: 200,
			pointerId: 1,
			button: 0,
			buttons: 0,
		}));

		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.NONE);
		expect(controlStart).not.toHaveBeenCalled();
		expect(control).not.toHaveBeenCalled();
		expect(controlEnd).not.toHaveBeenCalled();
	});

	it("connect 与 disconnect 应正确维护 DOM 绑定和 touchAction", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera);

		// 模拟宿主已有 touchAction，验证 controls 解绑后会恢复原值。
		domElement.style.touchAction = "pan-x";
		controls.connect(domElement);
		expect(domElement.style.touchAction).toBe("none");

		controls.disconnect();
		expect(domElement.style.touchAction).toBe("pan-x");

		// 断开后旧 DOM 不应再触发控制链路。
		const controlStart = vi.fn();
		controls.addEventListener("controlstart", controlStart);
		domElement.dispatchEvent(createPointerEvent("pointerdown", {
			clientX: 100,
			clientY: 120,
		}));
		document.dispatchEvent(createPointerEvent("pointermove", {
			clientX: 180,
			clientY: 200,
			pointerId: 1,
			button: 0,
			buttons: 1,
		}));

		expect(controlStart).not.toHaveBeenCalled();
	});

	it("dispose 后应释放 DOM 事件绑定且不再响应后续输入", () => {
		const {camera, domElement} = createCameraAndDom();
		const controls = new FJDCameraControls(camera, domElement);
		const originalPosition = camera.position.clone();

		controls.dispose();
		domElement.dispatchEvent(createWheelEvent(-120));

		expect(domElement.style.touchAction).toBe("");
		expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-9);
		expect(controls.currentAction).toBe(FJDCameraControls.ACTION.NONE);
	});
});

