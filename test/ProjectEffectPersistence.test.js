import * as THREE from "../libs/three.js/build/three.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProject } from "../src/viewer/SaveProject.js";
import { loadProject } from "../src/viewer/LoadProject.js";
import { applyViewerEffectDefaults, getPointcloudEffectState } from "../src/viewer/PointcloudEffectUtils.js";

function createMockMaterial() {
	return {
		ranges: new Map(),
		elevationRange: [0, 10],
		intensityRange: [1, 2],
		activeAttributeName: "rgba",
		size: 1,
		minSize: 1,
		pointSizeType: 0,
		matcap: "matcap.jpg",
	};
}

function createSaveViewer(pointcloud) {
	return {
		scene: {
			pointclouds: [pointcloud],
			measurements: [],
			volumes: [],
			cameraAnimations: [],
			profiles: [],
			orientedImages: [],
			geopackages: [],
			annotations: {
				children: [],
				traverseDescendants() {},
			},
			view: {
				position: new THREE.Vector3(1, 2, 3),
				getPivot: () => new THREE.Vector3(4, 5, 6),
			},
		},
		classifications: {},
		getPointBudget: () => 1000,
		getFOV: () => 60,
		getEDLEnabled: () => false,
		getEDLRadius: () => 1.4,
		getEDLStrength: () => 0.4,
		getBackground: () => "gradient",
		getMinNodeSize: () => 30,
		getShowBoundingBox: () => false,
	};
}

function createLoadViewer() {
	const scene = {
		pointclouds: [],
		measurements: [],
		volumes: [],
		cameraAnimations: [],
		profiles: [],
		orientedImages: [],
		geopackages: [],
		annotations: {
			add() {},
			remove() {},
			children: [],
			traverseDescendants() {},
		},
		view: {
			position: {
				set: vi.fn(),
			},
			lookAt: vi.fn(),
		},
		addPointCloud(pointcloud) {
			// 模拟 viewer 在点云加入场景时应用批量默认效果。
			applyViewerEffectDefaults(viewer, pointcloud, viewer.isEDLSupported());
			this.pointclouds.push(pointcloud);
		},
	};

	const viewer = {
		scene,
		_pointcloudEffectDefaults: {
			edlEnabled: false,
			xrayEnabled: false,
		},
		isEDLSupported: vi.fn(() => true),
		setPointBudget: vi.fn(),
		setFOV: vi.fn(),
		setEDLRadius: vi.fn(),
		setEDLStrength: vi.fn(),
		setBackground: vi.fn(),
		setMinNodeSize: vi.fn(),
		setShowBoundingBox: vi.fn(),
		setClassifications: vi.fn(),
		setEDLEnabled(value) {
			this._pointcloudEffectDefaults.edlEnabled = Boolean(value);
			if (value) {
				this._pointcloudEffectDefaults.xrayEnabled = false;
			}
		},
	};

	return viewer;
}

function createLoadedPointcloud(name = "pc1") {
	return {
		name,
		userData: {},
		position: { set: vi.fn() },
		rotation: { set: vi.fn() },
		scale: { set: vi.fn() },
		material: {
			setRange: vi.fn(),
		},
	};
}

afterEach(() => {
	delete globalThis.Potree;
});

describe("Project effect persistence", () => {
	it("saveProject 应序列化点云级 EDL/XRAY 状态", () => {
		globalThis.Potree = {
			PointSizeType: {
				FIXED: 0,
			},
		};

		const pointcloud = {
			name: "pc1",
			userData: {
				edlEnabled: true,
				xrayEnabled: false,
				xrayOpacity: 0.35,
			},
			pcoGeometry: {
				url: "/pointclouds/pc1/cloud.js",
			},
			position: new THREE.Vector3(1, 2, 3),
			rotation: new THREE.Euler(0, 0, 0),
			scale: new THREE.Vector3(1, 1, 1),
			material: createMockMaterial(),
		};
		const viewer = createSaveViewer(pointcloud);

		const project = saveProject(viewer);

		expect(project.pointclouds[0].edlEnabled).toBe(true);
		expect(project.pointclouds[0].xrayEnabled).toBe(false);
		expect(project.pointclouds[0].xrayOpacity).toBe(0.35);
	});

	it("旧项目仅配置 settings.edlEnabled 时，应将默认 EDL 应用到后续加载点云", async () => {
		const viewer = createLoadViewer();
		const loadedPointcloud = createLoadedPointcloud("pc-old");

		globalThis.Potree = {
			loadPointCloud(url, name, callback) {
				callback({ pointcloud: loadedPointcloud });
			},
		};

		await loadProject(viewer, {
			type: "Potree",
			settings: {
				pointBudget: 1000,
				fov: 60,
				edlEnabled: true,
				edlRadius: 1.4,
				edlStrength: 0.4,
				background: "gradient",
				minNodeSize: 30,
				showBoundingBoxes: false,
			},
			view: {
				position: [0, 0, 0],
				target: [1, 1, 1],
			},
			classification: {},
			pointclouds: [{
				name: "pc-old",
				url: "/pointclouds/pc-old/cloud.js",
				position: [0, 0, 0],
				rotation: [0, 0, 0],
				scale: [1, 1, 1],
				material: {},
			}],
			measurements: [],
			volumes: [],
			cameraAnimations: [],
			profiles: [],
			annotations: [],
			orientedImages: [],
			geopackages: [],
		});

		const effectState = getPointcloudEffectState(viewer.scene.pointclouds[0], true);
		expect(effectState.edlEnabled).toBe(true);
		expect(effectState.xrayEnabled).toBe(false);
	});

	it("新项目中的点云级效果应覆盖旧的全局 EDL 默认值", async () => {
		const viewer = createLoadViewer();
		const loadedPointcloud = createLoadedPointcloud("pc-new");

		globalThis.Potree = {
			loadPointCloud(url, name, callback) {
				callback({ pointcloud: loadedPointcloud });
			},
		};

		await loadProject(viewer, {
			type: "Potree",
			settings: {
				pointBudget: 1000,
				fov: 60,
				edlEnabled: true,
				edlRadius: 1.4,
				edlStrength: 0.4,
				background: "gradient",
				minNodeSize: 30,
				showBoundingBoxes: false,
			},
			view: {
				position: [0, 0, 0],
				target: [1, 1, 1],
			},
			classification: {},
			pointclouds: [{
				name: "pc-new",
				url: "/pointclouds/pc-new/cloud.js",
				position: [0, 0, 0],
				rotation: [0, 0, 0],
				scale: [1, 1, 1],
				edlEnabled: false,
				xrayEnabled: true,
				xrayOpacity: 0.25,
				material: {},
			}],
			measurements: [],
			volumes: [],
			cameraAnimations: [],
			profiles: [],
			annotations: [],
			orientedImages: [],
			geopackages: [],
		});

		const effectState = getPointcloudEffectState(viewer.scene.pointclouds[0], true);
		expect(effectState.edlEnabled).toBe(false);
		expect(effectState.xrayEnabled).toBe(true);
		expect(viewer.scene.pointclouds[0].userData.xrayOpacity).toBe(0.25);
	});
});
