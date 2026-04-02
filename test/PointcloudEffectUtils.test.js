import { describe, it, expect } from "vitest";
import {
	applyViewerEffectDefaults,
	getPointcloudEffectState,
	hasVisibleEDLEffect,
	partitionPointcloudsByEDL,
	setPointcloudEDLEnabled,
	setPointcloudXRAYEnabled,
} from "../src/viewer/PointcloudEffectUtils.js";

function createPointcloud(initialUserData = {}) {
	return {
		visible: true,
		userData: { ...initialUserData },
	};
}

describe("PointcloudEffectUtils", () => {
	it("开启 EDL 时应自动关闭 XRAY", () => {
		const pointcloud = createPointcloud({ xrayEnabled: true });

		setPointcloudEDLEnabled(pointcloud, true, true);

		const effectState = getPointcloudEffectState(pointcloud, true);
		expect(effectState.edlEnabled).toBe(true);
		expect(effectState.xrayEnabled).toBe(false);
	});

	it("开启 XRAY 时应自动关闭 EDL", () => {
		const pointcloud = createPointcloud({ edlEnabled: true });

		setPointcloudXRAYEnabled(pointcloud, true);

		const effectState = getPointcloudEffectState(pointcloud, true);
		expect(effectState.edlEnabled).toBe(false);
		expect(effectState.xrayEnabled).toBe(true);
	});

	it("viewer 默认效果应只作用于未显式设置状态的点云", () => {
		const viewer = {
			_pointcloudEffectDefaults: {
				edlEnabled: true,
				xrayEnabled: false,
			},
		};
		const inheritedPointcloud = createPointcloud();
		const explicitPointcloud = createPointcloud({ xrayEnabled: true });

		applyViewerEffectDefaults(viewer, inheritedPointcloud, true);
		applyViewerEffectDefaults(viewer, explicitPointcloud, true);

		expect(getPointcloudEffectState(inheritedPointcloud, true).edlEnabled).toBe(true);
		expect(getPointcloudEffectState(explicitPointcloud, true).xrayEnabled).toBe(true);
	});

	it("应按 EDL 状态拆分渲染分组并识别可见 EDL 点云", () => {
		const pc1 = createPointcloud({ edlEnabled: true });
		const pc2 = createPointcloud({ xrayEnabled: true });
		const pc3 = createPointcloud({ edlEnabled: true });
		pc3.visible = false;

		const groups = partitionPointcloudsByEDL([pc1, pc2, pc3], true);

		expect(groups.edlPointclouds).toEqual([pc1, pc3]);
		expect(groups.regularPointclouds).toEqual([pc2]);
		expect(hasVisibleEDLEffect([pc1, pc2, pc3], true)).toBe(true);
		expect(hasVisibleEDLEffect([pc2, pc3], true)).toBe(false);
	});
});
