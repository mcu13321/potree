import * as THREE from "../../libs/three.js/build/three.module.js";
import {LineMaterial} from "../../libs/three.js/lines/LineMaterial.js";
import {LineSegments2} from "../../libs/three.js/lines/LineSegments2.js";
import {LineSegmentsGeometry} from "../../libs/three.js/lines/LineSegmentsGeometry.js";

const EPSILON = 1e-7;
// Match the existing top-view margin inside the unobstructed canvas region.
const CAMERA_FIT_PADDING = 1.05;
const PREVIEW_GROUP_NAME = "potree_cross_section_preview";
const NORMAL_SECTION_COLOR = 0xf25f5f;
const ACTIVE_SECTION_COLOR = 0xef4444;
const PREVIEW_AXIS_COLOR = 0xfacc15;
const ACTIVE_SECTION_OPACITY = 0.2;
const FRAME_SIZE_PADDING = 1.1;
const ENVELOPE_PERCENTILE = 0.02;

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
 * @param {{ axisAnchor?: "bottom" | "center", axisPaths?: THREE.Vector3[][], axisPoints?: THREE.Vector3[], frameSideLength?: number, sectionStart: number, sectionEnd: number, sectionStep: number, zRange: number }} options
 * @returns {{ corners: THREE.Vector3[], position: THREE.Vector3, tangent: THREE.Vector3 }[]}
 */
