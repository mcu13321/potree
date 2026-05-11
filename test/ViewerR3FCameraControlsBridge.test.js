import {beforeAll, describe, expect, it, vi} from "vitest";

let Viewer;

function createBridgeCapableControls() {
	return {
		setLookAt: vi.fn(),
		zoomTo: vi.fn(),
		camera: {
			isOrthographicCamera: false,
		},
	};
}

function createExternalCameraControlsState() {
	return {
		// 模拟 R3F 侧 controls 实例，按统一 pose 桥接语义提供 position + target。
		getPosition() {
			return {x: 10, y: 20, z: 30};
		},
		getTarget() {
			return {x: 1, y: 2, z: 3};
		},
		camera: {
			isOrthographicCamera: false,
		},
	};
}

describe("Viewer R3F camera-controls 桥接", () => {
	beforeAll(async () => {
		// viewer 模块顶层会加载 map.js，这里先补一个最小 proj4 stub，避免测试被无关全局依赖打断。
		vi.stubGlobal("proj4", {
			defs: vi.fn(),
		});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});

	it("应优先把外部 controls 状态同步到当前激活的兼容 controls", () => {
		const activeControls = createBridgeCapableControls();
		const fallbackControls = createBridgeCapableControls();
		const viewerLike = {
			controls: activeControls,
			cameraControls: fallbackControls,
			cloneExternalPoseVector:
				Viewer.prototype.cloneExternalPoseVector,
			canReadExternalControlsPose:
				Viewer.prototype.canReadExternalControlsPose,
			readExternalControlsPose:
				Viewer.prototype.readExternalControlsPose,
			canApplyExternalControlsPose:
				Viewer.prototype.canApplyExternalControlsPose,
			applyExternalControlsPose:
				Viewer.prototype.applyExternalControlsPose,
			resolveExternalCameraControlsBridgeTarget:
				Viewer.prototype.resolveExternalCameraControlsBridgeTarget,
		};

		const result = Viewer.prototype.setFromR3fCameraControls.call(
			viewerLike,
			createExternalCameraControlsState(),
			true,
		);

		expect(result).toBe(true);
		expect(activeControls.setLookAt).toHaveBeenCalledWith(
			10, 20, 30,
			1, 2, 3,
			true,
		);
		expect(activeControls.zoomTo).not.toHaveBeenCalled();
		expect(fallbackControls.setLookAt).not.toHaveBeenCalled();
	});

	it("当前 controls 不兼容时应回退到旧 cameraControls", () => {
		const fallbackControls = createBridgeCapableControls();
		const viewerLike = {
			controls: {
				update: vi.fn(),
			},
			cameraControls: fallbackControls,
			cloneExternalPoseVector:
				Viewer.prototype.cloneExternalPoseVector,
			canReadExternalControlsPose:
				Viewer.prototype.canReadExternalControlsPose,
			readExternalControlsPose:
				Viewer.prototype.readExternalControlsPose,
			canApplyExternalControlsPose:
				Viewer.prototype.canApplyExternalControlsPose,
			applyExternalControlsPose:
				Viewer.prototype.applyExternalControlsPose,
			resolveExternalCameraControlsBridgeTarget:
				Viewer.prototype.resolveExternalCameraControlsBridgeTarget,
		};

		const result = Viewer.prototype.setFromR3fCameraControls.call(
			viewerLike,
			createExternalCameraControlsState(),
			false,
		);

		expect(result).toBe(true);
		expect(fallbackControls.setLookAt).toHaveBeenCalledWith(
			10, 20, 30,
			1, 2, 3,
			false,
		);
	});

	it("缺少来源或目标 controls 时应安全返回 false", () => {
		const viewerLike = {
			controls: null,
			cameraControls: null,
			cloneExternalPoseVector:
				Viewer.prototype.cloneExternalPoseVector,
			canReadExternalControlsPose:
				Viewer.prototype.canReadExternalControlsPose,
			readExternalControlsPose:
				Viewer.prototype.readExternalControlsPose,
			canApplyExternalControlsPose:
				Viewer.prototype.canApplyExternalControlsPose,
			applyExternalControlsPose:
				Viewer.prototype.applyExternalControlsPose,
			resolveExternalCameraControlsBridgeTarget:
				Viewer.prototype.resolveExternalCameraControlsBridgeTarget,
		};

		expect(
			Viewer.prototype.setFromR3fCameraControls.call(viewerLike, null, true),
		).toBe(false);
		expect(
			Viewer.prototype.setFromR3fCameraControls.call(
				viewerLike,
				{
					getPosition: () => ({x: 10, y: 20, z: 30}),
					getTarget: () => ({x: 1, y: 2, z: 3}),
				},
				true,
			),
		).toBe(false);
	});

	it("正交相机桥接时应额外同步 zoom", () => {
		const activeControls = createBridgeCapableControls();
		activeControls.camera.isOrthographicCamera = true;
		const viewerLike = {
			controls: activeControls,
			cameraControls: null,
			cloneExternalPoseVector:
				Viewer.prototype.cloneExternalPoseVector,
			canReadExternalControlsPose:
				Viewer.prototype.canReadExternalControlsPose,
			readExternalControlsPose:
				Viewer.prototype.readExternalControlsPose,
			canApplyExternalControlsPose:
				Viewer.prototype.canApplyExternalControlsPose,
			applyExternalControlsPose:
				Viewer.prototype.applyExternalControlsPose,
			resolveExternalCameraControlsBridgeTarget:
				Viewer.prototype.resolveExternalCameraControlsBridgeTarget,
		};

		const result = Viewer.prototype.setFromR3fCameraControls.call(
			viewerLike,
			{
				getPosition: () => ({x: 3, y: 4, z: 5}),
				getTarget: () => ({x: 0, y: 1, z: 2}),
				camera: {
					isOrthographicCamera: true,
					zoom: 6,
				},
			},
			true,
		);

		expect(result).toBe(true);
		expect(activeControls.setLookAt).toHaveBeenCalledWith(3, 4, 5, 0, 1, 2, true);
		expect(activeControls.zoomTo).toHaveBeenCalledWith(6, true);
	});

	it("syncControlsContext 应优先走 setCamera，不再回落到旧 setScene", () => {
		const setCamera = vi.fn();
		const setScene = vi.fn();
		const camera = {name: "active-camera"};
		const scene = {
			getActiveCamera() {
				return camera;
			},
		};
		const viewerLike = {
			scene,
			supportsSceneContext: Viewer.prototype.supportsSceneContext,
		};

		Viewer.prototype.syncControlsContext.call(
			viewerLike,
			{
				supportsSetCamera: true,
				supportsSetScene: true,
				setCamera,
				setScene,
			},
			scene,
		);

		expect(setCamera).toHaveBeenCalledWith(camera);
		expect(setScene).not.toHaveBeenCalled();
	});

	it("syncControlsContext 只应对显式声明 supportsSetScene 的旧 controls 调 setScene", () => {
		const scene = {
			getActiveCamera() {
				return null;
			},
		};
		const legacySetScene = vi.fn();
		const undeclaredSetScene = vi.fn();
		const viewerLike = {
			scene,
			supportsSceneContext: Viewer.prototype.supportsSceneContext,
		};

		Viewer.prototype.syncControlsContext.call(
			viewerLike,
			{
				supportsSetScene: true,
				setScene: legacySetScene,
			},
			scene,
		);
		Viewer.prototype.syncControlsContext.call(
			viewerLike,
			{
				setScene: undeclaredSetScene,
			},
			scene,
		);

		expect(legacySetScene).toHaveBeenCalledWith(scene);
		expect(undeclaredSetScene).not.toHaveBeenCalled();
	});

	it("setCameraMode 切换投影后应立即同步当前 controls 与旧 cameraControls", () => {
		const syncControlsContext = vi.fn();
		const scene = {
			pointclouds: [
				{material: {}},
				{material: {}},
			],
		};
		const viewerLike = {
			scene,
			controls: {name: "active-controls"},
			cameraControls: {name: "legacy-camera-controls"},
			syncControlsContext,
		};

		Viewer.prototype.setCameraMode.call(viewerLike, 0);

		expect(syncControlsContext).toHaveBeenNthCalledWith(1, viewerLike.controls, scene);
		expect(syncControlsContext).toHaveBeenNthCalledWith(2, viewerLike.cameraControls, scene);
	});
});
