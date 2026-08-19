import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";

const DEFECT_MARKER_STYLE_ID = "potree-defect-marker-styles";
const DEFECT_MARKER_RING_RENDER_ORDER = 10000;
const DEFECT_MARKER_RING_ARGS = [100 / 800, 100 / 800 + 100 / 1200, 32];
const _worldPosition = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();
const _screenPosition = new THREE.Vector3();
const _ringEdgePosition = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
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
	--potree-defect-marker-accent-line: color-mix(in srgb, var(--potree-defect-marker-accent-current) 48%, transparent);
	--potree-defect-marker-accent-soft: color-mix(in srgb, var(--potree-defect-marker-accent-current) 18%, transparent);
	position: absolute;
	left: 0;
	top: 0;
	display: none;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	max-width: 320px;
	transform: translate(-50%, -50%);
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
	display: block;
	max-width: 320px;
	overflow: hidden;
	color: #ffffff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 12px;
	font-weight: 700;
	line-height: 1.15;
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
	const position = Array.isArray(marker?.position) ? marker.position.slice(0, 3).map(Number) : [];
	if (position.length !== 3 || !position.every(Number.isFinite)) {
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

	return {id, label, position, ...(hasCameraPosition ? {cameraPosition} : {}), color, darkColor};
}

/** Release one Potree-owned anomaly ring mesh and its resources. */
function disposeDefectMarkerRing(mesh) {
	mesh?.geometry?.dispose?.();
	mesh?.material?.dispose?.();
}

