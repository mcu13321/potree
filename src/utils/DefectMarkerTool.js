import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";

const DEFECT_MARKER_STYLE_ID = "potree-defect-marker-styles";
const DEFECT_BOX_COLOR = 0xffffff;
const DEFECT_BOX_RENDER_ORDER = 10000;
const DEFECT_LABEL_GAP_PX = 4;
const _worldPosition = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();
const _screenPosition = new THREE.Vector3();
const BOX_CORNER_FACTORS = [
	[0, 0, 0],
	[0, 0, 1],
	[0, 1, 0],
	[0, 1, 1],
	[1, 0, 0],
	[1, 0, 1],
	[1, 1, 0],
	[1, 1, 1],
];
const styleStateByDocument = new WeakMap();

const DEFECT_MARKER_STYLES = `
.potree-defect-marker-layer {
	position: absolute;
	inset: 0;
	z-index: 100001;
	overflow: hidden;
	pointer-events: none;
}

.potree-defect-marker {
	--potree-defect-marker-accent: #8576ff;
	--potree-defect-marker-accent-dark: #a99fff;
	--potree-defect-marker-accent-current: var(--potree-defect-marker-accent);
	--potree-defect-marker-accent-soft: color-mix(in srgb, var(--potree-defect-marker-accent-current) 18%, transparent);
	position: absolute;
	left: 0;
	top: 0;
	display: none;
	align-items: center;
	max-width: 320px;
	transform: translate(-50%, calc(-100% - 4px));
	white-space: nowrap;
	cursor: pointer;
	pointer-events: auto;
	user-select: none;
}

.potree-defect-marker__label,
.potree-defect-marker__label-text {
	cursor: pointer;
}

.potree-defect-marker__label {
	box-sizing: border-box;
	display: flex;
	position: relative;
	min-height: 30px;
	max-width: 320px;
	align-items: center;
	overflow: hidden;
	padding: 4px 8px;
	/* Keep the label outline consistently translucent across both viewer themes. */
	border: 1px solid rgba(255, 255, 255, 0.2);
	border-radius: 14px;
	background: #ffffff;
	color: #17181c;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 12px;
	font-weight: 700;
	line-height: 1.15;
	letter-spacing: -0.01em;
	box-shadow: 0 12px 24px rgba(15, 23, 42, 0.14), 0 0 0 1px var(--potree-defect-marker-accent-soft);
}

.potree-defect-marker__label::after {
	position: absolute;
	inset: 0;
	content: "";
	border-radius: inherit;
	background: rgba(0, 0, 0, 0.2);
	opacity: 1;
	pointer-events: none;
	transition: opacity 160ms ease;
}

.potree-defect-marker--active .potree-defect-marker__label::after {
	/* Remove the dimming mask from the selected label. */
	opacity: 0;
}

.potree-defect-marker__label-text {
	display: block;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

html.dark .potree-defect-marker,
html[data-theme="dark"] .potree-defect-marker {
	--potree-defect-marker-accent-current: var(--potree-defect-marker-accent-dark);
}

html.dark .potree-defect-marker__label,
html[data-theme="dark"] .potree-defect-marker__label {
	border-color: rgba(255, 255, 255, 0.2);
	background: #17181c;
	color: #f4f4f5;
	box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2), 0 0 0 1px var(--potree-defect-marker-accent-soft);
}
`;

function acquireDefectMarkerStyles(documentRef) {
	const current = styleStateByDocument.get(documentRef);
	if (current) {
		current.references += 1;
		return () => releaseDefectMarkerStyles(documentRef);
	}

	const styleElement = documentRef.createElement("style");
	styleElement.id = DEFECT_MARKER_STYLE_ID;
	styleElement.textContent = DEFECT_MARKER_STYLES;
	documentRef.head.appendChild(styleElement);
	styleStateByDocument.set(documentRef, {element: styleElement, references: 1});

	return () => releaseDefectMarkerStyles(documentRef);
}

function releaseDefectMarkerStyles(documentRef) {
	const current = styleStateByDocument.get(documentRef);
	if (!current) {
		return;
	}

	current.references -= 1;
	if (current.references > 0) {
		return;
	}

	current.element.remove();
	styleStateByDocument.delete(documentRef);
}

