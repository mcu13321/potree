import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it, vi} from "vitest";
import {Scene} from "../src/viewer/Scene.js";

vi.mock("../src/Annotation.js", () => ({
	Annotation: class {
		constructor() {
			// Scene 单元测试不验证 Annotation DOM，这里只保留最小可构造对象。
			this.children = [];
		}
	},
}));

function createPointcloud({
	position = new THREE.Vector3(100, 200, 50),
	metadataOffset = [500, 600, 700],
	sourceMode = null,
	cacheKey = null,
} = {}) {
	const pointcloud = new THREE.Object3D();

	// 测试对象只保留 Scene.addPointCloud 所需字段，避免引入真实点云加载流程。
	pointcloud.visible = true;
	pointcloud.position.copy(position);
	pointcloud.boundingBox = new THREE.Box3(
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(10, 20, 30),
	);
	pointcloud.pcoGeometry = {
		tightBoundingBox: new THREE.Box3(
			new THREE.Vector3(3, 4, 3),
			new THREE.Vector3(9, 18, 27),
		),
		loader: {
			metadata: {
				offset: metadataOffset,
			},
		},
	};
	pointcloud.treemindPointCloudSourceMode = sourceMode;
	pointcloud.sourceCacheKey = cacheKey;

	return pointcloud;
}

function expectVectorClose(actual, expected) {
	expect(actual.x).toBeCloseTo(expected.x);
	expect(actual.y).toBeCloseTo(expected.y);
	expect(actual.z).toBeCloseTo(expected.z);
}

describe("Scene.addPointCloud R3F transform", () => {
	it("应按 R3F 的 moveToOrigin 和 Z 贴地规则平移点云", () => {
		const scene = new Scene();
		const pointcloud = createPointcloud();

		scene.addPointCloud(pointcloud);

		expectVectorClose(pointcloud.position, new THREE.Vector3(-6, -11, -3));
		expectVectorClose(pointcloud.userData.offset, new THREE.Vector3(-106, -211, -53));
		expectVectorClose(pointcloud.userData.coordinateOffset, new THREE.Vector3(106, 211, 700));
	});

	it("组模式下后续点云应复用第一份平移量和坐标 offset", () => {
		const scene = new Scene();
		const sourceMode = {sourceKind: "group"};
		const first = createPointcloud({sourceMode, cacheKey: "group-a"});
		const second = createPointcloud({
			position: new THREE.Vector3(300, 400, 60),
			metadataOffset: [900, 900, 900],
			sourceMode,
			cacheKey: "group-a",
		});

		scene.addPointCloud(first);
		scene.addPointCloud(second);

		expectVectorClose(second.position, new THREE.Vector3(194, 189, 7));
		expectVectorClose(second.userData.offset, first.userData.offset);
		expectVectorClose(second.userData.coordinateOffset, first.userData.coordinateOffset);
		expect(second.userData.coordinateOffset).not.toBe(first.userData.coordinateOffset);
	});

	it("关闭 translateToCenter 时不应改变点云位置和 offset", () => {
		const scene = new Scene();
		const pointcloud = createPointcloud();
		const oldPosition = pointcloud.position.clone();

		scene.addPointCloud(pointcloud, false);

		expectVectorClose(pointcloud.position, oldPosition);
		expect(pointcloud.userData.offset).toBeUndefined();
		expect(pointcloud.userData.coordinateOffset).toBeUndefined();
	});
});
