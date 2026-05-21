import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {FJDCameraControls} from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";
import {FJDPotreeControlsAdapter} from "../src/viewer/FJDPotreeControlsAdapter.js";
import {Utils} from "../src/utils.js";

// adapter 测试里会直接创建 FJD controls，因此同样先安装 THREE。
FJDCameraControls.install({THREE});

class MockControls {
	// 创建一个最小的旧 controls 模拟对象，供 adapter 切换前后回退时复用。
	constructor(target = new THREE.Vector3(1, 2, 3)) {
		this.enabled = true;
		this.target = target.clone();
		this.connect = vi.fn();
		this.disconnect = vi.fn();
	}

	// 返回当前模拟 controls 的目标点。
	getTarget(out) {
		return out.copy(this.target);
	}
}

// 创建 adapter 测试所需的最小 viewer 模拟对象。
function createViewer() {
	const viewer = new EventDispatcher();
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	camera.position.set(0, -10, 3);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateMatrixWorld(true);

	const renderArea = document.createElement("div");
	const canvas = document.createElement("canvas");
	document.body.appendChild(renderArea);
	renderArea.appendChild(canvas);

	canvas.getBoundingClientRect = () => ({
		left: 10,
		top: 20,
		width: 800,
		height: 600,
		right: 810,
		bottom: 620,
		x: 10,
		y: 20,
	});

	const renderer = {
		domElement: canvas,
		getSize(out) {
			return out.set(800, 600);
		},
		getRenderTarget: vi.fn(() => null),
		setRenderTarget: vi.fn(),
		clear: vi.fn(),
		render: vi.fn(),
	};

	const scene = {
		scene: new THREE.Scene(),
		scenePointCloud: new THREE.Scene(),
		volumes: [],
		getActiveCamera() {
			return camera;
		},
		pointclouds: [],
		view: {
			getPivot() {
				return new THREE.Vector3(9, 8, 7);
			},
		},
	};

	viewer.scene = scene;
	viewer.getBoundingBox = vi.fn((pointclouds) => {
		void pointclouds;
		return new THREE.Box3(
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(100, 200, 300),
		);
	});
	viewer.renderArea = renderArea;
	viewer.renderer = renderer;
	viewer.cameraControls = new MockControls(new THREE.Vector3(4, 5, 6));
	viewer.controls = viewer.cameraControls;
	viewer.inputHandler = {
		addInputListener: vi.fn(),
		removeInputListener: vi.fn(),
	};
	viewer.pRenderer = {
		render: vi.fn(),
	};
	viewer.edlRenderer = {name: "edlRenderer"};
	viewer.getPRenderer = vi.fn(() => null);
	viewer.hasVisibleEDLEffectPointclouds = vi.fn(() => false);
	viewer.setControls = vi.fn((controls) => {
		// 切换前的 controls，用于驱动通用宿主生命周期钩子。
		const previousControls = viewer.controls;
		if (
			controls !== previousControls &&
			typeof controls?.onHostControlsWillActivate === "function"
		) {
			controls.onHostControlsWillActivate(viewer, previousControls);
		}

		viewer.controls = controls;
		if (
			controls === viewer.cameraControls ||
			controls?.isDomDrivenControls === true ||
			controls?.constructor?.name === "FJDCameraControls"
		) {
			controls.enabled = true;
		}

		if (
			controls !== previousControls &&
			typeof previousControls?.onHostControlsDidDeactivate === "function"
		) {
			previousControls.onHostControlsDidDeactivate(viewer, controls);
		}
	});

	return {viewer, camera, renderer};
}

