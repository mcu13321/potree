import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it, vi} from "vitest";

vi.mock("../libs/konva/lib/shapes/Circle.js", () => {
	class Circle {
		constructor() {}

		// 仅需返回可被 CanvasTexture 接收的 canvas，避免真实 Konva 依赖干扰测试。
		toCanvas() {
			const canvas = document.createElement("canvas");
			canvas.width = 16;
			canvas.height = 16;
			return canvas;
		}
	}

	return {Circle};
});

const {Measure} = await import("../src/utils/Measure.js");

function createViewer() {
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	camera.position.set(0, 0, 10);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateMatrixWorld(true);
	camera.updateProjectionMatrix();

	return {
		measuringTool: {
			activeMeasurement: null,
			setActiveMeasurement: vi.fn(),
		},
		scene: {
			getActiveCamera: () => camera,
			pointclouds: [],
			dispatchEvent: vi.fn(),
		},
	};
}

describe("Measure label placement", () => {
	it("点标签和线标签应带有额外上移偏移", () => {
		const viewer = createViewer();
		const measure = new Measure(viewer);

		measure.addMarker(new THREE.Vector3(0, 0, 0));
		measure.addMarker(new THREE.Vector3(1, 0, 0));

		expect(measure.coordinateLabels[0].offsetY).toBe(-14);
		expect(measure.edgeLabels[0].offsetY).toBe(-10);
	});

	it("坐标标签应使用 Scene 共享 offset 还原原始坐标", () => {
		const viewer = createViewer();
		viewer.scene.pointclouds = [{
			userData: {
				offset: new THREE.Vector3(1, 1, 1),
			},
		}];
		// The Scene owns the shared offset instead of relying on the first pointcloud.
		viewer.scene.getPointCloudCoordinateOffset = () => new THREE.Vector3(10, 20, 30);
		const measure = new Measure(viewer);

		measure.addMarker(new THREE.Vector3(11, 22, 33));
		measure.update();

		expect(measure.coordinateLabels[0].text).toBe("1.00 / 2.00 / 3.00");
	});

	it("三角形三个角度标签都应位于三角形外侧", () => {
		// 通过比较标签方向与重心方向，确保角度标签始终沿外侧显示。
		const viewer = createViewer();
		const measure = new Measure(viewer);

		measure.showAngles = true;
		measure.addMarker(new THREE.Vector3(0, 0, 0));
		measure.addMarker(new THREE.Vector3(2, 0, 0));
		measure.addMarker(new THREE.Vector3(0.5, 1.5, 0));
		measure.update();

		const centroid = new THREE.Vector3();
		for (const point of measure.points) {
			centroid.add(point.position);
		}
		centroid.divideScalar(measure.points.length);

		for (let i = 0; i < 3; i++) {
			const vertex = measure.points[i].position;
			const label = measure.angleLabels[i].position;
			const toCentroid = centroid.clone().sub(vertex);
			const toLabel = label.clone().sub(vertex);

			expect(toLabel.length()).toBeGreaterThan(0);
			expect(toLabel.dot(toCentroid)).toBeLessThan(0);
		}
	});
});
