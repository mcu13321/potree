import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it} from "vitest";
import * as moduleEntry from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";
import {FJDCameraControls} from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";

describe("FJDCameraControls module entry", () => {
	it("模块入口只暴露 FJDCameraControls 一个公共接口", () => {
		// 独立包对外只保留单一公共入口，避免把内部实现细节继续泄露给 Potree。
		expect(Object.keys(moduleEntry)).toEqual(["FJDCameraControls"]);
		expect("default" in moduleEntry).toBe(false);
	});

	it("模块入口应能独立导入并完成安装与实例化", () => {
		const domElement = document.createElement("div");
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

		// Potree 作为宿主时仍需要把自身 three 安装给独立 controls 包。
		FJDCameraControls.install({THREE});
		const controls = new FJDCameraControls(camera, domElement);

		expect(controls).toBeInstanceOf(FJDCameraControls);
		expect(typeof controls.update).toBe("function");
		expect(typeof controls.connect).toBe("function");
	});

	it("应兼容 drei impl 注入的精简 THREE 子集", () => {
		const domElement = document.createElement("div");
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
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		camera.position.set(0, -10, 3);
		camera.lookAt(new THREE.Vector3(0, 0, 0));
		camera.updateMatrixWorld(true);

		// 模拟 drei CameraControls.js 传入的精简 THREE 子集。
		FJDCameraControls.install({
			THREE: {
				Box3: THREE.Box3,
				Matrix4: THREE.Matrix4,
				Quaternion: THREE.Quaternion,
				Sphere: THREE.Sphere,
				Spherical: THREE.Spherical,
				Vector2: THREE.Vector2,
				Vector3: THREE.Vector3,
				Vector4: THREE.Vector4,
				MathUtils: {
					clamp: THREE.MathUtils.clamp,
				},
			},
		});

		const controls = new FJDCameraControls(camera, domElement);
		controls.syncFromCameraAndViewTarget(new THREE.Vector3(0, 0, 0));

		expect(controls.sceneControls).toBe(null);
		expect(controls.getDistanceToFitSphere(2)).toBeGreaterThan(0);
		expect(controls.getDistanceToFitBox(4, 6, 8, false)).toBeGreaterThan(0);

		// 还原完整 THREE，避免影响其他测试。
		FJDCameraControls.install({THREE});
	});
});