export function buildCrossSectionPreviewFrames({
	axisAnchor = "center",
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
		// Keep the station on the axis; offset only the preview corners.
		const base = resolved.position.clone();
		if (axisAnchor !== "bottom") base.z -= halfWidth;
		const lowerLeft = base.clone().sub(sideways);
		const lowerRight = base.clone().add(sideways);
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
		this.cameraViewport = null;
		this.frameSideLength = null;
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
			// Only an explicit manual-axis anchor uses the bottom edge.
			axisAnchor: config.axisAnchor === "bottom" ? "bottom" : "center",
			activeIndex: Math.max(0, Math.trunc(toFiniteNumber(config.activeIndex) ?? 0)),
			axisUuid: config.axisUuid ?? null,
			mainPointCloudBaseUrl: normalizePointCloudBaseUrl(config.mainPointCloudBaseUrl),
			sectionEnd: toFiniteNumber(config.sectionEnd),
			sectionStart: toFiniteNumber(config.sectionStart),
			sectionStep: toFiniteNumber(config.sectionStep),
			sectionThickness: toFiniteNumber(config.sectionThickness),
		};
		// Only a new preview resource owns another initial fit; parameters preserve navigation.
		const shapeKey = JSON.stringify([preview.axisUuid, preview.mainPointCloudBaseUrl]);
		this.needsFit ||= shapeKey !== this.previewShapeKey;
		this.setCameraViewport(config.cameraViewport);
		// Size changes never invalidate the camera or restart a profile request.
		this.frameSideLength = Number.isFinite(config.frameSideLength) && config.frameSideLength > EPSILON
			? config.frameSideLength : null;
		this.previewShapeKey = shapeKey;
		this.preview = preview;
		this.rebuild();
	}

	// Store CSS-pixel bounds without reframing after panel or window changes.
	setCameraViewport(viewport) {
		this.cameraViewport = viewport;
	}

	// Reset requests remain pending until both the axis and safe viewport are ready.
	requestCameraFit() {
		if (!this.preview) return;
		this.viewer.dispatchEvent({type: "cross_section_preview_camera_fit_requested"});
		this.needsFit = true;
		this.fitToPreview();
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
		const frames = buildCrossSectionPreviewFrames({
			axisAnchor: this.preview?.axisAnchor,
			axisPaths,
			frameSideLength: this.frameSideLength,
			sectionStart: this.preview?.sectionStart,
			sectionEnd: this.preview?.sectionEnd,
			sectionStep: this.preview?.sectionStep,
			// No bounds fallback: wait for the root-only estimate before drawing.
			zRange: undefined,
		});
		this.pendingGeometry = Boolean(this.preview) && axisPaths.length === 0;
		// Initialize the view once on entry, not when asynchronous size calculation completes.
		if (this.needsFit) this.fitToPreview(axisPaths);
		if (frames.length === 0) {
			return;
		}

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

	}

	// Fit all rendered axis samples, independently of clouds, stations, and preview markers.
	fitToPreview(axisPaths = collectAxisPaths(this.getAxisMeasurement())) {
		const viewport = this.cameraViewport;
		const canvas = this.viewer.renderer?.domElement;
		const width = canvas?.clientWidth;
		const height = canvas?.clientHeight;
		const controls = this.viewer.fjdCameraControls ?? this.viewer.controls ?? this.viewer.cameraControls;
		if (!this.preview || !axisPaths.length || !controls?.setRigidPose || !(width > 0 && height > 0)
			|| !viewport || ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite)) return false;
		// Intersect again to reject a stale or temporarily collapsed host layout.
		const left = Math.max(0, viewport.x);
		const top = Math.max(0, viewport.y);
		const right = Math.min(width, viewport.x + viewport.width);
		const bottom = Math.min(height, viewport.y + viewport.height);
		if (!(right > left && bottom > top)) return false;
		const bounds = new THREE.Box3().setFromPoints(axisPaths.flat());
		if (bounds.isEmpty()) return false;
		// Settle the renderer-owned orthographic frustum before deriving its zoom.
		this.viewer.setControls?.(controls);
		this.viewer.render?.();
		const camera = this.viewer.scene.getActiveCamera();
		if (!camera?.isOrthographicCamera && !camera?.isPerspectiveCamera) return false;
		const center = bounds.getCenter(new THREE.Vector3());
		const size = bounds.getSize(new THREE.Vector3());
		const ndcX = (left + right) / width - 1;
		const ndcY = 1 - (top + bottom) / height;
		const fractionX = (right - left) / width;
		const fractionY = (bottom - top) / height;
		const degenerate = size.x <= EPSILON && size.y <= EPSILON;
		let zoom = camera.zoom > 0 ? camera.zoom : 1;
		const nearPadding = Math.max(camera.near * 2, EPSILON);
		// Perspective framing must not impose a meter-sized minimum on small axes.
		let distance = size.z / 2 + (camera.isOrthographicCamera ? Math.max(size.z, 1, nearPadding) : nearPadding);
		// Cloud height only prevents clipping the roof; axis extents still determine XY framing.
		const cloudBounds = this.getPointCloudBounds();
		if (cloudBounds) distance = Math.max(distance, cloudBounds.max.z - center.z + nearPadding);
		const position = center.clone();
		if (camera.isOrthographicCamera) {
			const fieldWidth = camera.right - camera.left;
			const fieldHeight = camera.top - camera.bottom;
			if (!(fieldWidth > 0 && fieldHeight > 0)) return false;
			if (!degenerate) {
				zoom = Math.min(
					size.x > EPSILON ? fieldWidth * fractionX / (size.x * CAMERA_FIT_PADDING) : Infinity,
					size.y > EPSILON ? fieldHeight * fractionY / (size.y * CAMERA_FIT_PADDING) : Infinity,
				);
			}
			// Pan the axis center to the safe-region center while retaining the top orientation.
			position.x -= ndcX * fieldWidth / (2 * zoom);
			position.y -= ndcY * fieldHeight / (2 * zoom);
		} else {
			if (!degenerate) zoom = 1;
			const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / zoom;
			const tanX = tanY * camera.aspect;
			if (!(tanX > 0 && tanY > 0)) return false;
			if (degenerate) {
				// A vertical/point axis supplies no XY scale; keep the current viewing distance.
				const pose = controls.getRigidPose(false);
				distance = Math.max(distance, new THREE.Vector3(...pose.position).distanceTo(new THREE.Vector3(...pose.orbitPoint)));
			} else {
				// Account for depth when an off-center safe region is used in perspective.
				for (const x of [bounds.min.x, bounds.max.x]) {
					for (const y of [bounds.min.y, bounds.max.y]) {
						for (const z of [bounds.min.z, bounds.max.z]) {
							const depth = z - center.z;
							distance = Math.max(distance,
								depth + CAMERA_FIT_PADDING * Math.abs((x - center.x) / tanX + ndcX * depth) / fractionX,
								depth + CAMERA_FIT_PADDING * Math.abs((y - center.y) / tanY + ndcY * depth) / fractionY);
						}
					}
				}
			}
			position.x -= ndcX * tanX * distance;
			position.y -= ndcY * tanY * distance;
		}
		position.z += distance;
		if (!isUsableVector(position) || !Number.isFinite(zoom) || zoom <= 0) return false;
		// Potree's existing Z-up top view uses screen-right X and screen-up Y.
		controls.setRigidPose({position: position.toArray(), quaternion: [0, 0, 0, 1], orbitPoint: center.toArray(), zoom}, false);
		this.needsFit = false;
		this.viewer.dispatchEvent({type: "cross_section_preview_camera_fitted"});
		return true;
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
		} else if (this.needsFit) {
			// Retry readiness without reallocating preview geometry on every frame.
			this.fitToPreview();
		}
	}

	render() {
		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	clear() {
		this.preview = null;
		this.cameraViewport = null;
		this.previewShapeKey = null;
		this.frameSideLength = null;
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
