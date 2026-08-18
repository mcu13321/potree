import * as THREE from "../../libs/three.js/build/three.module.js";
import {LineMaterial} from "../../libs/three.js/lines/LineMaterial.js";
import {LineSegments2} from "../../libs/three.js/lines/LineSegments2.js";
import {LineSegmentsGeometry} from "../../libs/three.js/lines/LineSegmentsGeometry.js";

export const CAD_VECTOR_TYPE = "CadVector";
export const CAD_VECTOR_COORDINATE_SPACE = Object.freeze({
	SCENE: "scene",
	SOURCE: "source",
});

function toVector3(value) {
	let vector;
	if (value?.position?.isVector3) {
		vector = value.position.clone();
	} else if (value?.isVector3) {
		vector = value.clone();
	} else if (Array.isArray(value)) {
		vector = new THREE.Vector3(...value);
	} else {
		vector = new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
	}

	return [vector.x, vector.y, vector.z].every(Number.isFinite) ? vector : null;
}

function normalizePoint(value) {
	const position = toVector3(value);
	if (!position) {
		return null;
	}
	return {
		position,
		pointcloud: value?.pointcloud ?? null,
	};
}

function normalizePath(path = {}) {
	return {
		...path,
		closed: path.closed === true,
		points: (path.points ?? []).map(normalizePoint).filter(Boolean),
	};
}

function positionsEqual(left, right) {
	return left.distanceToSquared(right) <= Number.EPSILON;
}

export class CadVector extends THREE.Object3D {
	constructor({
		uuid,
		name,
		vectorType = "axisLine",
		visible = true,
		coordinateSpace = CAD_VECTOR_COORDINATE_SPACE.SCENE,
		paths = [],
	} = {}) {
		super();

		if (uuid) {
			this.uuid = uuid;
		}
		this.name = name ?? vectorType;
		this.vectorType = vectorType;
		this.coordinateSpace = coordinateSpace;
		this.isCadVector = true;
		this.finished = true;
		this.isFinished = true;
		this.visible = visible;
		this.color = new THREE.Color(0xffffff);
		this.paths = [];
		this.points = [];
		this.appliedSourceOffset = new THREE.Vector3();

		this.showDistances = false;
		this.showCoordinates = false;
		this.showArea = false;
		this.closed = false;
		this.showAngles = false;
		this.showHeight = false;
		this.showCircle = false;
		this.showAzimuth = false;
		this.showEdges = true;

		const geometry = new LineSegmentsGeometry();
		geometry.setPositions([0, 0, 0, 0, 0, 0]);
		const material = new LineMaterial({
			color: 0xffffff,
			linewidth: 2,
			resolution: new THREE.Vector2(1000, 1000),
		});
		material.depthTest = false;
		material.depthWrite = false;

		this.line = new LineSegments2(geometry, material);
		this.line.frustumCulled = false;
		this.line.visible = false;
		this.add(this.line);
		this.setPaths(paths);
	}

	setPaths(paths = []) {
		this.paths = paths.map(normalizePath).filter((path) => path.points.length >= 2);
		this.points = this.paths.flatMap((path) => path.points);
		this.update();
	}

	getRenderablePaths() {
		return this.paths;
	}

	getPathData() {
		return this.paths.map((path) => ({
			...path,
			points: path.points.map((point) => point.position.toArray()),
		}));
	}

	applySourceOffset(offset) {
		if (this.coordinateSpace !== CAD_VECTOR_COORDINATE_SPACE.SOURCE || !offset?.isVector3) {
			return;
		}

		const delta = offset.clone().sub(this.appliedSourceOffset);
		if (delta.lengthSq() === 0) {
			return;
		}

		this.points.forEach((point) => point.position.add(delta));
		this.appliedSourceOffset.copy(offset);
		this.update();
	}

	markSourceOffset(offset) {
		if (this.coordinateSpace === CAD_VECTOR_COORDINATE_SPACE.SOURCE && offset?.isVector3) {
			this.appliedSourceOffset.copy(offset);
		}
	}

	updateResolution(width, height) {
		this.line.material.resolution.set(Math.max(width, 1), Math.max(height, 1));
	}

	update() {
		const segmentPositions = [];
		for (const path of this.getRenderablePaths()) {
			const positions = path.points.map((point) => point.position ?? point);
			for (let index = 1; index < positions.length; index++) {
				segmentPositions.push(...positions[index - 1].toArray(), ...positions[index].toArray());
			}
			if (
				path.closed === true &&
				positions.length > 2 &&
				!positionsEqual(positions[0], positions[positions.length - 1])
			) {
				segmentPositions.push(...positions[positions.length - 1].toArray(), ...positions[0].toArray());
			}
		}

		if (segmentPositions.length === 0) {
			this.line.visible = false;
			return;
		}

		this.line.geometry.setPositions(segmentPositions);
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
