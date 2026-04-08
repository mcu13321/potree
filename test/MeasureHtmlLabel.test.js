import * as THREE from "../libs/three.js/build/three.module.js";
import {afterEach, describe, expect, it} from "vitest";
import {MeasureHtmlLabel} from "../src/utils/MeasureHtmlLabel.js";

function createCamera() {
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	camera.position.set(0, 0, 10);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateMatrixWorld(true);
	camera.updateProjectionMatrix();

	return camera;
}

describe("MeasureHtmlLabel", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("应更新文本并投影到屏幕坐标", () => {
		// 使用真实 DOM 节点验证 HTML 标签的挂载与定位行为。
		const container = document.createElement("div");
		document.body.appendChild(container);

		const label = new MeasureHtmlLabel("12.34 m");
		label.position.set(0, 0, 0);
		label.setVisible(true);
		label.attach(container);
		label.updateScreenPosition(createCamera(), 200, 100, true);

		expect(label.domElement.textContent).toBe("12.34 m");
		expect(label.domElement.style.left).toBe("100px");
		expect(label.domElement.style.top).toBe("50px");
		expect(label.domElement.style.display).toBe("block");
	});

	it("应使用固定像素样式，避免不同 DPR 下尺寸漂移", () => {
		// 新 HTML 标签需要在 PC 与移动端保持一致的 CSS 尺寸。
		const label = new MeasureHtmlLabel("style");

		expect(label.domElement.style.backgroundColor).toBe("rgb(46, 130, 255)");
		expect(label.domElement.style.color).toBe("rgb(255, 255, 255)");
		expect(label.domElement.style.borderTopStyle).toBe("solid");
		expect(label.domElement.style.borderTopColor).toBe("rgb(255, 255, 255)");
		expect(label.domElement.style.fontFamily).toContain("Arial");
		expect(label.domElement.style.fontSize).toBe("14px");
		expect(label.domElement.style.padding).toBe("3px 8px");
		expect(label.domElement.style.borderTopWidth).toBe("1.5px");
		expect(label.domElement.style.borderRadius).toBe("4px");
		expect(label.domElement.style.boxShadow).toBe("0 2px 6px rgba(0, 0, 0, 0.3)");
	});

	it("在全局隐藏或锚点位于相机后方时应隐藏", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);

		const label = new MeasureHtmlLabel("hidden");
		label.position.set(0, 0, 0);
		label.setVisible(true);
		label.attach(container);
		label.updateScreenPosition(createCamera(), 200, 100, false);
		expect(label.domElement.style.display).toBe("none");

		label.updateScreenPosition(createCamera(), 200, 100, true);
		expect(label.domElement.style.display).toBe("block");

		label.position.set(0, 0, 20);
		label.updateScreenPosition(createCamera(), 200, 100, true);
		expect(label.domElement.style.display).toBe("none");
	});

	it("应支持额外的 offset 偏移", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);

		const label = new MeasureHtmlLabel("offset", {offsetX: 5, offsetY: -12});
		label.position.set(0, 0, 0);
		label.setVisible(true);
		label.attach(container);
		label.updateScreenPosition(createCamera(), 200, 100, true);

		expect(label.domElement.style.left).toBe("105px");
		expect(label.domElement.style.top).toBe("38px");
	});

	it("应支持基于屏幕方向的径向避让偏移", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);

		const camera = createCamera();
		const anchor = new THREE.Object3D();
		anchor.position.set(0, 0, 0);
		const label = new MeasureHtmlLabel("radial", {radialOffset: 18});
		label.position.set(1, 0, 0);
		label.setVisible(true);
		label.setScreenAnchor(anchor, 18);
		label.attach(container);
		label.updateScreenPosition(camera, 200, 100, true);

		// 标签位于锚点右侧时，应继续向右退开 18 像素，而不是仅使用固定 offset。
		expect(label.domElement.style.left).toBe("135px");
		expect(label.domElement.style.top).toBe("50px");
	});
});
