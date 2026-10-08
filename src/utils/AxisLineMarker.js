import * as THREE from "../../libs/three.js/build/three.module.js";
import {CAD_VECTOR_COORDINATE_SPACE, CadVector} from "./CadVector.js";

export const AXIS_LINE_NAME = "axisLine";
export const AXIS_LINE_DEFAULT_XY_TOLERANCES = Object.freeze([0.02, 0.05, 0.1, 0.2]);
export const AXIS_LINE_XY_TOLERANCES = Object.freeze([...AXIS_LINE_DEFAULT_XY_TOLERANCES, 0.5, 1.0]);
const BOTTOM_BAND_RADII = [0.1, 0.2, 0.5, 1.0];
const BOTTOM_BIN_HEIGHT = 0.15;
const BOTTOM_BIN_SHIFTS = [0, BOTTOM_BIN_HEIGHT / 2];
const BOTTOM_BAND_MARGIN = 0.1;
const MIN_TOP_TO_BOTTOM_DROP = 0.3;

function toVector3(value) {
	if (value?.isVector3) {
		return value.clone();
	}
	if (Array.isArray(value)) {
		return new THREE.Vector3(...value);
	}
	return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function findSupportedBottomBand(origin, candidates, radius) {
	const radiusSquared = radius * radius;
	const bins = new Map();
	for (const candidate of candidates) {
		const dx = candidate.x - origin.x;
		const dy = candidate.y - origin.y;
		if (dx * dx + dy * dy > radiusSquared || candidate.z > origin.z - MIN_TOP_TO_BOTTOM_DROP) {
			continue;
		}
		// Two staggered histograms prevent a floor cluster from splitting at a bin edge.
		for (const shift of BOTTOM_BIN_SHIFTS) {
			const key = `${shift}:${Math.floor((candidate.z + shift) / BOTTOM_BIN_HEIGHT)}`;
			let bin = bins.get(key);
			if (!bin) {
				bin = {count: 0, cells: new Set(), minZ: Infinity, maxZ: -Infinity};
				bins.set(key, bin);
			}
			bin.count++;
			bin.cells.add(`${Math.floor(candidate.x / 0.02)}:${Math.floor(candidate.y / 0.02)}`);
			bin.minZ = Math.min(bin.minZ, candidate.z);
			bin.maxZ = Math.max(bin.maxZ, candidate.z);
		}
	}
	let lowest = null;
	for (const bin of bins.values()) {
		if (bin.count >= 3 && bin.cells.size >= 2 && (!lowest || bin.minZ < lowest.minZ)) {
			lowest = bin;
		}
	}
	return lowest ? [lowest.minZ - BOTTOM_BAND_MARGIN, lowest.maxZ + BOTTOM_BAND_MARGIN] : null;
}

/** Selects a supported local floor before falling back to the lowest loaded point. */
export function selectAxisLineLoadedBottomPoint(origin, candidates) {
	const finite = candidates.filter((candidate) => {
		if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) return false;
		const dx = candidate.x - origin.x;
		const dy = candidate.y - origin.y;
		return dx * dx + dy * dy <= 1;
	});
	if (!finite.length) return null;

	let band = null;
	for (const radius of BOTTOM_BAND_RADII) {
		band = findSupportedBottomBand(origin, finite, radius);
		if (band) break;
	}
	if (band) {
		for (const radius of AXIS_LINE_XY_TOLERANCES) {
			const radiusSquared = radius * radius;
			let selected = null;
			let selectedDistance = Infinity;
			for (const point of finite) {
				const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
				if (distance > radiusSquared || point.z < band[0] || point.z > band[1]) continue;
				if (distance < selectedDistance || (distance === selectedDistance && point.z < selected.z)) {
					selected = point;
					selectedDistance = distance;
				}
			}
			if (selected) return selected.clone();
		}
	}
	// Loaded-only fallback preserves completion when the floor has sparse support.
	return finite.reduce((lowest, point) => point.z < lowest.z ? point : lowest).clone();
}

/** Keeps the original selector available for callers outside the axis drawing workflow. */
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
			if (distanceSquared > toleranceSquared) continue;
			if (!selected || candidate.z < selected.z ||
				(candidate.z === selected.z && distanceSquared < selectedDistanceSquared)) {
				selected = candidate;
				selectedDistanceSquared = distanceSquared;
			}
		}
		if (selected) return selected.clone();
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
