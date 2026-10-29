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

	it("点云加载失败时，loadProject 应直接抛错而不是一直挂起", async () => {
		const viewer = createLoadViewer();

		globalThis.Potree = {
			loadPointCloud() {
				// 用同步异常模拟业务层拿到失败态，验证 loadProject 不会卡在等待中。
				throw new Error("metadata failed");
			},
		};

		const loadPromise = loadProject(viewer, {
			type: "Potree",
			settings: {
				pointBudget: 1000,
				fov: 60,
				edlEnabled: false,
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
				name: "pc-fail",
				url: "/pointclouds/pc-fail/metadata.json",
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
		}).catch(caughtError => caughtError);

		const error = await loadPromise;

		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("metadata failed");
		expect(viewer.scene.pointclouds).toHaveLength(0);
	});
});

import {setPointCloudLabelAppearance} from "../src/utils/PointCloudLabelAppearance.js";

it("saves base effects while label selection is active", () => {
	globalThis.Potree = {PointSizeType: {FIXED: 0}};
	const pc = {name: "active", userData: {edlEnabled: true, xrayEnabled: false, xrayOpacity: 0.35}, pcoGeometry: {url: "/cloud.js"}, position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: new THREE.Vector3(1, 1, 1), material: createMockMaterial()};
	const viewer = createSaveViewer(pc);
	viewer.getEDLEnabled = () => getPointcloudEffectState(pc).edlEnabled;
	setPointCloudLabelAppearance(pc, true);
	try {
		// Runtime selection effects must never replace base preferences in a saved project.
		expect(viewer.getEDLEnabled()).toBe(true);
		for (const active of [true, false, "secondary"]) {
			setPointCloudLabelAppearance(pc, active);
			expect(viewer.getEDLEnabled()).toBe(active !== false);
			const saved = saveProject(viewer);
			expect(saved.settings.edlEnabled).toBe(true);
			expect(saved.pointclouds[0]).toMatchObject({edlEnabled: true, xrayEnabled: false, xrayOpacity: 0.35, material: {activeAttributeName: "rgba"}});
		}
		setPointcloudXRAYEnabledForTest(pc, true);
		const saved = saveProject(viewer);
		expect(saved.settings.edlEnabled).toBe(false);
		expect(saved.pointclouds[0].xrayEnabled).toBe(true);
	} finally {
		setPointCloudLabelAppearance(pc, null);
	}
});
import {setPointcloudXRAYEnabled as setPointcloudXRAYEnabledForTest} from "../src/viewer/PointcloudEffectUtils.js";

import {PointCloudAlignmentTrackingTool, isAlignmentMatrixManaged, getAlignmentPoseData, captureAlignmentPose, beginAlignmentPose, applyAlignmentLocalMatrix, endAlignmentPose} from "../src/utils/PointCloudAlignmentTransform.js";

// Exercise real project serialization/loading, including Scene changing import-time placement.
it("excludes previews and round-trips confirmed affine transforms after import defaults", async () => {
 globalThis.Potree = {PointSizeType: {FIXED: 0}};
 const pc = new THREE.Object3D();
 pc.name = "aligned";
 pc.position.set(12, 23, 34);
 pc.pcoGeometry = {url: "/aligned/metadata.json"};
 pc.material = createMockMaterial();
 const viewer = createSaveViewer(pc);
 const original = captureAlignmentPose(pc);
 beginAlignmentPose(pc, original);
 const matrix = original.matrix.clone();
 matrix.elements[4] = 0.35;
 matrix.elements[12] += 9;
 applyAlignmentLocalMatrix(pc, matrix);
 const pending = saveProject(viewer);
 expect(pending.pointclouds[0].position).toEqual([12, 23, 34]);
 expect(pending.pointclouds[0].alignmentTransform.matrix).toEqual(original.matrix.toArray());
 endAlignmentPose(pc, true);
 const saved = saveProject(viewer);
 expect(saved.pointclouds[0].alignmentTransform.matrix).toEqual(matrix.toArray());
 const loaded = new THREE.Object3D();
 loaded.material = {...createMockMaterial(), setRange() {}};
 globalThis.Potree.loadPointCloud = (_url, _name, callback) => callback({pointcloud: loaded});
 const destination = Object.assign(new THREE.EventDispatcher(), createLoadViewer());
 const tracker = new PointCloudAlignmentTrackingTool(destination);
 const originalAdd = destination.scene.addPointCloud;
 destination.scene.addPointCloud = function (cloud) {originalAdd.call(this, cloud); cloud.position.set(-999, -999, -999);};
 await loadProject(destination, saved);
 expect(loaded.matrix.toArray()).toEqual(matrix.toArray());
 expect(loaded.matrixAutoUpdate).toBe(false);
 expect(loaded.position.toArray()).toEqual([21, 23, 34]);
 tracker.dispose();
});

it("keeps legacy manual-matrix saving unchanged when alignment never owned the cloud", () => {
	globalThis.Potree = {PointSizeType: {FIXED: 0}};
	const pc = new THREE.Object3D();
	pc.position.set(1, 2, 3);
	pc.matrixAutoUpdate = false;
	pc.matrix.makeTranslation(90, 80, 70);
	pc.pcoGeometry = {url: "/legacy/metadata.json"};
	pc.material = createMockMaterial();
	const saved = saveProject(createSaveViewer(pc)).pointclouds[0];
	expect(saved.position).toEqual([1, 2, 3]);
	expect(saved.rotation).toEqual(pc.rotation.toArray());
	expect(saved.scale).toEqual(pc.scale.toArray());
	expect(saved).not.toHaveProperty("matrix");
	expect(saved).not.toHaveProperty("alignmentTransform");
	expect(isAlignmentMatrixManaged(pc)).toBe(false);
	expect(getAlignmentPoseData(pc).position).toEqual([1, 2, 3]);
});

it.each([
	[false, {matrix: new THREE.Matrix4().makeTranslation(90, 80, 70).toArray()}],
	[false, {alignmentTransform: {version: 1, matrix: new THREE.Matrix4().makeTranslation(90, 80, 70).toArray()}}],
	[true, {matrix: new THREE.Matrix4().makeTranslation(90, 80, 70).toArray()}],
	[true, {alignmentTransform: {version: 2, matrix: new THREE.Matrix4().makeTranslation(90, 80, 70).toArray()}}],
])("preserves legacy project loading unless both tracker and extension version opt in (%s)", async (enabled, extension) => {
	globalThis.Potree = {PointSizeType: {FIXED: 0}};
	const original = new THREE.Object3D();
	original.position.set(1, 2, 3);
	original.pcoGeometry = {url: "/legacy/metadata.json"};
	original.material = createMockMaterial();
	const data = saveProject(createSaveViewer(original));
	Object.assign(data.pointclouds[0], extension);
	const loaded = new THREE.Object3D();
	loaded.material = {...createMockMaterial(), setRange() {}};
	globalThis.Potree.loadPointCloud = (_url, _name, callback) => callback({pointcloud: loaded});
	const destination = Object.assign(new THREE.EventDispatcher(), createLoadViewer());
	const tracker = enabled ? new PointCloudAlignmentTrackingTool(destination) : null;
	try {
		await loadProject(destination, data);
		expect(loaded.position.toArray()).toEqual([1, 2, 3]);
		expect(loaded.matrixAutoUpdate).toBe(true);
		expect(isAlignmentMatrixManaged(loaded)).toBe(false);
	} finally {tracker?.dispose();}
});
