import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";
import {
	AXIS_LINE_DEFAULT_XY_TOLERANCES,
	AxisLineMarker,
	selectAxisLineLowestPoint,
} from "./AxisLineMarker.js";

const CANCELLED_ERROR_NAME = "AxisLineResolutionCancelledError";
const AXIS_LINE_XY_TOLERANCE_STAGES = Object.freeze([
	AXIS_LINE_DEFAULT_XY_TOLERANCES,
	Object.freeze([0.5]),
	Object.freeze([1.0]),
]);

function createCancelledError() {
	const error = new Error("Axis-line point resolution was cancelled.");
	error.name = CANCELLED_ERROR_NAME;
	return error;
}

function toVector3(value) {
	if (value?.isVector3) {
		return value.clone();
	}
	if (Array.isArray(value)) {
		return new THREE.Vector3(...value);
	}
	return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

export class AxisLineMarkerTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.scene = new THREE.Scene();
		this.scene.name = "scene_axis_line_marker";
		this.activeMarker = null;
		this.paused = false;
		this.pointerDown = null;
		this.previewFrame = null;
		this.previewPosition = null;
		this.previewHit = null;
		this.profileRequests = new Set();
		this.cameraLock = null;

		this.onMeasurementAdded = this.onMeasurementAdded.bind(this);
		this.onMeasurementRemoved = this.onMeasurementRemoved.bind(this);
		this.onSceneChanged = this.onSceneChanged.bind(this);
		this.onMouseDown = this.onMouseDown.bind(this);
		this.onMouseUp = this.onMouseUp.bind(this);
		this.onMouseMove = this.onMouseMove.bind(this);
		this.onContextMenu = this.onContextMenu.bind(this);
		this.update = this.update.bind(this);
		this.render = this.render.bind(this);

		for (const measurement of viewer.scene.measurements) {
			this.onMeasurementAdded({measurement});
		}

		viewer.scene.addEventListener("measurement_added", this.onMeasurementAdded);
		viewer.scene.addEventListener("measurement_removed", this.onMeasurementRemoved);
		viewer.addEventListener("scene_changed", this.onSceneChanged);
		viewer.addEventListener("update", this.update);
		viewer.addEventListener("render.pass.perspective_overlay", this.render);

		const domElement = this.renderer.domElement;
		domElement.addEventListener("mousedown", this.onMouseDown);
		domElement.addEventListener("mouseup", this.onMouseUp);
		domElement.addEventListener("mousemove", this.onMouseMove);
		domElement.addEventListener("contextmenu", this.onContextMenu);
	}

	onMeasurementAdded(event) {
		if (event.measurement?.isAxisLineMarker) {
			this.scene.add(event.measurement);
		}
	}

	onMeasurementRemoved(event) {
		if (!event.measurement?.isAxisLineMarker) {
			return;
		}

		this.scene.remove(event.measurement);
		if (event.measurement !== this.activeMarker) {
			event.measurement.dispose?.();
		}
	}

	onSceneChanged(event) {
		this.stopInsertion({discardDraft: true, reason: "scene_changed"});
		if (event.oldScene) {
			event.oldScene.removeEventListener("measurement_added", this.onMeasurementAdded);
			event.oldScene.removeEventListener("measurement_removed", this.onMeasurementRemoved);
		}

		this.scene.clear();
		event.scene.addEventListener("measurement_added", this.onMeasurementAdded);
		event.scene.addEventListener("measurement_removed", this.onMeasurementRemoved);
		for (const measurement of event.scene.measurements) {
			this.onMeasurementAdded({measurement});
		}
	}

	startInsertion() {
		this.stopInsertion({discardDraft: true, reason: "restarted"});
		this.viewer.measuringTool?.stopInsertion?.();
		this.lockTopView();

		const marker = new AxisLineMarker();
		marker.reStart = () => this.restartInsertion(marker);
		marker._axisLineFinishListener = () => {
			void this.finishInsertion();
		};
		marker.addEventListener("measure_finished", marker._axisLineFinishListener);

		this.activeMarker = marker;
		this.paused = false;
		this.viewer.scene.addMeasurement(marker);
		this.viewer.scene.dispatchEvent({
			type: "measurement_selected",
			measurement: marker,
		});
		this.dispatchEvent({type: "start_inserting_axis_line", measurement: marker});

		return marker;
	}

	restartInsertion(marker = this.activeMarker) {
		if (!marker || marker !== this.activeMarker) {
			return;
		}

		this.cancelProfileRequests();
		this.previewHit = null;
		marker.finished = false;
		marker.isFinished = false;
		marker.isFinalizing = false;
		marker.clear();
		this.paused = false;
		this.viewer.scene.dispatchEvent({
			type: "measurement_selected",
			measurement: marker,
		});
	}

	stopInsertion({discardDraft = true, reason = "cancelled"} = {}) {
		this.cancelPreviewFrame();
		this.cancelProfileRequests();

		const marker = this.activeMarker;
		if (marker) {
			marker.setPreviewPoint(null);
			if (marker._axisLineFinishListener) {
				marker.removeEventListener("measure_finished", marker._axisLineFinishListener);
				delete marker._axisLineFinishListener;
			}
			if (discardDraft && !marker.finished) {
				this.viewer.scene.removeMeasurement(marker);
				marker.dispose?.();
			}
		}

		this.activeMarker = null;
		this.paused = false;
		this.pointerDown = null;
		this.previewHit = null;
		this.unlockTopView();
		if (marker || this.cameraLock) {
			this.dispatchEvent({type: "axis_line_deactivated", reason, measurement: marker});
		}
	}

	onMouseDown(event) {
		if (!this.activeMarker || this.activeMarker.isFinalizing) {
			return;
		}

		this.pointerDown = {
			button: event.button,
			position: this.viewer.inputHandler.getEventLocalPosition(event),
		};
	}

	onMouseUp(event) {
		const marker = this.activeMarker;
		if (!marker || marker.isFinalizing || !this.pointerDown) {
			return;
		}

		const down = this.pointerDown;
		this.pointerDown = null;
		const end = this.viewer.inputHandler.getEventLocalPosition(event);
		const isTap = down.button === event.button &&
			this.viewer.inputHandler.isTapGesture("mouse", down.position, end);
		if (
			down.button !== event.button ||
			!isTap
		) {
			return;
		}

		if (event.button === 2) {
			this.paused = true;
			this.previewHit = null;
			marker.setPreviewPoint(null);
			return;
		}
		if (event.button !== 0) {
			return;
		}

		const cachedHit = this.previewHit &&
			this.viewer.inputHandler.isTapGesture(
				"mouse",
				this.previewHit.screenPosition,
				end,
			)
				? this.previewHit
				: null;
		const hoveredPoint = cachedHit ?? this.viewer.inputHandler.refreshHoveredPoint(end);
		if (!hoveredPoint?.location) {
			return;
		}

		marker.addPoint(hoveredPoint.location, hoveredPoint.pointcloud ?? null);
		this.paused = false;
		this.previewHit = {
			location: hoveredPoint.location.clone(),
			pointcloud: hoveredPoint.pointcloud ?? null,
			screenPosition: end.clone(),
		};
		marker.setPreviewPoint(hoveredPoint.location);
		this.viewer.scene.dispatchEvent({
			type: "measurement_selected",
			measurement: marker,
		});
	}

	onMouseMove(event) {
		if (
			!this.activeMarker ||
			this.activeMarker.isFinalizing ||
			this.paused ||
			this.activeMarker.points.length === 0
		) {
			return;
		}

		this.previewPosition = this.viewer.inputHandler.getEventLocalPosition(event);
		if (this.previewFrame !== null) {
			return;
		}

		const requestFrame = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
		this.previewFrame = requestFrame(() => {
			this.previewFrame = null;
			if (!this.activeMarker || this.paused || !this.previewPosition) {
				return;
			}
			const screenPosition = this.previewPosition.clone();
			const hoveredPoint = this.viewer.inputHandler.refreshHoveredPoint(screenPosition);
			// Reuse this proven hover hit when mouseup picking transiently misses the point cloud.
			this.previewHit = hoveredPoint?.location
				? {
					location: hoveredPoint.location.clone(),
					pointcloud: hoveredPoint.pointcloud ?? null,
						screenPosition,
					}
				: null;
			this.activeMarker.setPreviewPoint(hoveredPoint?.location ?? null);
		});
	}

	onContextMenu(event) {
		if (this.activeMarker) {
			event.preventDefault();
		}
	}

	lockTopView() {
		if (this.cameraLock) {
			return;
		}

		const controls = this.viewer.controls?.usesRigidTopViewFit === true
			? this.viewer.controls
			: this.viewer.cameraControls;
		if (!controls) {
			return;
		}

		this.cameraLock = {
			controls,
			minPolarAngle: controls.minPolarAngle,
			maxPolarAngle: controls.maxPolarAngle,
			polarRotateSpeed: controls.polarRotateSpeed,
		};
		this.viewer.setTopView4CameraControls(false);
		controls.minPolarAngle = Math.PI;
		controls.maxPolarAngle = Math.PI;
		controls.polarRotateSpeed = 0;
	}

	unlockTopView() {
		if (!this.cameraLock) {
			return;
		}

		const {controls, minPolarAngle, maxPolarAngle, polarRotateSpeed} = this.cameraLock;
		controls.minPolarAngle = minPolarAngle;
		controls.maxPolarAngle = maxPolarAngle;
		controls.polarRotateSpeed = polarRotateSpeed;
		this.cameraLock = null;
	}

	async finishInsertion() {
		const marker = this.activeMarker;
		if (!marker || marker.points.length < 2 || marker.isFinalizing) {
			return false;
		}

		marker.isFinalizing = true;
		marker.setPreviewPoint(null);
		marker.dispatchEvent({type: "finalizing_changed", measurement: marker});

		try {
			const finalPoints = await Promise.all(
				marker.points.map((point) => this.resolveLowestPoint(point)),
			);
			if (marker !== this.activeMarker) {
				throw createCancelledError();
			}

			marker.setFinalPoints(finalPoints);
			marker.finished = true;
			marker.isFinished = true;
			marker.isFinalizing = false;
			// Persist the completed axis line before deactivating its drawing session.
			this.viewer.scene.addMeasurement2platform(marker);
			marker.dispatchEvent({type: "finalizing_changed", measurement: marker});
			this.dispatchEvent({type: "axis_line_completed", measurement: marker});
			this.stopInsertion({discardDraft: false, reason: "completed"});
			return true;
		} catch (error) {
			if (error?.name === CANCELLED_ERROR_NAME) {
				return false;
			}

			if (marker === this.activeMarker) {
				marker.isFinalizing = false;
				marker.dispatchEvent({type: "finalizing_changed", measurement: marker});
				this.dispatchEvent({
					type: "axis_line_resolve_failed",
					measurement: marker,
					error,
				});
			}
			return false;
		}
	}

	async resolveLowestPoint(point) {
		if (!point.pointcloud?.getPointsInProfile) {
			throw new Error("The selected axis-line point has no point cloud.");
		}

		for (const tolerances of AXIS_LINE_XY_TOLERANCE_STAGES) {
			const selected = await this.resolveLowestPointInStage(point, tolerances);
			if (selected) {
				return selected;
			}
		}

		throw new Error("No point-cloud point matches the axis-line XY tolerance.");
	}

	resolveLowestPointInStage(point, tolerances) {
		const origin = point.position.clone();
		const pointcloud = point.pointcloud;
		const maxTolerance = tolerances[tolerances.length - 1];
		const margin = Math.max(maxTolerance * 0.01, 0.0001);
		const profile = {
			points: [
				origin.clone().add(new THREE.Vector3(-maxTolerance - margin, 0, 0)),
				origin.clone().add(new THREE.Vector3(maxTolerance + margin, 0, 0)),
			],
			width: (maxTolerance + margin) * 2,
		};

		return new Promise((resolve, reject) => {
			const candidates = [];
			let settled = false;
			let request = null;
			const finish = (callback) => {
				if (settled) {
					return;
				}
				settled = true;
				if (request) {
					this.profileRequests.delete(request);
				}
				callback();
			};

			request = pointcloud.getPointsInProfile(profile, null, {
				onProgress: (event) => {
					for (const segment of event.points?.segments ?? []) {
						const positions = segment.points?.data?.position;
						if (!positions) {
							continue;
						}
						for (let index = 0; index < positions.length; index += 3) {
							candidates.push(new THREE.Vector3(
								positions[index] + pointcloud.position.x,
								positions[index + 1] + pointcloud.position.y,
								positions[index + 2] + pointcloud.position.z,
							));
						}
					}
				},
				onFinish: () => finish(() => {
					resolve(selectAxisLineLowestPoint(origin, candidates, tolerances));
				}),
				onCancel: () => finish(() => reject(createCancelledError())),
			});
			if (!settled) {
				this.profileRequests.add(request);
			}
		});
	}

	cancelProfileRequests() {
		const requests = [...this.profileRequests];
		this.profileRequests.clear();
		for (const request of requests) {
			request.cancel?.();
		}
	}

	cancelPreviewFrame() {
		if (this.previewFrame === null) {
			return;
		}
		const cancelFrame = globalThis.cancelAnimationFrame ?? clearTimeout;
		cancelFrame(this.previewFrame);
		this.previewFrame = null;
		this.previewPosition = null;
	}

	importAxisLines(records) {
		const imported = [];
		for (const record of Array.isArray(records) ? records : [records]) {
			if (!Array.isArray(record?.points) || record.points.length < 2) {
				continue;
			}

			const marker = new AxisLineMarker({uuid: record.uuid, visible: record.visible !== false});
			marker.setFinalPoints(record.points.map(toVector3));
			marker.finished = true;
			marker.isFinished = true;
			this.viewer.scene.addMeasurement(marker);
			imported.push(marker);
		}
		return imported;
	}

	getAxisLines() {
		return this.viewer.scene.measurements.filter((measurement) => measurement.isAxisLineMarker);
	}

	setVisible(markerOrUuid, visible) {
		const marker = this.findMarker(markerOrUuid);
		if (!marker) {
			return false;
		}
		marker.visible = Boolean(visible);
		marker.dispatchEvent({type: "visibility_changed", measurement: marker});
		return true;
	}

	remove(markerOrUuid) {
		const marker = this.findMarker(markerOrUuid);
		if (!marker) {
			return false;
		}
		if (marker === this.activeMarker) {
			this.stopInsertion({discardDraft: true, reason: "removed"});
		} else {
			this.viewer.scene.removeMeasurement(marker);
		}
		return true;
	}

	findMarker(markerOrUuid) {
		if (markerOrUuid?.isAxisLineMarker) {
			return markerOrUuid;
		}
		return this.getAxisLines().find((marker) => marker.uuid === markerOrUuid) ?? null;
	}

	update() {
		const size = this.renderer.getSize(new THREE.Vector2());
		const width = size.width ?? size.x;
		const height = size.height ?? size.y;
		for (const marker of this.getAxisLines()) {
			marker.updateResolution(width, height);
		}
	}

	render() {
		this.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	dispose() {
		this.stopInsertion({discardDraft: true, reason: "disposed"});
		this.viewer.scene.removeEventListener("measurement_added", this.onMeasurementAdded);
		this.viewer.scene.removeEventListener("measurement_removed", this.onMeasurementRemoved);
		this.viewer.removeEventListener("scene_changed", this.onSceneChanged);
		this.viewer.removeEventListener("update", this.update);
		this.viewer.removeEventListener("render.pass.perspective_overlay", this.render);
		const domElement = this.renderer.domElement;
		domElement.removeEventListener("mousedown", this.onMouseDown);
		domElement.removeEventListener("mouseup", this.onMouseUp);
		domElement.removeEventListener("mousemove", this.onMouseMove);
		domElement.removeEventListener("contextmenu", this.onContextMenu);
		for (const marker of this.getAxisLines()) {
			marker.dispose?.();
		}
		this.scene.clear();
	}
}
