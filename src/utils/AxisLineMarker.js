import * as THREE from "../../libs/three.js/build/three.module.js";
import {Line2} from "../../libs/three.js/lines/Line2.js";
import {LineGeometry} from "../../libs/three.js/lines/LineGeometry.js";
import {LineMaterial} from "../../libs/three.js/lines/LineMaterial.js";

export const AXIS_LINE_NAME = "axisLine";
export const AXIS_LINE_DEFAULT_XY_TOLERANCES = Object.freeze([0.02, 0.05, 0.1, 0.2]);

function toVector3(value) {
	if (value?.isVector3) {
		return value.clone();
	}
	if (Array.isArray(value)) {
		return new THREE.Vector3(...value);
	}
	return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

export function selectAxisLineLowestPoint(origin, candidates, tolerances) {
	const sortedTolerances = [...tolerances]
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((left, right) => left - right);

	for (const tolerance of sortedTolerances) {
		const toleranceSquared = tolerance * tolerance;
		let selected = null;
		let selectedDistanceSquared = Infinity;

		for (const candidate of candidates) {
			const dx = candidate.x - origin.x;
			const dy = candidate.y - origin.y;
			const distanceSquared = dx * dx + dy * dy;
			if (distanceSquared > toleranceSquared) {
				continue;
			}

			if (
				!selected ||
				candidate.z < selected.z ||
				(candidate.z === selected.z && distanceSquared < selectedDistanceSquared)
			) {
				selected = candidate;
				selectedDistanceSquared = distanceSquared;
			}
		}

		if (selected) {
			return selected.clone();
		}
	}

	return null;
}

export class AxisLineMarker extends THREE.Object3D {
	constructor({uuid, visible = true} = {}) {
		super();

		if (uuid) {
			this.uuid = uuid;
		}
		this.name = AXIS_LINE_NAME;
		this.isAxisLineMarker = true;
		this.finished = false;
		this.isFinished = false;
		this.isFinalizing = false;
		this.visible = visible;
		this.points = [];
		this.previewPoint = null;
		this.color = new THREE.Color(0xffffff);

		this.showDistances = false;
		this.showCoordinates = false;
		this.showArea = false;
		this.closed = false;
		this.showAngles = false;
		this.showHeight = false;
		this.showCircle = false;
		this.showAzimuth = false;
		this.showEdges = true;

		const geometry = new LineGeometry();
		geometry.setPositions([0, 0, 0, 0, 0, 0]);
		const material = new LineMaterial({
			color: 0xffffff,
			linewidth: 2,
			resolution: new THREE.Vector2(1000, 1000),
		});
		material.depthTest = false;
		material.depthWrite = false;

		this.line = new Line2(geometry, material);
		this.line.frustumCulled = false;
		this.line.visible = false;
		this.add(this.line);
	}

	addPoint(position, pointcloud = null) {
		this.points.push({position: toVector3(position), pointcloud});
		this.previewPoint = null;
		this.update();
		this.dispatchEvent({type: "marker_added", measurement: this});
	}

	setPreviewPoint(position) {
		this.previewPoint = position ? toVector3(position) : null;
		this.update();
		this.dispatchEvent({type: "preview_changed", measurement: this});
	}

	setFinalPoints(positions) {
		this.points = positions.map((position) => ({position: toVector3(position), pointcloud: null}));
		this.previewPoint = null;
		this.update();
	}

	clear() {
		this.points = [];
		this.previewPoint = null;
		this.update();
		this.dispatchEvent({type: "marker_removed", measurement: this});
	}

	updateResolution(width, height) {
		this.line.material.resolution.set(Math.max(width, 1), Math.max(height, 1));
	}

	update() {
		const positions = this.points.map((point) => point.position);
		if (this.previewPoint && positions.length > 0) {
			positions.push(this.previewPoint);
		}

		if (positions.length < 2) {
			this.line.visible = false;
			return;
		}

		this.line.geometry.setPositions(positions.flatMap((position) => position.toArray()));
		// Three.js r124 caches the first rendered segment count, so invalidate it when this polyline grows.
		delete this.line.geometry._maxInstanceCount;
		this.line.geometry.computeBoundingSphere();
		this.line.computeLineDistances();
		this.line.visible = true;
	}

	dispose() {
		this.line.geometry.dispose();
		this.line.material.dispose();
	}
}
