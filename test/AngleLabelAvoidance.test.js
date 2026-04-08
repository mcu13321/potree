import * as THREE from "../libs/three.js/build/three.module.js";
import {describe, expect, it} from "vitest";
import {MeasureHtmlLabel} from "../src/utils/MeasureHtmlLabel.js";

function projectToScreen(world, camera, width, height) {
	const v = world.clone().project(camera);
	return {
		x: ((v.x + 1) * width) / 2,
		y: ((-v.y + 1) * height) / 2,
	};
}

function closestDistancePointToRect(px, py, rect) {
	const cx = Math.max(rect.left, Math.min(px, rect.right));
	const cy = Math.max(rect.top, Math.min(py, rect.bottom));
	return Math.hypot(px - cx, py - cy);
}

describe("Angle label screen-space avoidance", () => {
	it("center-anchored label should not overlap marker circle for obtuse angle side placement", () => {
		// Camera looking at origin
		const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
		camera.position.set(0, 0, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();

		const width = 800;
		const height = 600;

		// Anchor (vertex) at origin; label world position chosen to be to the right of anchor in screen space.
		const anchor = new THREE.Vector3(0, 0, 0);
		const labelWorldPos = new THREE.Vector3(1, 0.15, 0); // slightly up-right

		const label = new MeasureHtmlLabel("123.45°", {
			anchorMode: "center",
			markerRadiusPx: 8,
			minGapPx: 12,
		});
		label.setVisible(true);
		label.position.copy(labelWorldPos);
		label.setScreenAnchor(anchor);

		// JSDOM doesn't lay out; provide deterministic size.
		label.domElement.getBoundingClientRect = () => ({
			width: 80,
			height: 22,
			left: 0,
			top: 0,
			right: 80,
			bottom: 22,
		});

		label.updateMatrixWorld(true);
		label.updateScreenPosition(camera, width, height, true);

		const anchorScreen = projectToScreen(anchor, camera, width, height);
		const left = Number.parseFloat(label.domElement.style.left);
		const top = Number.parseFloat(label.domElement.style.top);
		const rect = {
			left: left - 40,
			right: left + 40,
			top: top - 11,
			bottom: top + 11,
		};

		const dist = closestDistancePointToRect(anchorScreen.x, anchorScreen.y, rect);
		expect(dist).toBeGreaterThanOrEqual(8 + 12);
	});

	it("center-anchored label should not overlap marker circle for left placement", () => {
		const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
		camera.position.set(0, 0, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();

		const width = 800;
		const height = 600;

		const anchor = new THREE.Vector3(0, 0, 0);
		const labelWorldPos = new THREE.Vector3(-1, -0.05, 0); // slightly down-left

		const label = new MeasureHtmlLabel("98.76°", {
			anchorMode: "center",
			markerRadiusPx: 8,
			minGapPx: 12,
		});
		label.setVisible(true);
		label.position.copy(labelWorldPos);
		label.setScreenAnchor(anchor);

		label.domElement.getBoundingClientRect = () => ({
			width: 100,
			height: 22,
			left: 0,
			top: 0,
			right: 100,
			bottom: 22,
		});

		label.updateMatrixWorld(true);
		label.updateScreenPosition(camera, width, height, true);

		const anchorScreen = projectToScreen(anchor, camera, width, height);
		const left = Number.parseFloat(label.domElement.style.left);
		const top = Number.parseFloat(label.domElement.style.top);
		const rect = {
			left: left - 50,
			right: left + 50,
			top: top - 11,
			bottom: top + 11,
		};

		const dist = closestDistancePointToRect(anchorScreen.x, anchorScreen.y, rect);
		expect(dist).toBeGreaterThanOrEqual(8 + 12);
	});
});