function normalizeMarker(marker, index) {
	const min = Array.isArray(marker?.bounds?.min) ? marker.bounds.min.slice(0, 3).map(Number) : [];
	const max = Array.isArray(marker?.bounds?.max) ? marker.bounds.max.slice(0, 3).map(Number) : [];
	const hasValidBounds =
		min.length === 3 &&
		max.length === 3 &&
		min.every(Number.isFinite) &&
		max.every(Number.isFinite) &&
		min.every((value, axis) => value <= max[axis]);
	if (!hasValidBounds) {
		return null;
	}
	const shape = marker?.shape === "rectangle" ? "rectangle" : "box";
	const corners = Array.isArray(marker?.corners)
		? marker.corners.map((corner) => Array.isArray(corner) ? corner.slice(0, 3).map(Number) : [])
		: [];
	const hasValidRectangle =
		corners.length === 4 &&
		corners.every((corner) => corner.length === 3 && corner.every(Number.isFinite));
	if (shape === "rectangle" && !hasValidRectangle) {
		return null;
	}

	const id = String(marker?.id ?? index);
	const label = String(marker?.label ?? id).trim();
	if (!label) {
		return null;
	}

	// Accept CSS colors from the host payload while keeping stable Potree defaults.
	const color = String(marker?.color ?? "").trim() || "#8576ff";
	const darkColor = String(marker?.darkColor ?? "").trim() || color;
	const cameraPosition = Array.isArray(marker?.cameraPosition)
		? marker.cameraPosition.slice(0, 3).map(Number)
		: [];
	const hasCameraPosition = cameraPosition.length === 3 && cameraPosition.every(Number.isFinite);

	return {
		id,
		label,
		shape,
		bounds: {min, max},
		...(shape === "rectangle" ? {corners} : {}),
		...(hasCameraPosition ? {cameraPosition} : {}),
		color,
		darkColor,
	};
}

