import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";
import {CAD_VECTOR_COORDINATE_SPACE, CadVector} from "./CadVector.js";

export class CadVectorTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.scene = new THREE.Scene();
		this.scene.name = "scene_cad_vector";

		this.onMeasurementAdded = this.onMeasurementAdded.bind(this);
		this.onMeasurementRemoved = this.onMeasurementRemoved.bind(this);
		this.onSceneChanged = this.onSceneChanged.bind(this);
		this.onPointCloudAdded = this.onPointCloudAdded.bind(this);
		this.onPointCloudOffsetChanged = this.onPointCloudOffsetChanged.bind(this);
		this.update = this.update.bind(this);
		this.render = this.render.bind(this);

		this.attachScene(viewer.scene);
		viewer.addEventListener("scene_changed", this.onSceneChanged);
		viewer.addEventListener("update", this.update);
		viewer.addEventListener("render.pass.perspective_overlay", this.render);
	}

	attachScene(scene) {
		for (const measurement of scene.measurements) {
			this.onMeasurementAdded({measurement});
		}
		scene.addEventListener("measurement_added", this.onMeasurementAdded);
		scene.addEventListener("measurement_removed", this.onMeasurementRemoved);
		scene.addEventListener("pointcloud_added", this.onPointCloudAdded);
		scene.addEventListener("pointcloud_offset_changed", this.onPointCloudOffsetChanged);
	}

	detachScene(scene) {
		scene.removeEventListener("measurement_added", this.onMeasurementAdded);
		scene.removeEventListener("measurement_removed", this.onMeasurementRemoved);
		scene.removeEventListener("pointcloud_added", this.onPointCloudAdded);
		scene.removeEventListener("pointcloud_offset_changed", this.onPointCloudOffsetChanged);
	}

	onMeasurementAdded(event) {
		if (event.measurement?.isCadVector && !event.measurement.isAxisLineMarker) {
			this.scene.add(event.measurement);
		}
	}

	onMeasurementRemoved(event) {
		if (!event.measurement?.isCadVector || event.measurement.isAxisLineMarker) {
			return;
		}
		this.scene.remove(event.measurement);
		event.measurement.dispose?.();
	}

	onSceneChanged(event) {
		if (event.oldScene) {
			this.detachScene(event.oldScene);
		}
		this.scene.clear();
		this.attachScene(event.scene);
	}

	onPointCloudAdded() {
		this.alignSourceVectors();
	}

	onPointCloudOffsetChanged(event) {
		for (const vector of this.getCadVectors()) {
			vector.markSourceOffset(event.nextOffset);
		}
	}

	alignSourceVectors() {
		const offset = this.viewer.scene.getPointCloudCoordinateOffset?.() ?? new THREE.Vector3();
		for (const vector of this.getCadVectors()) {
			vector.applySourceOffset(offset);
		}
	}

	importVectors(records) {
		const imported = [];
		for (const record of Array.isArray(records) ? records : [records]) {
			if (!Array.isArray(record?.paths)) {
				continue;
			}

			const existing = this.find(record.uuid);
			if (existing) {
				existing.visible = record.visible !== false;
				if (existing.isAxisLineMarker && record.paths.length === 1) {
					existing.setFinalPoints(record.paths[0].points ?? []);
				} else if (!existing.isAxisLineMarker) {
					existing.name = record.name ?? existing.name;
					existing.vectorType = record.vectorType ?? existing.vectorType;
					existing.coordinateSpace = record.coordinateSpace ?? CAD_VECTOR_COORDINATE_SPACE.SCENE;
					existing.appliedSourceOffset.set(0, 0, 0);
					existing.setPaths(record.paths);
					existing.applySourceOffset(
						this.viewer.scene.getPointCloudCoordinateOffset?.() ?? new THREE.Vector3(),
					);
				}
				imported.push(existing);
				continue;
			}

			const vector = new CadVector({
				uuid: record.uuid,
				name: record.name,
				vectorType: record.vectorType,
				visible: record.visible !== false,
				coordinateSpace: record.coordinateSpace,
				paths: record.paths,
			});
			if (vector.paths.length === 0) {
				vector.dispose();
				continue;
			}
			vector.applySourceOffset(
				this.viewer.scene.getPointCloudCoordinateOffset?.() ?? new THREE.Vector3(),
			);
			this.viewer.scene.addMeasurement(vector);
			imported.push(vector);
		}
		return imported;
	}

	getCadVectors() {
		return this.viewer.scene.measurements.filter(
			(measurement) => measurement.isCadVector && !measurement.isAxisLineMarker,
		);
	}

	find(vectorOrUuid) {
		if (vectorOrUuid?.isCadVector) {
			return vectorOrUuid;
		}
		return this.viewer.scene.measurements.find(
			(measurement) => measurement.isCadVector && measurement.uuid === vectorOrUuid,
		) ?? null;
	}

	setVisible(vectorOrUuid, visible) {
		const vector = this.find(vectorOrUuid);
		if (!vector) {
			return false;
		}
		vector.visible = Boolean(visible);
		vector.dispatchEvent({type: "visibility_changed", measurement: vector});
		return true;
	}

	remove(vectorOrUuid) {
		const vector = this.find(vectorOrUuid);
		if (!vector) {
			return false;
		}
		this.viewer.scene.removeMeasurement(vector);
		return true;
	}

	update() {
		const size = this.renderer.getSize(new THREE.Vector2());
		const width = size.width ?? size.x;
		const height = size.height ?? size.y;
		for (const vector of this.getCadVectors()) {
			vector.updateResolution(width, height);
		}
	}

	render() {
		this.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	dispose() {
		this.detachScene(this.viewer.scene);
		this.viewer.removeEventListener("scene_changed", this.onSceneChanged);
		this.viewer.removeEventListener("update", this.update);
		this.viewer.removeEventListener("render.pass.perspective_overlay", this.render);
		for (const vector of this.getCadVectors()) {
			vector.dispose?.();
		}
		this.scene.clear();
	}
}
