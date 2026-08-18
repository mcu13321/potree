import * as THREE from "../../libs/three.js/build/three.module.js";
import {CAD_VECTOR_COORDINATE_SPACE, CadVector} from "./CadVector.js";

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

export class AxisLineMarker extends CadVector {
	constructor({uuid, visible = true} = {}) {
		super({
			uuid,
			visible,
			name: AXIS_LINE_NAME,
			vectorType: AXIS_LINE_NAME,
			coordinateSpace: CAD_VECTOR_COORDINATE_SPACE.SCENE,
		});

		this.name = AXIS_LINE_NAME;
		this.isAxisLineMarker = true;
		this.finished = false;
		this.isFinished = false;
		this.isFinalizing = false;
		this.points = [];
		this.paths = [{closed: false, points: this.points}];
		this.previewPoint = null;
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
		this.paths = [{closed: false, points: this.points}];
		this.previewPoint = null;
		this.update();
	}

	clear() {
		this.points = [];
		this.paths = [{closed: false, points: this.points}];
		this.previewPoint = null;
		this.update();
		this.dispatchEvent({type: "marker_removed", measurement: this});
	}

	getRenderablePaths() {
		if (!this.previewPoint || this.points.length === 0) {
			return this.paths;
		}

		return [{
			closed: false,
			points: [...this.points, {position: this.previewPoint}],
		}];
	}
}
