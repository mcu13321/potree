import * as THREE from "../libs/three.js/build/three.module.js";
import {readFileSync} from "node:fs";
import {afterEach, describe, expect, it, vi} from "vitest";
import {EventDispatcher} from "../src/EventDispatcher.js";
import {DefectMarkerTool} from "../src/utils/DefectMarkerTool.js";

function createCamera() {
	const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
	camera.position.set(0, 0, 10);
	camera.lookAt(new THREE.Vector3(0, 0, 0));
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
	return camera;
}

class MockViewer extends EventDispatcher {
	constructor() {
		super();
		this.renderArea = document.createElement("div");
		this.renderer = {domElement: document.createElement("canvas"), render: vi.fn()};
		this.scene = {getActiveCamera: () => this.camera};
		this.camera = createCamera();

		this.renderArea.getBoundingClientRect = () => ({
			left: 10,
			top: 20,
			width: 800,
			height: 600,
		});
		this.renderer.domElement.getBoundingClientRect = () => ({
			left: 10,
			top: 20,
			width: 800,
			height: 600,
		});
		this.renderArea.appendChild(this.renderer.domElement);
		document.body.appendChild(this.renderArea);
	}
}

describe("DefectMarkerTool", () => {
	let tool;

	afterEach(() => {
		tool?.dispose();
		tool = null;
		document.body.innerHTML = "";
	});

	it("creates Potree-owned text labels and XY-plane rings at anomaly ground positions", () => {
		const viewer = new MockViewer();
		tool = new DefectMarkerTool(viewer);
		tool.setData([{
			id: "A1",
			label: "A1",
			position: [0, 0, 0],
			color: "#2E82FF",
			darkColor: "#7DC0FF",
		}]);
		tool.setVisible(true);
		viewer.dispatchEvent({type: "update"});

		const marker = viewer.renderArea.querySelector('[data-defect-marker-id="A1"]');
		expect(marker).not.toBeNull();
		expect(marker.children[0].className).toBe("potree-defect-marker__label");
		expect(marker.children).toHaveLength(1);
		expect(marker.textContent).toBe("A1");
		expect(marker.style.getPropertyValue("--potree-defect-marker-accent")).toBe("#2E82FF");
		expect(marker.style.getPropertyValue("--potree-defect-marker-accent-dark")).toBe("#7DC0FF");
		expect(marker.style.left).toBe("400px");
		expect(marker.style.top).toBe("300px");
		expect(marker.style.display).toBe("flex");

		const styles = document.getElementById("potree-defect-marker-styles").textContent;
		expect(styles).not.toContain("border: 1px solid rgba(255, 255, 255, 0.2)");
		expect(styles).not.toContain("background: #ffffff");
		expect(styles).toContain("transform: translate(-50%, -50%)");
		expect(styles).toContain("color: #ffffff");
		expect(styles).toContain("cursor: pointer");
		expect(marker.style.fontSize).toBe("12px");

		const ring = tool.markers.get("A1").ring;
		expect(ring.position.toArray()).toEqual([0, 0, 0]);
		expect(ring.geometry.type).toBe("RingGeometry");
		expect(ring.geometry.parameters.thetaSegments).toBe(32);
		expect(ring.material.transparent).toBe(true);
		expect(ring.material.opacity).toBe(0.8);
		expect(ring.material.depthTest).toBe(false);
		expect(ring.material.depthWrite).toBe(false);
		expect(ring.material.color.getStyle()).toBe("rgb(46,130,255)");

		viewer.dispatchEvent({type: "render.pass.perspective_overlay"});
		expect(viewer.renderer.render).toHaveBeenCalledWith(tool.scene, viewer.camera);
	});

	it("keeps one active marker and dispatches the same selection for label clicks", () => {
		const viewer = new MockViewer();
		const selectedMarkerIds = [];
		viewer.addEventListener("defect_marker_selected", ({markerId}) => {
			selectedMarkerIds.push(markerId);
		});
		tool = new DefectMarkerTool(viewer);
		tool.setData([
			{id: "A1", label: "A1", position: [0, 0, 0]},
			{id: "A2", label: "A2", position: [1, 0, 0]},
		]);
		tool.setVisible(true);

		tool.setActiveMarker("A1");
		expect(tool.markers.get("A1").element.classList).toContain("potree-defect-marker--active");
		expect(tool.markers.get("A2").element.classList).not.toContain("potree-defect-marker--active");

		tool.markers.get("A2").labelTextElement.click();
		expect(tool.activeMarkerId).toBe("A2");
		expect(tool.markers.get("A1").element.classList).not.toContain("potree-defect-marker--active");
		expect(tool.markers.get("A2").element.classList).toContain("potree-defect-marker--active");
		expect(selectedMarkerIds).toEqual(["A2"]);

		const styles = document.getElementById("potree-defect-marker-styles").textContent;
		expect(styles).toContain("cursor: pointer");
		expect(styles).not.toContain("potree-defect-marker__pin");
		expect(tool.markers.get("A1").ring.material.opacity).toBe(0.8);
		expect(tool.markers.get("A2").ring.material.opacity).toBe(1);

		tool.markers.get("A1").element.dispatchEvent(new MouseEvent("mouseenter"));
		expect(tool.markers.get("A1").ring.material.opacity).toBe(0.9);
		tool.markers.get("A1").element.dispatchEvent(new MouseEvent("mouseleave"));
		expect(tool.markers.get("A1").ring.material.opacity).toBe(0.8);

		viewer.renderer.domElement.dispatchEvent(new MouseEvent("pointermove", {clientX: 419, clientY: 320}));
		expect(tool.markers.get("A1").ring.material.opacity).toBe(0.9);
		viewer.renderer.domElement.dispatchEvent(new MouseEvent("pointerleave"));
		expect(tool.markers.get("A1").ring.material.opacity).toBe(0.8);
	});

	it("focuses the live camera controls on the selected marker camera position", () => {
		const viewer = new MockViewer();
		const focusCalls = [];
		viewer.fjdCameraControls = {
			fitToSphere: (sphere, animate) => focusCalls.push({sphere, animate}),
		};
		tool = new DefectMarkerTool(viewer);
		tool.setData([{
			id: "A1",
			label: "A1",
			position: [1, 2, 3],
			cameraPosition: [4, 5, 6],
		}]);

		tool.focusMarker("A1");

		expect(focusCalls).toHaveLength(1);
		expect(focusCalls[0].sphere.center.toArray()).toEqual([4, 5, 6]);
		expect(focusCalls[0].sphere.radius).toBe(2);
		expect(focusCalls[0].animate).toBe(true);
	});

	it("updates markers by id and removes stale or invalid marker rows", () => {
		const viewer = new MockViewer();
		tool = new DefectMarkerTool(viewer);
		tool.setData([
			{id: "A1", label: "First", position: [0, 0, 0]},
			{id: "invalid", label: "Invalid", position: [0, Number.NaN, 0]},
		]);

		const originalElement = tool.markers.get("A1").element;
		expect(tool.markers.size).toBe(1);

		tool.setData([{
			id: "A1",
			label: "Updated",
			position: [1, 0, 0],
			color: "#BE123C",
			darkColor: "#F1B1B1",
		}]);
		expect(tool.markers.get("A1").element).toBe(originalElement);
		expect(originalElement.textContent).toBe("Updated");
		expect(originalElement.style.getPropertyValue("--potree-defect-marker-accent")).toBe("#BE123C");
		expect(originalElement.style.getPropertyValue("--potree-defect-marker-accent-dark")).toBe("#F1B1B1");
		expect(tool.markers.get("A1").ring.position.toArray()).toEqual([1, 0, 0]);
		expect(tool.markers.get("A1").ring.material.color.getStyle()).toBe("rgb(190,18,60)");

		tool.setData([{id: "A2", label: "Second", position: [0, 0, 0]}]);
		expect(tool.markers.has("A1")).toBe(false);
		expect(tool.markers.has("A2")).toBe(true);
	});

	it("hides markers behind the camera and clears all owned DOM", () => {
		const viewer = new MockViewer();
		tool = new DefectMarkerTool(viewer);
		tool.setData([{id: "A1", label: "Behind", position: [0, 0, 20]}]);
		tool.setVisible(true);
		viewer.dispatchEvent({type: "update"});

		expect(tool.markers.get("A1").element.style.display).toBe("none");

		tool.clear();
		expect(tool.markers.size).toBe(0);
		expect(tool.rootElement.children.length).toBe(0);
	});

	it("removes listeners, HTML, and scoped styles on dispose", () => {
		const viewer = new MockViewer();
		tool = new DefectMarkerTool(viewer);
		const rootElement = tool.rootElement;

		expect(document.getElementById("potree-defect-marker-styles")).not.toBeNull();
		tool.dispose();
		tool = null;

		expect(rootElement.isConnected).toBe(false);
		expect(document.getElementById("potree-defect-marker-styles")).toBeNull();
	});

	it("exposes the defect marker tool through viewer APIs without a sprite path", () => {
		const source = readFileSync("src/viewer/viewer.js", "utf8");

		expect(source).toMatch(/new DefectMarkerTool\(this\)/);
		expect(source).toMatch(/setDefectMarkerData \(markers\)/);
		expect(source).toMatch(/setDefectMarkerVisible \(visible\)/);
		expect(source).toMatch(/setDefectMarkerActive \(markerId\)/);
		expect(source).toMatch(/focusDefectMarker \(markerId\)/);
		expect(source).toMatch(/clearDefectMarkerData \(\)/);
		expect(source).not.toMatch(/DefectMarkerSprite/);
	});
});
