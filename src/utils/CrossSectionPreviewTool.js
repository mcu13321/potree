import * as THREE from "../../libs/three.js/build/three.module.js";
import {LineMaterial} from "../../libs/three.js/lines/LineMaterial.js";
import {LineSegments2} from "../../libs/three.js/lines/LineSegments2.js";
import {LineSegmentsGeometry} from "../../libs/three.js/lines/LineSegmentsGeometry.js";

const EPSILON = 1e-7;
const PREVIEW_GROUP_NAME = "potree_cross_section_preview";
const NORMAL_SECTION_COLOR = 0xf25f5f;
const ACTIVE_SECTION_COLOR = 0xef4444;
const PREVIEW_AXIS_COLOR = 0xfacc15;
const ACTIVE_SECTION_OPACITY = 0.2;
const FRAME_SIZE_PADDING = 1.1;
const ENVELOPE_PERCENTILE = 0.02;
const LOCAL_ENVELOPE_PROFILE_MAX_DEPTH = 3;

function toFiniteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

// Normalize host-provided resource keys before exact point-cloud matching.
function normalizePointCloudBaseUrl(value) {
	return typeof value === "string"
		? value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
		: "";
}

function isUsableVector(value) {
	return value?.isVector3 && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function collectAxisPaths(measurement) {
	const paths = measurement?.getRenderablePaths?.() ?? measurement?.paths ?? [];
	return paths
		.map((path) => (path?.points ?? [])
			.map((point) => point?.position ?? point)
			.filter(isUsableVector))
		.filter((points) => points.length >= 2);
}

function resolveSegmentTangent(points, segmentIndex) {
	for (let offset = 0; offset < points.length - 1; offset++) {
		const forwardIndex = segmentIndex + offset;
		if (forwardIndex < points.length - 1) {
			const forward = points[forwardIndex + 1].clone().sub(points[forwardIndex]);
			forward.z = 0;
			if (forward.lengthSq() > EPSILON) {
				return forward.normalize();
			}
		}

		const backwardIndex = segmentIndex - offset;
		if (backwardIndex >= 0) {
			const backward = points[backwardIndex + 1].clone().sub(points[backwardIndex]);
			backward.z = 0;
			if (backward.lengthSq() > EPSILON) {
				return backward.normalize();
			}
		}
	}
	return null;
}

function buildAxisSegments(paths) {
	const segments = [];
	let totalLength = 0;
	for (const points of paths) {
		for (let index = 0; index < points.length - 1; index++) {
			const length = points[index].distanceTo(points[index + 1]);
			if (length <= EPSILON) {
				continue;
			}
			segments.push({
				length,
				pathPoints: points,
				segmentIndex: index,
			});
			totalLength += length;
		}
	}
	return {segments, totalLength};
}

function resolveStation(segments, station) {
	let travelled = 0;
	for (const segment of segments) {
		if (station <= travelled + segment.length + EPSILON) {
			const ratio = THREE.MathUtils.clamp((station - travelled) / segment.length, 0, 1);
			return {
				position: segment.pathPoints[segment.segmentIndex]
					.clone()
					.lerp(segment.pathPoints[segment.segmentIndex + 1], ratio),
				pathPoints: segment.pathPoints,
				segmentIndex: segment.segmentIndex,
			};
		}
		travelled += segment.length;
	}
	return null;
}

/**
 * Creates vertical cross-section squares directly in Potree scene coordinates.
 *
 * @param {{ axisPaths?: THREE.Vector3[][], axisPoints?: THREE.Vector3[], frameSideLength?: number, sectionStart: number, sectionEnd: number, sectionStep: number, zRange: number }} options
 * @returns {{ corners: THREE.Vector3[], position: THREE.Vector3, tangent: THREE.Vector3 }[]}
 */
export function buildCrossSectionPreviewFrames({
	axisPaths,
	axisPoints = [],
	frameSideLength,
	sectionStart,
	sectionEnd,
	sectionStep,
	zRange,
} = {}) {
	const start = toFiniteNumber(sectionStart);
	const end = toFiniteNumber(sectionEnd);
	const step = toFiniteNumber(sectionStep);
	const height = toFiniteNumber(zRange);
	const sideLength = frameSideLength === null || frameSideLength === undefined
		? null
		: toFiniteNumber(frameSideLength);
	const paths = (Array.isArray(axisPaths) && axisPaths.length > 0 ? axisPaths : [axisPoints])
		.map((points) => points.filter(isUsableVector))
		.filter((points) => points.length >= 2);
	if (
		paths.length === 0 ||
		start === null ||
		end === null ||
		step === null ||
		(height === null && sideLength === null) ||
		start < 0 ||
		end < start ||
		step <= 0 ||
		(height !== null && height <= EPSILON) ||
		(sideLength !== null && sideLength <= EPSILON)
	) {
		return [];
	}

	const {segments, totalLength: axisLength} = buildAxisSegments(paths);
	if (axisLength <= EPSILON || end > axisLength + EPSILON) {
		return [];
	}

	const frameCount = Math.floor((end - start) / step) + 1;
	const frameSize = sideLength ?? height;
	const halfWidth = frameSize / 2;
	const frames = [];
	for (let index = 0; index < frameCount; index++) {
		const station = start + index * step;
		const resolved = resolveStation(segments, station);
		if (!resolved) {
			continue;
		}

		const tangent = resolveSegmentTangent(resolved.pathPoints, resolved.segmentIndex);
		if (!tangent) {
			continue;
		}

		const sideways = new THREE.Vector3(-tangent.y, tangent.x, 0).multiplyScalar(halfWidth);
		const vertical = new THREE.Vector3(0, 0, frameSize);
		const lowerLeft = resolved.position.clone().sub(sideways);
		const lowerRight = resolved.position.clone().add(sideways);
		frames.push({
			position: resolved.position,
			tangent,
			corners: [
				lowerLeft,
				lowerRight,
				lowerRight.clone().add(vertical),
				lowerLeft.clone().add(vertical),
			],
		});
	}

	return frames;
}

function getPercentile(values, percentile) {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.round((sorted.length - 1) * percentile);
	return sorted[index];
}

/**
 * Estimates one shared square size from the representative local vertical envelope.
 *
 * @param {THREE.Vector3[]} points
 * @returns {number | null}
 */
export function estimateCrossSectionFrameSideLength(points) {
	if (!Array.isArray(points) || points.length < 2) {
		return null;
	}

	const vertical = [];
	for (const point of points) {
		if (!isUsableVector(point)) {
			continue;
		}
		vertical.push(point.z);
	}
	if (vertical.length < 2) {
		return null;
	}

	const lowerPercentile = ENVELOPE_PERCENTILE;
	const upperPercentile = 1 - ENVELOPE_PERCENTILE;
	const height = getPercentile(vertical, upperPercentile) - getPercentile(vertical, lowerPercentile);
	const size = height * FRAME_SIZE_PADDING;
	return size > EPSILON && Number.isFinite(size) ? size : null;
}

function disposeObject(object) {
	object.traverse((child) => {
		child.geometry?.dispose?.();
		if (Array.isArray(child.material)) {
			child.material.forEach((material) => material?.dispose?.());
		} else {
			child.material?.dispose?.();
		}
	});
}

function createSectionLine(positions, color) {
	if (positions.length === 0) {
		return null;
	}
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(positions);
	geometry.computeBoundingSphere();
	const material = new LineMaterial({
		color,
		linewidth: 2,
		resolution: new THREE.Vector2(1, 1),
	});
	material.depthTest = false;
	material.depthWrite = false;
	const line = new LineSegments2(geometry, material);
	line.frustumCulled = false;
	return line;
}

function appendFrameEdges(target, corners) {
	for (let index = 0; index < corners.length; index++) {
		const next = corners[(index + 1) % corners.length];
		target.push(...corners[index].toArray(), ...next.toArray());
	}
}

/**
 * Extrudes a cross-section square along the horizontal axis tangent.
 *
 * @param {{ corners: THREE.Vector3[], tangent: THREE.Vector3 }} frame
 * @param {number} sectionThickness
 * @returns {{ leadingCorners: THREE.Vector3[], trailingCorners: THREE.Vector3[] } | null}
 */
export function buildCrossSectionPreviewVolume(frame, sectionThickness) {
	const thickness = toFiniteNumber(sectionThickness);
	if (!frame || !Array.isArray(frame.corners) || frame.corners.length !== 4 || thickness === null || thickness <= EPSILON) {
		return null;
	}

	const offset = frame.tangent.clone().multiplyScalar(thickness / 2);
	return {
		leadingCorners: frame.corners.map((corner) => corner.clone().add(offset)),
		trailingCorners: frame.corners.map((corner) => corner.clone().sub(offset)),
	};
}

function appendVolumeEdges(target, volume) {
	appendFrameEdges(target, volume.leadingCorners);
	appendFrameEdges(target, volume.trailingCorners);
	for (let index = 0; index < volume.leadingCorners.length; index++) {
		target.push(
			...volume.leadingCorners[index].toArray(),
			...volume.trailingCorners[index].toArray(),
		);
	}
}

function createActiveVolume(volume) {
	if (!volume) {
		return null;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setFromPoints([...volume.leadingCorners, ...volume.trailingCorners]);
	geometry.setIndex([
		0, 1, 2, 0, 2, 3,
		4, 6, 5, 4, 7, 6,
		0, 4, 5, 0, 5, 1,
		1, 5, 6, 1, 6, 2,
		2, 6, 7, 2, 7, 3,
		3, 7, 4, 3, 4, 0,
	]);
	geometry.computeVertexNormals();
	const material = new THREE.MeshBasicMaterial({
		color: ACTIVE_SECTION_COLOR,
		depthTest: false,
		depthWrite: false,
		opacity: ACTIVE_SECTION_OPACITY,
		transparent: true,
		side: THREE.DoubleSide,
	});
	const fill = new THREE.Mesh(geometry, material);
	fill.renderOrder = 1;
	return fill;
}

export class CrossSectionPreviewTool {
	constructor(viewer) {
		this.viewer = viewer;
		this.scene = new THREE.Scene();
		this.scene.name = "scene_cross_section_preview";
		this.group = new THREE.Group();
		this.group.name = PREVIEW_GROUP_NAME;
		this.preview = null;
		this.previewShapeKey = null;
		this.frameSideLength = null;
		this.envelopeRequestToken = 0;
		this.envelopeRequests = new Set();
		this.envelopePending = false;
		this.envelopeResolved = false;
		this.previewAxis = null;
		this.previewAxisColor = null;
		this.previewAxisLineColor = null;
		this.needsFit = false;
		this.pendingGeometry = false;

		this.onSceneChanged = this.onSceneChanged.bind(this);
		this.update = this.update.bind(this);
		this.render = this.render.bind(this);
		this.scene.add(this.group);
		viewer.addEventListener("scene_changed", this.onSceneChanged);
		viewer.addEventListener("update", this.update);
		viewer.addEventListener("render.pass.perspective_overlay", this.render);
	}

	onSceneChanged(event) {
		this.pendingGeometry = Boolean(this.preview);
	}

	setPreview(config) {
		if (!config) {
			this.clear();
			return;
		}

		const preview = {
			activeIndex: Math.max(0, Math.trunc(toFiniteNumber(config.activeIndex) ?? 0)),
			axisUuid: config.axisUuid ?? null,
			mainPointCloudBaseUrl: normalizePointCloudBaseUrl(config.mainPointCloudBaseUrl),
			sectionEnd: toFiniteNumber(config.sectionEnd),
			sectionStart: toFiniteNumber(config.sectionStart),
			sectionStep: toFiniteNumber(config.sectionStep),
			sectionThickness: toFiniteNumber(config.sectionThickness),
		};
		const shapeKey = JSON.stringify({
			axisUuid: preview.axisUuid,
			mainPointCloudBaseUrl: preview.mainPointCloudBaseUrl,
			sectionEnd: preview.sectionEnd,
			sectionStart: preview.sectionStart,
			sectionStep: preview.sectionStep,
			sectionThickness: preview.sectionThickness,
		});
		const isNewShape = shapeKey !== this.previewShapeKey;
		this.needsFit ||= isNewShape;
		if (isNewShape) {
			this.cancelEnvelopeRequests();
			this.frameSideLength = null;
			this.envelopePending = false;
			this.envelopeResolved = false;
		}
		this.previewShapeKey = shapeKey;
		this.preview = preview;
		this.rebuild();
	}

	setActiveIndex(activeIndex) {
		if (!this.preview) {
			return;
		}
		this.preview.activeIndex = Math.max(0, Math.trunc(toFiniteNumber(activeIndex) ?? 0));
		this.rebuild();
	}

	getAxisMeasurement() {
		const measurements = this.viewer.scene?.measurements ?? [];
		if (!this.preview?.axisUuid) {
			return null;
		}
		return measurements.find((measurement) => measurement.uuid === this.preview.axisUuid) ?? null;
	}

	// Select one exact axis-owned point cloud so unrelated scene data cannot affect preview geometry.
	getPreviewPointclouds() {
		const targetBaseUrl = this.preview?.mainPointCloudBaseUrl;
		if (!targetBaseUrl) {
			return [];
		}
		const pointcloud = (this.viewer.scene?.pointclouds ?? []).find(
			(candidate) => candidate?.visible !== false
				&& normalizePointCloudBaseUrl(candidate?.baseUrl) === targetBaseUrl,
		);
		return pointcloud ? [pointcloud] : [];
	}

	getPointCloudBounds(pointclouds = this.getPreviewPointclouds()) {
		if (pointclouds.length === 0) {
			return null;
		}
		const box = this.viewer.scene.getBoundingBox(pointclouds);
		return box?.isBox3 && !box.isEmpty() && Number.isFinite(box.min.z) && Number.isFinite(box.max.z)
			? box
			: null;
	}

	cancelEnvelopeRequests() {
		this.envelopeRequestToken++;
		for (const request of this.envelopeRequests) {
			request.cancel?.();
		}
		this.envelopeRequests.clear();
	}

	setPreviewAxisColor(axis) {
		if (this.previewAxis === axis) {
			return;
		}
		this.restorePreviewAxisColor();
		if (!axis) {
			return;
		}

		this.previewAxis = axis;
		this.previewAxisColor = axis.color?.clone?.() ?? null;
		this.previewAxisLineColor = axis.line?.material?.color?.clone?.() ?? null;
		axis.color?.setHex(PREVIEW_AXIS_COLOR);
		axis.line?.material?.color?.setHex(PREVIEW_AXIS_COLOR);
	}

	restorePreviewAxisColor() {
		if (!this.previewAxis) {
			return;
		}
		if (this.previewAxisColor) {
			this.previewAxis.color?.copy(this.previewAxisColor);
		}
		if (this.previewAxisLineColor) {
			this.previewAxis.line?.material?.color?.copy(this.previewAxisLineColor);
		}
		this.previewAxis = null;
		this.previewAxisColor = null;
		this.previewAxisLineColor = null;
	}

	requestFrameSideLength(frames, pointclouds, pointCloudBounds) {
		if (this.envelopeResolved || this.envelopePending || frames.length === 0 || !pointCloudBounds) {
			return;
		}

		const requestedPointclouds = pointclouds.filter((pointcloud) => pointcloud?.getPointsInProfile);
		if (requestedPointclouds.length === 0) {
			this.envelopeResolved = true;
			return;
		}

		const representativeFrame = frames[Math.floor(frames.length / 2)];
		const boundsSize = pointCloudBounds.getSize(new THREE.Vector3());
		const probeWidth = Math.hypot(boundsSize.x, boundsSize.y);
		const thickness = Math.max(this.preview?.sectionThickness ?? 0, EPSILON);
		if (!representativeFrame || probeWidth <= EPSILON) {
			this.envelopeResolved = true;
			return;
		}

		const offset = representativeFrame.tangent.clone().multiplyScalar(thickness / 2);
		const profile = {
			points: [
				representativeFrame.position.clone().sub(offset),
				representativeFrame.position.clone().add(offset),
			],
			width: probeWidth,
		};
		const samples = [];
		const requestToken = ++this.envelopeRequestToken;
		let pendingRequests = requestedPointclouds.length;
		this.envelopePending = true;
		const finishRequest = (request) => {
			this.envelopeRequests.delete(request);
			pendingRequests--;
			if (pendingRequests !== 0 || requestToken !== this.envelopeRequestToken) {
				return;
			}

			this.envelopePending = false;
			this.envelopeResolved = true;
			const frameSideLength = estimateCrossSectionFrameSideLength(samples);
			if (frameSideLength !== null) {
				this.frameSideLength = frameSideLength;
			}
			this.needsFit = true;
			this.rebuild();
		};

		for (const pointcloud of requestedPointclouds) {
			let request = null;
			const pointcloudPosition = pointcloud.position ?? new THREE.Vector3();
			try {
				request = pointcloud.getPointsInProfile(profile, LOCAL_ENVELOPE_PROFILE_MAX_DEPTH, {
					onProgress: (event) => {
						if (requestToken !== this.envelopeRequestToken) {
							return;
						}
						for (const segment of event.points?.segments ?? []) {
							const positions = segment.points?.data?.position;
							if (!positions) {
								continue;
							}
							for (let index = 0; index < positions.length; index += 3) {
								samples.push(new THREE.Vector3(
									positions[index] + pointcloudPosition.x,
									positions[index + 1] + pointcloudPosition.y,
									positions[index + 2] + pointcloudPosition.z,
								));
							}
						}
					},
					onFinish: () => finishRequest(request),
					onCancel: () => finishRequest(request),
				});
			} catch {
				finishRequest(request);
				continue;
			}
			if (request) {
				this.envelopeRequests.add(request);
			} else {
				finishRequest(request);
			}
		}
	}

	clearGroup() {
		for (const child of [...this.group.children]) {
			this.group.remove(child);
			disposeObject(child);
		}
	}

	rebuild() {
		this.clearGroup();
		const axis = this.getAxisMeasurement();
		this.setPreviewAxisColor(axis);
		const axisPaths = collectAxisPaths(axis);
		const pointclouds = this.getPreviewPointclouds();
		const pointCloudBounds = this.getPointCloudBounds(pointclouds);
		const frames = buildCrossSectionPreviewFrames({
			axisPaths,
			frameSideLength: this.frameSideLength,
			sectionStart: this.preview?.sectionStart,
			sectionEnd: this.preview?.sectionEnd,
			sectionStep: this.preview?.sectionStep,
			zRange: pointCloudBounds ? pointCloudBounds.max.z - pointCloudBounds.min.z : null,
		});
		this.pendingGeometry = Boolean(this.preview) && frames.length === 0;
		if (frames.length === 0) {
			return;
		}
		this.requestFrameSideLength(frames, pointclouds, pointCloudBounds);
		// Render the main-cloud bounds fallback immediately while the local envelope refines asynchronously.

		const normalPositions = [];
		const activeFrame = frames[this.preview.activeIndex] ?? null;
		for (const frame of frames) {
			if (frame !== activeFrame) {
				appendFrameEdges(normalPositions, frame.corners);
			}
		}
		const normalLine = createSectionLine(normalPositions, NORMAL_SECTION_COLOR);
		if (normalLine) {
			this.group.add(normalLine);
		}

		if (activeFrame) {
			const activeVolume = buildCrossSectionPreviewVolume(activeFrame, this.preview.sectionThickness);
			const activePositions = [];
			if (activeVolume) {
				appendVolumeEdges(activePositions, activeVolume);
			} else {
				appendFrameEdges(activePositions, activeFrame.corners);
			}
			const activeLine = createSectionLine(activePositions, ACTIVE_SECTION_COLOR);
			if (activeLine) {
				activeLine.renderOrder = 2;
				this.group.add(activeLine);
			}
			const activeFill = createActiveVolume(activeVolume);
			if (activeFill) {
				this.group.add(activeFill);
			}
		}

		if (this.needsFit) {
			this.fitToPreview(pointCloudBounds);
			this.needsFit = false;
		}
	}

	fitToPreview(pointCloudBounds = this.getPointCloudBounds()) {
		if (!pointCloudBounds) {
			return;
		}
		this.group.updateMatrixWorld(true);
		const bounds = pointCloudBounds.clone().union(new THREE.Box3().setFromObject(this.group));
		const controls = this.viewer.controls?.fitToBox
			? this.viewer.controls
			: this.viewer.cameraControls?.fitToBox
				? this.viewer.cameraControls
				: null;
		if (controls) {
			controls.fitToBox(bounds, false);
		}
		// Never fall back to the global scene fit because unrelated point clouds may be visible.
	}

	update() {
		const size = this.viewer.renderer.getSize(new THREE.Vector2());
		for (const child of this.group.children) {
			if (child.material?.resolution) {
				child.material.resolution.set(Math.max(size.width ?? size.x, 1), Math.max(size.height ?? size.y, 1));
			}
		}
		if (this.pendingGeometry) {
			this.rebuild();
		}
	}

	render() {
		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	clear() {
		this.cancelEnvelopeRequests();
		this.preview = null;
		this.previewShapeKey = null;
		this.frameSideLength = null;
		this.envelopePending = false;
		this.envelopeResolved = false;
		this.restorePreviewAxisColor();
		this.needsFit = false;
		this.pendingGeometry = false;
		this.clearGroup();
	}

	dispose() {
		this.clear();
		this.scene.remove(this.group);
		this.viewer.removeEventListener("scene_changed", this.onSceneChanged);
		this.viewer.removeEventListener("update", this.update);
		this.viewer.removeEventListener("render.pass.perspective_overlay", this.render);
	}
}
