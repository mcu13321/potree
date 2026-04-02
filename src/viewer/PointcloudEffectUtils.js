/**
 * 确保点云效果状态统一挂载在 `userData` 下，便于渲染与序列化复用。
 * @param {Object} pointcloud
 * @returns {Object}
 */
export function ensurePointcloudEffectUserData(pointcloud) {
	if (!pointcloud.userData) {
		pointcloud.userData = {};
	}

	return pointcloud.userData;
}

/**
 * 读取当前点云的实际效果状态，并在读取阶段兜底处理互斥关系。
 * @param {Object} pointcloud
 * @param {boolean} edlSupported
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function getPointcloudEffectState(pointcloud, edlSupported = true) {
	const userData = ensurePointcloudEffectUserData(pointcloud);
	const edlEnabled = Boolean(userData.edlEnabled) && Boolean(edlSupported);
	const xrayEnabled = Boolean(userData.xrayEnabled) && !edlEnabled;
	let xrayOpacity = userData.xrayOpacity;

	if (typeof xrayOpacity !== "number" || Number.isNaN(xrayOpacity)) {
		xrayOpacity = 0.5;
	}

	return {
		userData,
		edlEnabled,
		xrayEnabled,
		xrayOpacity,
	};
}

/**
 * 将点云状态规范化为“EDL 与 XRAY 互斥”的最终结果。
 * @param {Object} pointcloud
 * @param {boolean} edlSupported
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function normalizePointcloudEffectState(pointcloud, edlSupported = true) {
	const state = getPointcloudEffectState(pointcloud, edlSupported);

	state.userData.edlEnabled = state.edlEnabled;
	state.userData.xrayEnabled = state.xrayEnabled;

	return state;
}

/**
 * 为点云开启或关闭 EDL，并在开启时自动关闭 XRAY。
 * @param {Object} pointcloud
 * @param {boolean} value
 * @param {boolean} edlSupported
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function setPointcloudEDLEnabled(pointcloud, value, edlSupported = true) {
	const userData = ensurePointcloudEffectUserData(pointcloud);
	const nextValue = Boolean(value) && Boolean(edlSupported);

	userData.edlEnabled = nextValue;
	if (nextValue) {
		userData.xrayEnabled = false;
	}

	return normalizePointcloudEffectState(pointcloud, edlSupported);
}

/**
 * 为点云开启或关闭 XRAY，并在开启时自动关闭 EDL。
 * @param {Object} pointcloud
 * @param {boolean} value
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function setPointcloudXRAYEnabled(pointcloud, value) {
	const userData = ensurePointcloudEffectUserData(pointcloud);
	const nextValue = Boolean(value);

	userData.xrayEnabled = nextValue;
	if (nextValue) {
		userData.edlEnabled = false;
	}

	return normalizePointcloudEffectState(pointcloud, true);
}

/**
 * 清空点云的基础效果状态。
 * @param {Object} pointcloud
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function clearPointcloudEffects(pointcloud) {
	const userData = ensurePointcloudEffectUserData(pointcloud);

	userData.edlEnabled = false;
	userData.xrayEnabled = false;

	return normalizePointcloudEffectState(pointcloud, true);
}

/**
 * 将 viewer 当前保存的批量默认效果应用到新点云上。
 * @param {Object} viewer
 * @param {Object} pointcloud
 * @param {boolean} edlSupported
 * @returns {{userData: Object, edlEnabled: boolean, xrayEnabled: boolean, xrayOpacity: number}}
 */
export function applyViewerEffectDefaults(viewer, pointcloud, edlSupported = true) {
	const userData = ensurePointcloudEffectUserData(pointcloud);
	const hasExplicitState =
		userData.edlEnabled !== undefined ||
		userData.xrayEnabled !== undefined;

	if (hasExplicitState) {
		return normalizePointcloudEffectState(pointcloud, edlSupported);
	}

	const defaults = viewer?._pointcloudEffectDefaults ?? {};

	if (defaults.edlEnabled) {
		return setPointcloudEDLEnabled(pointcloud, true, edlSupported);
	}

	if (defaults.xrayEnabled) {
		return setPointcloudXRAYEnabled(pointcloud, true);
	}

	return clearPointcloudEffects(pointcloud);
}

/**
 * 判断当前可见点云中是否存在启用了 EDL 的点云。
 * @param {Array<Object>} pointclouds
 * @param {boolean} edlSupported
 * @returns {boolean}
 */
export function hasVisibleEDLEffect(pointclouds, edlSupported = true) {
	return pointclouds.some((pointcloud) => {
		if (pointcloud.visible === false) {
			return false;
		}

		return getPointcloudEffectState(pointcloud, edlSupported).edlEnabled;
	});
}

/**
 * 判断所有点云是否都处于 EDL 状态；空数组时回退给调用方处理默认值。
 * @param {Array<Object>} pointclouds
 * @param {boolean} edlSupported
 * @returns {boolean}
 */
export function areAllPointcloudsEDLEnabled(pointclouds, edlSupported = true) {
	if (!Array.isArray(pointclouds) || pointclouds.length === 0) {
		return false;
	}

	return pointclouds.every((pointcloud) => {
		return getPointcloudEffectState(pointcloud, edlSupported).edlEnabled;
	});
}

/**
 * 按是否启用 EDL 将点云拆分为两个渲染分组。
 * @param {Array<Object>} pointclouds
 * @param {boolean} edlSupported
 * @returns {{edlPointclouds: Array<Object>, regularPointclouds: Array<Object>}}
 */
export function partitionPointcloudsByEDL(pointclouds, edlSupported = true) {
	const edlPointclouds = [];
	const regularPointclouds = [];

	for (const pointcloud of pointclouds) {
		if (getPointcloudEffectState(pointcloud, edlSupported).edlEnabled) {
			edlPointclouds.push(pointcloud);
		} else {
			regularPointclouds.push(pointcloud);
		}
	}

	return {
		edlPointclouds,
		regularPointclouds,
	};
}
