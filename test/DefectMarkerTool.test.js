import * as THREE from "../libs/three.js/build/three.module.js";
import {readFileSync} from "node:fs";
import {afterEach, describe, expect, it} from "vitest";
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
		this.renderer = {domElement: document.createElement("canvas")};
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

	it("creates Potree-owned HTML markers with a label above a circular pin", () => {
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
		expect(marker.children[1].className).toBe("potree-defect-marker__pin");
		expect(marker.textContent).toBe("A1");
		expect(marker.style.getPropertyValue("--potree-defect-marker-accent")).toBe("#2E82FF");
		expect(marker.style.getPropertyValue("--potree-defect-marker-accent-dark")).toBe("#7DC0FF");
		expect(marker.style.left).toBe("400px");
		expect(marker.style.top).toBe("300px");
		expect(marker.style.display).toBe("flex");

		const styles = document.getElementById("potree-defect-marker-styles").textContent;
		expect(styles).toContain("border: 1px solid rgba(255, 255, 255, 0.2)");
		expect(styles).toContain("border-color: rgba(255, 255, 255, 0.2)");
		expect(styles).toContain("cursor: pointer");
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

		tool.setActiveMarker("A1");
		expect(tool.markers.get("A1").element.classList).toContain("potree-defect-marker--active");
		expect(tool.markers.get("A2").element.classList).not.toContain("potree-defect-marker--active");

		tool.markers.get("A2").labelTextElement.click();
		expect(tool.activeMarkerId).toBe("A2");
		expect(tool.markers.get("A1").element.classList).not.toContain("potree-defect-marker--active");
		expect(tool.markers.get("A2").element.classList).toContain("potree-defect-marker--active");
		expect(selectedMarkerIds).toEqual(["A2"]);

		const styles = document.getElementById("potree-defect-marker-styles").textContent;
		expect(styles).toContain(".potree-defect-marker--active");
		expect(styles).toContain("0 0 0 6px rgba(255, 255, 255, 0.18)");
		expect(styles).toContain("0 0 0 11px rgba(255, 255, 255, 0.09)");
		expect(styles).not.toContain(".potree-defect-marker__pin::before");
		expect(styles).not.toContain(".potree-defect-marker__pin::after");
		expect(styles).toContain(".potree-defect-marker__label::after");
		expect(styles).toContain("background: rgba(0, 0, 0, 0.2)");
		expect(styles).toContain(".potree-defect-marker--active .potree-defect-marker__label::after");
	});

	it("focuses the live camera controls on the selected marker position", () => {
		const viewer = new MockViewer();
		const focusCalls = [];
		viewer.fjdCameraControls = {
			fitToSphere: (sphere, animate) => focusCalls.push({sphere, animate}),
		};
		tool = new DefectMarkerTool(viewer);
		tool.setData([{id: "A1", label: "A1", position: [1, 2, 3]}]);

		tool.focusMarker("A1");

		expect(focusCalls).toHaveLength(1);
		expect(focusCalls[0].sphere.center.toArray()).toEqual([1, 2, 3]);
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
