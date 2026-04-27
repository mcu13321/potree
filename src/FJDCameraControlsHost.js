import * as THREE from "../libs/three.js/build/three.module.js";
import {FJDCameraControls} from "../libs/fjd-camera-controls/dist/FJDCameraControls.js";

let hasInstalledFJDCameraControlsTHREE = false;

// 统一由 Potree 宿主把内部使用的 THREE 安装给独立 controls 包。
// 这里做一次幂等收口，避免不同模块入口重复表达初始化逻辑。
export function ensureFJDCameraControlsInstalled() {
	if (!hasInstalledFJDCameraControlsTHREE) {
		FJDCameraControls.install({THREE});
		hasInstalledFJDCameraControlsTHREE = true;
	}

	return FJDCameraControls;
}

export {FJDCameraControls};