/** Create one XY-plane anomaly ring using the track point default geometry. */
function createDefectMarkerRing(marker) {
	const geometry = new THREE.RingGeometry(...DEFECT_MARKER_RING_ARGS);
	const material = new THREE.MeshBasicMaterial({
		color: marker.color,
		transparent: true,
		opacity: 0.8,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = `potree_defect_marker_ring_${marker.id}`;
	mesh.position.fromArray(marker.position);
	mesh.renderOrder = DEFECT_MARKER_RING_RENDER_ORDER;
	mesh.userData.defectMarkerId = marker.id;
	return mesh;
}

function updateDefectMarkerRingOpacity(entry, activeMarkerId) {
	if (!entry?.ring?.material) return;
	const isActive = entry.marker.id === activeMarkerId;
	entry.ring.material.opacity = isActive ? 1 : entry.hovered ? 0.9 : 0.8;
}

function updateDefectMarkerLabelSize(entry, camera, width, height) {
	const outerRadius = Number(entry?.ring?.geometry?.parameters?.outerRadius);
	if (!Number.isFinite(outerRadius) || outerRadius <= 0) return;

	_ringEdgePosition.copy(entry.ring.position).setX(entry.ring.position.x + outerRadius).project(camera);
	const centerX = ((_screenPosition.x + 1) * width) / 2;
	const centerY = ((-_screenPosition.y + 1) * height) / 2;
	const edgeX = ((_ringEdgePosition.x + 1) * width) / 2;
	const edgeY = ((-_ringEdgePosition.y + 1) * height) / 2;
	const screenRadius = Math.hypot(edgeX - centerX, edgeY - centerY);
	const fontSize = Math.round(Math.min(18, Math.max(8, screenRadius * 1.1)));
	entry.element.style.fontSize = `${fontSize}px`;
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
		this.ringGroup = new THREE.Group();
		this.ringGroup.name = "potree_defect_marker_rings";
		this.scene.add(this.ringGroup);
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
		this._onPointerMove = (event) => this._updateRingHover(event);
		this._onPointerLeave = () => this._setHoveredMarkerId(null);
		viewer.addEventListener("update", this._onUpdate);
		viewer.addEventListener("render.pass.perspective_overlay", this._onRender);
		this.viewer?.renderer?.domElement?.addEventListener("pointermove", this._onPointerMove);
		this.viewer?.renderer?.domElement?.addEventListener("pointerleave", this._onPointerLeave);
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
		element.addEventListener("mouseenter", () => {
			const entry = this.markers.get(marker.id);
			if (!entry) return;
			entry.hovered = true;
			updateDefectMarkerRingOpacity(entry, this.activeMarkerId);
		});
		element.addEventListener("mouseleave", () => {
			const entry = this.markers.get(marker.id);
			if (!entry) return;
			entry.hovered = false;
			updateDefectMarkerRingOpacity(entry, this.activeMarkerId);
		});

		const labelElement = this.document.createElement("div");
		labelElement.className = "potree-defect-marker__label";

		const labelTextElement = this.document.createElement("span");
		labelTextElement.className = "potree-defect-marker__label-text";
		labelTextElement.textContent = marker.label;
		labelElement.appendChild(labelTextElement);

		element.append(labelElement);
		this.rootElement.appendChild(element);

		const ring = createDefectMarkerRing(marker);
		this.ringGroup.add(ring);
		return {element, labelTextElement, marker, ring, hovered: false};
	}

	_updateMarkerElement(entry, marker) {
		entry.marker = marker;
		if (entry.labelTextElement.textContent !== marker.label) {
			entry.labelTextElement.textContent = marker.label;
		}
		entry.element.style.setProperty("--potree-defect-marker-accent", marker.color);
		entry.element.style.setProperty("--potree-defect-marker-accent-dark", marker.darkColor);
		entry.ring.position.fromArray(marker.position);
		entry.ring.material.color.set(marker.color);
		updateDefectMarkerRingOpacity(entry, this.activeMarkerId);
	}

	_setHoveredMarkerId(markerId) {
		const normalizedMarkerId = markerId == null ? null : String(markerId);
		for (const [id, entry] of this.markers) {
			const hovered = id === normalizedMarkerId;
			if (entry.hovered === hovered) continue;
			entry.hovered = hovered;
			updateDefectMarkerRingOpacity(entry, this.activeMarkerId);
		}
	}

	_updateRingHover(event) {
		if (!this.visible || !this.ringGroup?.visible || !this.markers.size) return;
		const canvas = this.viewer?.renderer?.domElement;
		const camera = this.viewer?.scene?.getActiveCamera?.();
		if (!canvas || !camera) return;

		const canvasRect = canvas.getBoundingClientRect();
		if (!canvasRect.width || !canvasRect.height) return;
		_pointer.set(
			((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
			-((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
		);
		this.ringGroup.updateMatrixWorld(true);
		_raycaster.setFromCamera(_pointer, camera);
		const ring = _raycaster.intersectObjects(this.ringGroup.children, false)[0]?.object;
		this._setHoveredMarkerId(ring?.userData?.defectMarkerId ?? null);
	}

	_removeMarker(id) {
		const entry = this.markers.get(id);
		if (!entry) {
			return;
		}

		this.ringGroup.remove(entry.ring);
		disposeDefectMarkerRing(entry.ring);
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
			updateDefectMarkerRingOpacity(entry, nextActiveMarkerId);
		}
	}

	focusMarker(markerId) {
		const marker = this.markers.get(String(markerId))?.marker;
		if (!marker) {
			return;
		}

		const center = new THREE.Vector3().fromArray(marker.cameraPosition ?? marker.position);
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
		this.ringGroup.visible = this.visible;
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

	update() {
		if (!this.rootElement) {
			return;
		}

		const shouldRender = this.visible && this.markers.size > 0;
		this.rootElement.style.display = shouldRender ? "block" : "none";
		this.ringGroup.visible = shouldRender;
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
		const width = canvasRect.width || canvas.clientWidth;
		const height = canvasRect.height || canvas.clientHeight;
		if (!width || !height) {
			return;
		}

		for (const entry of this.markers.values()) {
			_worldPosition.fromArray(entry.marker.position);
			_viewPosition.copy(_worldPosition).applyMatrix4(camera.matrixWorldInverse);
			_screenPosition.copy(_worldPosition).project(camera);

			const inView =
				_viewPosition.z <= 0 &&
				Number.isFinite(_screenPosition.x) &&
				Number.isFinite(_screenPosition.y) &&
				Number.isFinite(_screenPosition.z) &&
				_screenPosition.x >= -1 &&
				_screenPosition.x <= 1 &&
				_screenPosition.y >= -1 &&
				_screenPosition.y <= 1 &&
				_screenPosition.z >= -1 &&
				_screenPosition.z <= 1;

			if (!inView) {
				this._setMarkerVisible(entry, false);
				continue;
			}

			const x = canvasRect.left - hostRect.left + ((_screenPosition.x + 1) * width) / 2;
			const y = canvasRect.top - hostRect.top + ((-_screenPosition.y + 1) * height) / 2;
			entry.element.style.left = `${Math.round(x)}px`;
			entry.element.style.top = `${Math.round(y)}px`;
			updateDefectMarkerLabelSize(entry, camera, width, height);
			this._setMarkerVisible(entry, true);
		}
	}

	/** Render anomaly rings in the same perspective overlay pass as track point rings. */
	render() {
		if (!this.ringGroup?.visible || !this.markers.size) {
			return;
		}

		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	dispose() {
		this.viewer?.removeEventListener("update", this._onUpdate);
		this.viewer?.removeEventListener("render.pass.perspective_overlay", this._onRender);
		this.viewer?.renderer?.domElement?.removeEventListener("pointermove", this._onPointerMove);
		this.viewer?.renderer?.domElement?.removeEventListener("pointerleave", this._onPointerLeave);
		this.clear();
		this.scene?.remove(this.ringGroup);
		this.rootElement?.remove();
		this.releaseStyles?.();
		this.rootElement = null;
		this.hostElement = null;
		this.ringGroup = null;
		this.scene = null;
		this.viewer = null;
	}
}
