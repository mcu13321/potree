import * as THREE from "../../libs/three.js/build/three.module.js";
import {EventDispatcher} from "../EventDispatcher.js";

const DEFECT_MARKER_STYLE_ID = "potree-defect-marker-styles";
const _worldPosition = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();
const _screenPosition = new THREE.Vector3();
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
	transform: translate(-50%, calc(-100% + 9px));
	white-space: nowrap;
	cursor: pointer;
	pointer-events: auto;
	user-select: none;
}

.potree-defect-marker__label,
.potree-defect-marker__label-text,
.potree-defect-marker__pin {
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

.potree-defect-marker__pin {
	box-sizing: border-box;
	display: block;
	width: 18px;
	height: 18px;
	flex: 0 0 auto;
	border: 2px solid rgba(255, 255, 255, 0.9);
	border-radius: 50%;
	background: var(--potree-defect-marker-accent-current);
	box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--potree-defect-marker-accent-line);
	transition: box-shadow 160ms ease;
}

.potree-defect-marker--active .potree-defect-marker__pin {
	/* Render two filled halo bands instead of circular outline strokes. */
	box-shadow:
		0 0 0 6px rgba(255, 255, 255, 0.18),
		0 0 0 11px rgba(255, 255, 255, 0.09),
		0 8px 18px rgba(0, 0, 0, 0.18);
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

	return {id, label, position, color, darkColor};
}

export class DefectMarkerTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.visible = false;
		this.activeMarkerId = null;
		this.markers = new Map();
		this.hostElement = this._resolveHostElement();
		this.document = this.hostElement?.ownerDocument ?? document;
		this.rootElement = this.document.createElement("div");
		this.rootElement.className = "potree-defect-marker-layer";
		this.rootElement.setAttribute("aria-hidden", "true");
		this.rootElement.style.display = "none";
		this.hostElement?.appendChild(this.rootElement);
		this.releaseStyles = acquireDefectMarkerStyles(this.document);

		this._onUpdate = () => this.update();
		viewer.addEventListener("update", this._onUpdate);
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

		const pinElement = this.document.createElement("span");
		pinElement.className = "potree-defect-marker__pin";
		pinElement.setAttribute("aria-hidden", "true");

		element.append(labelElement, pinElement);
		this.rootElement.appendChild(element);

		return {element, labelTextElement, marker};
	}

	_updateMarkerElement(entry, marker) {
		entry.marker = marker;
		if (entry.labelTextElement.textContent !== marker.label) {
			entry.labelTextElement.textContent = marker.label;
		}
		entry.element.style.setProperty("--potree-defect-marker-accent", marker.color);
		entry.element.style.setProperty("--potree-defect-marker-accent-dark", marker.darkColor);
	}

	_removeMarker(id) {
		const entry = this.markers.get(id);
		if (!entry) {
			return;
		}

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

		const center = new THREE.Vector3().fromArray(marker.position);
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
			this._setMarkerVisible(entry, true);
		}
	}

	dispose() {
		this.viewer?.removeEventListener("update", this._onUpdate);
		this.clear();
		this.rootElement?.remove();
		this.releaseStyles?.();
		this.rootElement = null;
		this.hostElement = null;
		this.viewer = null;
	}
}