export class DefectMarkerTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.visible = false;
		this.activeMarkerId = null;
		this.markers = new Map();
		this.scene = new THREE.Scene();
		this.scene.name = "scene_defect_markers";
		this.boxGroup = new THREE.Group();
		this.boxGroup.name = "potree_defect_marker_boxes";
		this.scene.add(this.boxGroup);
		this.hostElement = this._resolveHostElement();
		this.document = this.hostElement?.ownerDocument ?? document;
		this.rootElement = this.document.createElement("div");
		this.rootElement.className = "potree-defect-marker-layer";
		this.rootElement.setAttribute("aria-hidden", "true");
		this.rootElement.style.display = "none";
		this.hostElement?.appendChild(this.rootElement);
		this.releaseStyles = acquireDefectMarkerStyles(this.document);

		this._onUpdate = () => this.update();
		this._onRender = () => this.render();
		viewer.addEventListener("update", this._onUpdate);
		viewer.addEventListener("render.pass.perspective_overlay", this._onRender);
	}

	_resolveHostElement() {
		const renderArea = this.viewer?.renderArea;
		if (renderArea instanceof HTMLElement) {
			return renderArea;
		}
		if (renderArea?.[0] instanceof HTMLElement) {
			return renderArea[0];
		}
		return this.viewer?.renderer?.domElement?.parentElement ?? null;
	}

	_createMarkerElement(marker) {
		const element = this.document.createElement("div");
		element.className = "potree-defect-marker";
		element.dataset.defectMarkerId = marker.id;
		element.style.setProperty("--potree-defect-marker-accent", marker.color);
		element.style.setProperty("--potree-defect-marker-accent-dark", marker.darkColor);
		element.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.setActiveMarker(marker.id);
			this.viewer?.dispatchEvent({
				type: "defect_marker_selected",
				markerId: marker.id,
				marker: this.markers.get(marker.id)?.marker ?? marker,
			});
		});

		const labelElement = this.document.createElement("div");
		labelElement.className = "potree-defect-marker__label";

		const labelTextElement = this.document.createElement("span");
		labelTextElement.className = "potree-defect-marker__label-text";
		labelTextElement.textContent = marker.label;
		labelElement.appendChild(labelTextElement);

		element.append(labelElement);
		this.rootElement.appendChild(element);
		const boxHelper = this._createBoxHelper(marker);

		return {element, labelTextElement, boxHelper, marker};
	}

	_createBoxHelper(marker) {
		if (marker.shape === "rectangle") {
			return this._createRectangleHelper(marker);
		}

		const box = new THREE.Box3(
			new THREE.Vector3().fromArray(marker.bounds.min),
			new THREE.Vector3().fromArray(marker.bounds.max),
		);
		const helper = new THREE.Box3Helper(box, DEFECT_BOX_COLOR);
		helper.name = `potree_defect_marker_box_${marker.id}`;
		helper.material.depthTest = false;
		helper.material.depthWrite = false;
		helper.renderOrder = DEFECT_BOX_RENDER_ORDER;
		helper.userData.defectMarkerId = marker.id;
		this.boxGroup.add(helper);
		return helper;
	}

	_createRectangleHelper(marker) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(this._buildRectangleLinePositions(marker.corners), 3),
		);
		const material = new THREE.LineBasicMaterial({color: DEFECT_BOX_COLOR});
		material.depthTest = false;
		material.depthWrite = false;
		const helper = new THREE.LineSegments(geometry, material);
		helper.name = `potree_defect_marker_rectangle_${marker.id}`;
		helper.renderOrder = DEFECT_BOX_RENDER_ORDER;
		helper.userData.defectMarkerId = marker.id;
		this.boxGroup.add(helper);
		return helper;
	}

	_buildRectangleLinePositions(corners) {
		const positions = [];
		for (let index = 0; index < corners.length; index += 1) {
			positions.push(...corners[index], ...corners[(index + 1) % corners.length]);
		}
		return positions;
	}

	_updateMarkerElement(entry, marker) {
		const previousShape = entry.marker.shape;
		entry.marker = marker;
		if (entry.labelTextElement.textContent !== marker.label) {
			entry.labelTextElement.textContent = marker.label;
		}
		entry.element.style.setProperty("--potree-defect-marker-accent", marker.color);
		entry.element.style.setProperty("--potree-defect-marker-accent-dark", marker.darkColor);
		if (previousShape !== marker.shape) {
			this.boxGroup.remove(entry.boxHelper);
			entry.boxHelper.geometry?.dispose?.();
			entry.boxHelper.material?.dispose?.();
			entry.boxHelper = this._createBoxHelper(marker);
		} else if (marker.shape === "rectangle") {
			entry.boxHelper.geometry.attributes.position.array.set(
				this._buildRectangleLinePositions(marker.corners),
			);
			entry.boxHelper.geometry.attributes.position.needsUpdate = true;
			entry.boxHelper.geometry.computeBoundingSphere();
		} else {
			entry.boxHelper.box.min.fromArray(marker.bounds.min);
			entry.boxHelper.box.max.fromArray(marker.bounds.max);
			entry.boxHelper.updateMatrixWorld(true);
		}
	}

	_removeMarker(id) {
		const entry = this.markers.get(id);
		if (!entry) {
			return;
		}

		this.boxGroup.remove(entry.boxHelper);
		entry.boxHelper.geometry?.dispose?.();
		entry.boxHelper.material?.dispose?.();
		entry.element.remove();
		this.markers.delete(id);
		if (this.activeMarkerId === id) {
			this.activeMarkerId = null;
		}
	}

	setData(markers = []) {
		const normalizedMarkers = (Array.isArray(markers) ? markers : [])
			.map(normalizeMarker)
			.filter(Boolean);
		const nextIds = new Set(normalizedMarkers.map((marker) => marker.id));

		for (const id of this.markers.keys()) {
			if (!nextIds.has(id)) {
				this._removeMarker(id);
			}
		}

		for (const marker of normalizedMarkers) {
			const existing = this.markers.get(marker.id);
			if (existing) {
				this._updateMarkerElement(existing, marker);
			} else {
				this.markers.set(marker.id, this._createMarkerElement(marker));
			}
		}

		this.setActiveMarker(this.activeMarkerId);
		this.update();
	}

	setActiveMarker(markerId) {
		const normalizedMarkerId = markerId == null ? null : String(markerId);
		const nextActiveMarkerId = this.markers.has(normalizedMarkerId) ? normalizedMarkerId : null;

		this.activeMarkerId = nextActiveMarkerId;
		for (const [id, entry] of this.markers) {
			entry.element.classList.toggle("potree-defect-marker--active", id === nextActiveMarkerId);
		}
	}

	focusMarker(markerId) {
		const marker = this.markers.get(String(markerId))?.marker;
		if (!marker) {
			return;
		}

		if (!marker.cameraPosition) {
			return;
		}

		const center = new THREE.Vector3().fromArray(marker.cameraPosition);
		const sphere = new THREE.Sphere(center, 2);
		// Match the existing label focus behavior while preferring the live FJD controls.
		const controls =
			this.viewer?.fjdCameraControls ??
			this.viewer?.getControls?.() ??
			this.viewer?.controls ??
			this.viewer?.cameraControls;
		controls?.fitToSphere?.(sphere, true);
	}

	setVisible(visible) {
		this.visible = Boolean(visible);
		this.boxGroup.visible = this.visible;
		this.update();
	}

	clear() {
		this.activeMarkerId = null;
		for (const id of [...this.markers.keys()]) {
			this._removeMarker(id);
		}
	}

	_setMarkerVisible(entry, visible) {
		entry.element.style.display = visible ? "flex" : "none";
	}

	_projectMarkerBounds(marker, camera, canvasRect, hostRect) {
		const [minX, minY, minZ] = marker.bounds.min;
		const [maxX, maxY, maxZ] = marker.bounds.max;
		let projectedMinX = Number.POSITIVE_INFINITY;
		let projectedMinY = Number.POSITIVE_INFINITY;
		let projectedMaxX = Number.NEGATIVE_INFINITY;
		let projectedMaxY = Number.NEGATIVE_INFINITY;
		let projectedCount = 0;

		const projectionPoints = marker.shape === "rectangle" ? marker.corners : BOX_CORNER_FACTORS;
		for (const point of projectionPoints) {
			if (marker.shape === "rectangle") {
				_worldPosition.fromArray(point);
			} else {
				const [xFactor, yFactor, zFactor] = point;
				_worldPosition.set(
					xFactor ? maxX : minX,
					yFactor ? maxY : minY,
					zFactor ? maxZ : minZ,
				);
			}
			_viewPosition.copy(_worldPosition).applyMatrix4(camera.matrixWorldInverse);
			if (_viewPosition.z > 0) {
				continue;
			}

			_screenPosition.copy(_worldPosition).project(camera);
			if (
				!Number.isFinite(_screenPosition.x) ||
				!Number.isFinite(_screenPosition.y) ||
				!Number.isFinite(_screenPosition.z) ||
				_screenPosition.z < -1 ||
				_screenPosition.z > 1
			) {
				continue;
			}

			const x =
				canvasRect.left -
				hostRect.left +
				((_screenPosition.x + 1) * canvasRect.width) / 2;
			const y =
				canvasRect.top -
				hostRect.top +
				((-_screenPosition.y + 1) * canvasRect.height) / 2;
			projectedMinX = Math.min(projectedMinX, x);
			projectedMinY = Math.min(projectedMinY, y);
			projectedMaxX = Math.max(projectedMaxX, x);
			projectedMaxY = Math.max(projectedMaxY, y);
			projectedCount += 1;
		}

		if (!projectedCount) {
			return null;
		}

		const canvasLeft = canvasRect.left - hostRect.left;
		const canvasTop = canvasRect.top - hostRect.top;
		const canvasRight = canvasLeft + canvasRect.width;
		const canvasBottom = canvasTop + canvasRect.height;
		const intersectsCanvas =
			projectedMaxX >= canvasLeft &&
			projectedMinX <= canvasRight &&
			projectedMaxY >= canvasTop &&
			projectedMinY <= canvasBottom;
		if (!intersectsCanvas) {
			return null;
		}

		return {
			x: (projectedMinX + projectedMaxX) / 2,
			y: projectedMinY - DEFECT_LABEL_GAP_PX,
		};
	}

	update() {
		if (!this.rootElement) {
			return;
		}

		const shouldRender = this.visible && this.markers.size > 0;
		this.rootElement.style.display = shouldRender ? "block" : "none";
		this.boxGroup.visible = shouldRender;
		if (!shouldRender) {
			return;
		}

		const camera = this.viewer?.scene?.getActiveCamera?.();
		const canvas = this.viewer?.renderer?.domElement;
		if (!camera || !canvas) {
			return;
		}

		const canvasRect = canvas.getBoundingClientRect();
		const hostRect = this.hostElement?.getBoundingClientRect?.() ?? {left: 0, top: 0};
		const projectionRect = {
			left: canvasRect.left,
			top: canvasRect.top,
			width: canvasRect.width || canvas.clientWidth,
			height: canvasRect.height || canvas.clientHeight,
		};
		if (!projectionRect.width || !projectionRect.height) {
			return;
		}

		for (const entry of this.markers.values()) {
			const projectedBounds = this._projectMarkerBounds(
				entry.marker,
				camera,
				projectionRect,
				hostRect,
			);
			if (!projectedBounds) {
				this._setMarkerVisible(entry, false);
				continue;
			}

			entry.element.style.left = `${Math.round(projectedBounds.x)}px`;
			entry.element.style.top = `${Math.round(projectedBounds.y)}px`;
			this._setMarkerVisible(entry, true);
		}
	}

	render() {
		if (!this.visible || !this.markers.size) {
			return;
		}

		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	dispose() {
		this.viewer?.removeEventListener("update", this._onUpdate);
		this.viewer?.removeEventListener("render.pass.perspective_overlay", this._onRender);
		this.clear();
		this.scene?.remove(this.boxGroup);
		this.rootElement?.remove();
		this.releaseStyles?.();
		this.rootElement = null;
		this.hostElement = null;
		this.boxGroup = null;
		this.scene = null;
		this.viewer = null;
	}
}
