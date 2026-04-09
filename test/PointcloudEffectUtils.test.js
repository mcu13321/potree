import * as THREE from "../libs/three.js/build/three.module.js";
import { describe, expect, it } from "vitest";
import {
	applyViewerEffectDefaults,
	getPointcloudEffectState,
	getPointcloudMultiXrayOpacity,
	hasVisibleEDLEffect,
	isGroupPointcloudSource,
	partitionPointcloudsByEDL,
	resolvePointcloudSourceKind,
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

	it("记录了 top view 基准距离后 XRAY 动态透明度应高于默认值", () => {
		const pointcloud = createPointcloud({ xrayTopViewBaseDistance: 20 });
		pointcloud.pointCount = 30;

		const cameraPosition = new THREE.Vector3(20, 0, 0);
		const boundingBox = new THREE.Box3(
			new THREE.Vector3(-1, -1, -1),
			new THREE.Vector3(1, 1, 1)
		);

		expect(getPointcloudMultiXrayOpacity(pointcloud, cameraPosition, boundingBox)).toBeCloseTo(0.0245);
	});

	it("点数更少时 XRAY 动态透明度应进一步升高", () => {
		const pointcloud = createPointcloud({ xrayTopViewBaseDistance: 20 });
		pointcloud.pointCount = 20;

		const cameraPosition = new THREE.Vector3(20, 0, 0);
		const boundingBox = new THREE.Box3(
			new THREE.Vector3(-1, -1, -1),
			new THREE.Vector3(1, 1, 1)
		);

		expect(getPointcloudMultiXrayOpacity(pointcloud, cameraPosition, boundingBox)).toBeCloseTo(0.032);
	});

	it("未记录 top view 基准距离时应回退到历史固定透明度", () => {
		const pointcloud = createPointcloud();
		const cameraPosition = new THREE.Vector3(5, 0, 0);
		const boundingBox = new THREE.Box3(
			new THREE.Vector3(-1, -1, -1),
			new THREE.Vector3(1, 1, 1)
		);

		expect(getPointcloudMultiXrayOpacity(pointcloud, cameraPosition, boundingBox)).toBe(0.01);
	});

	it("应按 viewer、scene、pointcloud 顺序解析 sourceKind", () => {
		const pointcloud = createPointcloud();
		const viewer = {
			treemindPointCloudSourceMode: { sourceKind: "group" },
			scene: {
				treemindPointCloudSourceMode: { sourceKind: "single" },
			},
		};

		expect(resolvePointcloudSourceKind(viewer, pointcloud)).toBe("group");
		expect(isGroupPointcloudSource(viewer, pointcloud)).toBe(true);
	});

	it("viewer 缺失时应回退到 scene 与 pointcloud 的 sourceKind", () => {
		const pointcloud = createPointcloud();
		pointcloud.treemindPointCloudSourceMode = { sourceKind: "group" };
		const viewer = {
			scene: {
				treemindPointCloudSourceMode: { sourceKind: "single" },
			},
		};

		expect(resolvePointcloudSourceKind(viewer, pointcloud)).toBe("single");
		delete viewer.scene.treemindPointCloudSourceMode;
		expect(resolvePointcloudSourceKind(viewer, pointcloud)).toBe("group");
	});

	it("sourceKind 缺失或非法时应回退为 single", () => {
		const pointcloud = createPointcloud();
		const viewer = {
			treemindPointCloudSourceMode: { sourceKind: "invalid" },
			scene: {},
		};

		expect(resolvePointcloudSourceKind(viewer, pointcloud)).toBe("single");
		expect(isGroupPointcloudSource(viewer, pointcloud)).toBe(false);
	});
});