describe("FJDPotreeControlsAdapter", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("应把 controls 实例注册到 viewer，并通过 viewer.setControls 切换到 fjd controls", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		expect(adapter).toBeInstanceOf(FJDPotreeControlsAdapter);
		expect(viewer.fjdPotreeControlsAdapter).toBe(adapter);
		expect(viewer.fjdCameraControls).toBe(adapter.controls);
		expect(viewer.FJDCameraControls).toBeUndefined();
		expect(viewer.setFJDCameraControlsEnabled).toBeUndefined();
		expect(viewer.isFJDCameraControlsEnabled).toBeUndefined();

		viewer.setControls(viewer.fjdCameraControls);

		expect(adapter.isEnabled()).toBe(true);
		expect(viewer.controls).toBe(adapter.controls);
		expect(viewer.setControls).toHaveBeenCalledWith(adapter.controls);
	});

	it("应支持通过 viewer.setControls(viewer.fjdCameraControls) 直接启用", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		viewer.setControls(viewer.fjdCameraControls);

		expect(viewer.controls).toBe(viewer.fjdCameraControls);
		expect(adapter.isEnabled()).toBe(true);
		expect(adapter.previousControls).toBe(viewer.cameraControls);
	});

	it("应支持仅通过 setControls 在 fjd controls 与旧 controls 之间切换", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		viewer.setControls(viewer.fjdCameraControls);
		expect(adapter.isEnabled()).toBe(true);

		viewer.setControls(viewer.cameraControls);
		expect(adapter.isEnabled()).toBe(false);
		expect(viewer.controls).toBe(viewer.cameraControls);
	});

	it("关闭后应恢复之前的 controls", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		adapter.setEnabled(true);
		adapter.setEnabled(false);

		expect(adapter.isEnabled()).toBe(false);
		expect(viewer.controls).toBe(viewer.cameraControls);
		expect(viewer.setControls).toHaveBeenLastCalledWith(viewer.cameraControls);
	});

	it("当外部把 controls 切回旧控件时，isEnabled 应反映真实激活状态，并允许重新启用", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		adapter.setEnabled(true);
		expect(adapter.isEnabled()).toBe(true);

		viewer.controls = viewer.cameraControls;
		expect(adapter.isEnabled()).toBe(false);

		viewer.setControls(viewer.fjdCameraControls);
		expect(viewer.controls).toBe(adapter.controls);
		expect(adapter.isEnabled()).toBe(true);
	});

	it("resolver 应把屏幕坐标转换后转发给点云拾取工具", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		const pickSpy = vi.spyOn(Utils, "getMousePointCloudIntersection").mockReturnValue({
			location: new THREE.Vector3(7, 8, 9),
		});

		const result = adapter.resolveOrbitPoint(110, 220);

		expect(pickSpy).toHaveBeenCalledWith(
			{x: 100, y: 200},
			viewer.scene.getActiveCamera(),
			viewer,
			viewer.scene.pointclouds,
			{pickClipped: true},
		);
		expect(result?.toArray()).toEqual([7, 8, 9]);
	});

	it("scene_changed 后应把新 scene 的活动相机同步给 fjd controls，并重新挂载普通 helper", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		// 构造一台新的活动相机，验证 adapter 会在场景切换后把相机同步进 controls core。
		const nextCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
		nextCamera.position.set(10, 20, 30);
		nextCamera.lookAt(new THREE.Vector3(0, 0, 0));
		nextCamera.updateMatrixWorld(true);
		const nextScene = {
			scene: new THREE.Scene(),
			scenePointCloud: new THREE.Scene(),
			volumes: [],
			getActiveCamera() {
				return nextCamera;
			},
			pointclouds: [],
			view: {
				getPivot() {
					return new THREE.Vector3(2, 3, 4);
				},
			},
		};

		viewer.scene = nextScene;
		viewer.dispatchEvent({type: "scene_changed"});

		expect(adapter.controls.camera).toBe(nextCamera);
		expect(adapter.helperGroup.parent).toBe(nextScene.scene);
	});

	it("旋转开始时应显示旋转中心 helper，结束后应隐藏", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);

		viewer.setControls(viewer.fjdCameraControls);
		adapter.controls.setOrbitPoint(7, 8, 9);
		adapter.controls.currentAction = adapter.controls.constructor.ACTION.ROTATE;

		adapter.controls.dispatchEvent({type: "controlstart"});

		expect(adapter.helperGroup.visible).toBe(true);
		expect(adapter.helperGroup.position.toArray()).toEqual([7, 8, 9]);

		adapter.controls.dispatchEvent({type: "controlend"});

		expect(adapter.helperGroup.visible).toBe(false);
		expect(adapter.helperCompositeGroup.visible).toBe(false);
	});

	it("关闭 helper 时应同步关闭旋转中心拾取 resolver", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		const setResolverSpy = vi.spyOn(adapter.controls, "setOrbitPointResolver");

		adapter.setHelperEnabled(false);

		expect(setResolverSpy).toHaveBeenLastCalledWith(null);
		expect(adapter.helperGroup.visible).toBe(false);
		expect(adapter.helperCompositeGroup.visible).toBe(false);

		adapter.setHelperEnabled(true);

		expect(setResolverSpy).toHaveBeenLastCalledWith(adapter._resolveOrbitPointForControls);
	});

	it("helper 的球半径与三轴长度应跟随场景包围盒大小缩放", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		const sphere = adapter.helperGroup.userData.fjdControlsHelperSphere;
		const axes = adapter.helperGroup.userData.fjdControlsHelperAxes;

		viewer.setControls(viewer.fjdCameraControls);
		adapter.controls.setOrbitPoint(1, 2, 3);
		adapter.controls.currentAction = adapter.controls.constructor.ACTION.ROTATE;
		adapter.controls.dispatchEvent({type: "controlstart"});

		// 透视相机下 helper 尺寸应按当前相机到旋转中心的距离换算成固定屏幕尺寸。
		const distanceToTarget = viewer.scene.getActiveCamera().position.distanceTo(
			new THREE.Vector3(1, 2, 3),
		);
		const worldUnitsPerPixel =
			2 * distanceToTarget * Math.tan(THREE.MathUtils.degToRad(60) * 0.5) / 600;
		expect(sphere.scale.x).toBeCloseTo(worldUnitsPerPixel * 8);
		expect(axes.scale.x).toBeCloseTo(worldUnitsPerPixel * 256);
	});

	it("EDL 模式下应改用离屏合成渲染 helper", () => {
		const {viewer, renderer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		const screenPassSpy = vi.spyOn(Utils.screenPass, "render").mockImplementation(() => {});

		viewer.setControls(viewer.fjdCameraControls);
		viewer.controls = adapter.controls;
		viewer.getPRenderer.mockReturnValue(viewer.edlRenderer);
		viewer.hasVisibleEDLEffectPointclouds.mockReturnValue(true);

		adapter.controls.setOrbitPoint(3, 4, 5);
		adapter.controls.currentAction = adapter.controls.constructor.ACTION.ROTATE;
		adapter.controls.dispatchEvent({type: "controlstart"});
		viewer.dispatchEvent({type: "render.pass.perspective_overlay"});

		expect(adapter.helperGroup.visible).toBe(false);
		expect(adapter.helperCompositeGroup.visible).toBe(true);
		expect(viewer.pRenderer.render).toHaveBeenCalledTimes(1);
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(screenPassSpy).toHaveBeenCalledTimes(1);
		expect(adapter.occlusionRenderTarget).not.toBeNull();
		expect(adapter.helperRenderTarget).not.toBeNull();
	});

	it("adapter 应通过 resolver 把场景包围盒注入 controls core", () => {
		const {viewer} = createViewer();
		const adapter = new FJDPotreeControlsAdapter(viewer);
		const targetBounds = new THREE.Box3().setFromCenterAndSize(
			new THREE.Vector3(1, 2, 3),
			new THREE.Vector3(0, 0, 0),
		);

		const resolvedBounds = adapter.resolveFitReferenceBounds(targetBounds);

		expect(viewer.getBoundingBox).toHaveBeenCalledWith(viewer.scene.pointclouds);
		expect(resolvedBounds.min.toArray()).toEqual([0, 0, 0]);
		expect(resolvedBounds.max.toArray()).toEqual([100, 200, 300]);
	});
});
