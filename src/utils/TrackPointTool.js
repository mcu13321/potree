import * as THREE from "../../libs/three.js/build/three.module.js";
import { EventDispatcher } from "../EventDispatcher.js";

/** Potree 内部统一承载轨迹点圆环的根节点名称。 */
const TRACK_POINT_GROUP_NAME = "potree_track_point_group";

/** 序号精灵的离屏画布尺寸。 */
const TRACK_POINT_LABEL_SIZE = 128;

/** 序号精灵在世界坐标中的缩放。 */
const TRACK_POINT_LABEL_SCALE = 0.35;

/** 序号精灵相对圆环的抬升高度。 */
const TRACK_POINT_LABEL_OFFSET_Z = 0.25;

/** 保证轨迹点圆环渲染在点云上层。 */
const TRACK_POINT_RENDER_ORDER = 10000;

/** click 判定允许的最大位移阈值。 */
const TRACK_POINT_CLICK_THRESHOLD_PX = 4;

/** 复用单例 raycaster，避免频繁创建对象。 */
const raycaster = new THREE.Raycaster();

/** 复用单例 NDC 坐标对象。 */
const pointerNdc = new THREE.Vector2();

/** TrackPointTool 的默认状态。 */
const DEFAULT_TRACK_POINT_STATE = {
	visible: false,
	interactive: false,
	activeIndex: -1,
	range: 0,
	size: 100,
	opacity: 100,
	showLabel: false,
};

/**
 * 释放轨迹点 mesh、label sprite 及其贴图资源。
 * @param {THREE.Object3D} node
 */
function disposeTrackPointNode(node) {
	node.traverse((child) => {
		if (child.geometry) {
			child.geometry.dispose?.();
		}

		if (child.material) {
			if (Array.isArray(child.material)) {
				child.material.forEach((material) => material?.dispose?.());
			} else {
				child.material.dispose?.();
			}
		}

		if (child.userData?.labelTexture) {
			child.userData.labelTexture.dispose?.();
		}
	});
}

/**
 * 清空轨迹点 group 并释放其中资源。
 * @param {THREE.Group} group
 */
function clearTrackPointGroup(group) {
	const children = [...group.children];
	for (const child of children) {
		group.remove(child);
		disposeTrackPointNode(child);
	}
}

/**
 * 统一轨迹点圆环的几何尺寸换算。
 * @param {number} size
 * @returns {[number, number, number]}
 */
function getTrackPointRingArgs(size) {
	const safeSize = Number.isFinite(size) ? size : DEFAULT_TRACK_POINT_STATE.size;
	return [safeSize / 800, safeSize / 800 + safeSize / 1200, 32];
}

/**
 * 将百分比透明度转换为材质实际使用的小数。
 * @param {number} opacity
 * @returns {number}
 */
function getTrackPointBaseOpacity(opacity) {
	const safeOpacity = Number.isFinite(opacity) ? opacity : DEFAULT_TRACK_POINT_STATE.opacity;
	return THREE.MathUtils.clamp(safeOpacity / 100, 0, 1);
}

/**
 * 判断轨迹点在当前索引和范围下是否应显示。
 * @param {number} index
 * @param {number} activeIndex
 * @param {number} range
 * @returns {boolean}
 */
function getTrackPointVisible(index, activeIndex, range) {
	return index !== activeIndex && Math.abs(index - activeIndex) <= range;
}

/**
 * 根据悬浮状态计算实际透明度。
 * @param {number} baseOpacity
 * @param {boolean} hovered
 * @returns {number}
 */
function getTrackPointRenderOpacity(baseOpacity, hovered) {
	return hovered ? 1 : baseOpacity;
}

/**
 * 创建轨迹点序号精灵。
 * @param {number|string} label
 * @returns {THREE.Sprite | null}
 */
function createTrackPointLabelSprite(label) {
	const canvas = document.createElement("canvas");
	canvas.width = TRACK_POINT_LABEL_SIZE;
	canvas.height = TRACK_POINT_LABEL_SIZE;
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}

	context.clearRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = "#ffffff";
	context.strokeStyle = "rgba(0, 0, 0, 0.65)";
	context.lineWidth = 8;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.font = "bold 64px sans-serif";
	context.strokeText(String(label), canvas.width / 2, canvas.height / 2);
	context.fillText(String(label), canvas.width / 2, canvas.height / 2);

	const texture = new THREE.CanvasTexture(canvas);
	texture.needsUpdate = true;

	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(TRACK_POINT_LABEL_SCALE, TRACK_POINT_LABEL_SCALE, 1);
	sprite.position.set(0, 0, TRACK_POINT_LABEL_OFFSET_Z);
	sprite.renderOrder = TRACK_POINT_RENDER_ORDER + 1;
	sprite.userData.labelTexture = texture;

	return sprite;
}

/**
 * 创建单个 Potree 轨迹点圆环。
 * @param {Object} options
 * @param {Object} options.point
 * @param {[number, number, number]} options.ringArgs
 * @param {boolean} options.showLabel
 * @returns {THREE.Mesh}
 */
function createTrackPointMesh({ point, ringArgs, showLabel }) {
	const geometry = new THREE.RingGeometry(...ringArgs);
	const material = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 1,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = `potree_track_point_${point.index}`;
	mesh.position.fromArray(point.positionWithGround || point.position);
	mesh.renderOrder = TRACK_POINT_RENDER_ORDER;
	mesh.userData.trackPoint = point;
	mesh.userData.trackPointHovered = false;

	if (showLabel) {
		const label = createTrackPointLabelSprite(point.label ?? point.index);
		if (label) {
			mesh.userData.label = label;
			mesh.add(label);
		}
	}

	return mesh;
}

/**
 * 刷新单个圆环的显示状态和透明度。
 * @param {THREE.Mesh} mesh
 * @param {Object} state
 */
function refreshTrackPointMesh(mesh, state) {
	const point = mesh.userData.trackPoint;
	const meshVisible =
		state.visible &&
		getTrackPointVisible(point.index, state.activeIndex, state.range);
	mesh.visible = meshVisible;
	mesh.material.opacity = getTrackPointRenderOpacity(
		state.baseOpacity,
		Boolean(mesh.userData.trackPointHovered),
	);

	if (mesh.userData.label) {
		mesh.userData.label.visible = meshVisible && state.showLabel;
	}
}

/**
 * 计算 pointerdown 与 pointerup 之间的位移距离。
 * @param {{ clientX: number, clientY: number }} pointerDown
 * @param {PointerEvent} event
 * @returns {number}
 */
function getPointerDistance(pointerDown, event) {
	const dx = event.clientX - pointerDown.clientX;
	const dy = event.clientY - pointerDown.clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

export class TrackPointTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.points = [];
		this.state = { ...DEFAULT_TRACK_POINT_STATE };
		// 轨迹点圆环单独放在 overlay scene 中渲染，避免被 EDL 全屏合成覆盖。
		this.scene = new THREE.Scene();
		this.scene.name = "scene_track_point";
		this.group = new THREE.Group();
		this.group.name = TRACK_POINT_GROUP_NAME;
		this.scene.add(this.group);
		this.hoveredMesh = null;
		this.pointerDown = null;

		this._onPointerMove = (event) => this._handlePointerMove(event);
		this._onPointerDown = (event) => this._handlePointerDown(event);
		this._onPointerUp = (event) => this._handlePointerUp(event);
		this._onPointerLeave = () => this._resetPointerState();
		this._onPointerCancel = () => this._resetPointerState();
		this._onRender = () => this.render();

		this._bindPointerEvents();
		viewer.addEventListener("render.pass.perspective_overlay", this._onRender);
	}

	/** 绑定渲染层 pointer 事件。 */
	_bindPointerEvents() {
		const domElement = this.viewer?.renderer?.domElement;
		if (!domElement) {
			return;
		}

		domElement.addEventListener("pointermove", this._onPointerMove);
		domElement.addEventListener("pointerdown", this._onPointerDown);
		domElement.addEventListener("pointerup", this._onPointerUp);
		domElement.addEventListener("pointerleave", this._onPointerLeave);
		domElement.addEventListener("pointercancel", this._onPointerCancel);
	}

	/** 解绑渲染层 pointer 事件。 */
	_unbindPointerEvents() {
		const domElement = this.viewer?.renderer?.domElement;
		if (!domElement) {
			return;
		}

		domElement.removeEventListener("pointermove", this._onPointerMove);
		domElement.removeEventListener("pointerdown", this._onPointerDown);
		domElement.removeEventListener("pointerup", this._onPointerUp);
		domElement.removeEventListener("pointerleave", this._onPointerLeave);
		domElement.removeEventListener("pointercancel", this._onPointerCancel);
	}

	/**
	 * 规范化外部传入的轨迹点数据。
	 * @param {Array<Object>} points
	 * @returns {Array<Object>}
	 */
	_normalizePoints(points = []) {
		return points
			.filter(Boolean)
			.map((point, index) => {
				const resolvedIndex = Number.isFinite(point.index) ? point.index : index;
				return {
					id: point.id ?? resolvedIndex,
					index: resolvedIndex,
					label: point.label ?? resolvedIndex,
					position: Array.isArray(point.position) ? point.position : [0, 0, 0],
					positionWithGround: Array.isArray(point.positionWithGround)
						? point.positionWithGround
						: null,
				};
			});
	}

	/**
	 * 规范化外部传入的展示状态。
	 * @param {Object} nextState
	 * @returns {Object}
	 */
	_normalizeState(nextState = {}) {
		const mergedState = { ...this.state, ...nextState };

		return {
			visible: Boolean(mergedState.visible),
			interactive: Boolean(mergedState.interactive),
			activeIndex: Number.isFinite(mergedState.activeIndex)
				? mergedState.activeIndex
				: DEFAULT_TRACK_POINT_STATE.activeIndex,
			range: Math.max(0, Math.trunc(mergedState.range ?? DEFAULT_TRACK_POINT_STATE.range)),
			size: Number.isFinite(mergedState.size) ? mergedState.size : DEFAULT_TRACK_POINT_STATE.size,
			opacity: Number.isFinite(mergedState.opacity)
				? mergedState.opacity
				: DEFAULT_TRACK_POINT_STATE.opacity,
			showLabel: Boolean(mergedState.showLabel),
		};
	}

	/** 重建全部圆环 mesh。 */
	_rebuildMeshes() {
		clearTrackPointGroup(this.group);
		this.hoveredMesh = null;
		this.pointerDown = null;

		const ringArgs = getTrackPointRingArgs(this.state.size);
		for (const point of this.points) {
			const mesh = createTrackPointMesh({
				point,
				ringArgs,
				showLabel: this.state.showLabel,
			});
			this.group.add(mesh);
		}

		this._refreshMeshes();
	}

	/** 刷新全部圆环当前状态。 */
	_refreshMeshes() {
		const renderState = {
			visible: this.state.visible,
			activeIndex: this.state.activeIndex,
			range: this.state.range,
			baseOpacity: getTrackPointBaseOpacity(this.state.opacity),
			showLabel: this.state.showLabel,
		};

		this.group.visible = this.state.visible;
		for (const child of this.group.children) {
			refreshTrackPointMesh(child, renderState);
		}

		if (!this.state.visible || !this.state.interactive) {
			this._updateHoveredMesh(null);
			this.pointerDown = null;
		}
	}

	/**
	 * 更新当前 hover 的圆环并同步透明度。
	 * @param {THREE.Mesh | null} nextHoveredMesh
	 */
	_updateHoveredMesh(nextHoveredMesh) {
		if (this.hoveredMesh === nextHoveredMesh) {
			return;
		}

		if (this.hoveredMesh) {
			this.hoveredMesh.userData.trackPointHovered = false;
			this._refreshSingleMesh(this.hoveredMesh);
		}

		this.hoveredMesh = nextHoveredMesh;

		if (this.hoveredMesh) {
			this.hoveredMesh.userData.trackPointHovered = true;
			this._refreshSingleMesh(this.hoveredMesh);
		}
	}

	/**
	 * 刷新单个圆环状态。
	 * @param {THREE.Mesh | null} mesh
	 */
	_refreshSingleMesh(mesh) {
		if (!mesh) {
			return;
		}

		refreshTrackPointMesh(mesh, {
			visible: this.state.visible,
			activeIndex: this.state.activeIndex,
			range: this.state.range,
			baseOpacity: getTrackPointBaseOpacity(this.state.opacity),
			showLabel: this.state.showLabel,
		});
	}

	/**
	 * 判断当前是否允许轨迹点交互。
	 * @returns {boolean}
	 */
	_canInteract() {
		return this.state.visible && this.state.interactive && !this.viewer.measuringTool?.eventMeasurement;
	}

	/**
	 * 对当前可见轨迹点执行精确拾取。
	 * @param {PointerEvent} event
	 * @returns {THREE.Mesh | null}
	 */
	_pickTrackPointMesh(event) {
		const domElement = this.viewer?.renderer?.domElement;
		const camera = this.viewer?.scene?.getActiveCamera?.();
		if (!domElement || !camera) {
			return null;
		}

		const rect = domElement.getBoundingClientRect();
		pointerNdc.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1,
		);
		raycaster.setFromCamera(pointerNdc, camera);

		const intersections = raycaster.intersectObjects(
			this.group.children.filter((child) => child.visible),
			false,
		);

		return intersections[0]?.object ?? null;
	}

	/**
	 * 处理 hover。
	 * @param {PointerEvent} event
	 */
	_handlePointerMove(event) {
		if (!this._canInteract()) {
			this._updateHoveredMesh(null);
			return;
		}

		const hoveredMesh = this._pickTrackPointMesh(event);
		this._updateHoveredMesh(hoveredMesh);
	}

	/**
	 * 记录 pointerdown，用于 click 判定。
	 * @param {PointerEvent} event
	 */
	_handlePointerDown(event) {
		if (event.button !== 0 || !this._canInteract()) {
			this.pointerDown = null;
			return;
		}

		const hitMesh = this._pickTrackPointMesh(event);
		if (!hitMesh) {
			this.pointerDown = null;
			return;
		}

		this.pointerDown = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			mesh: hitMesh,
		};
	}

	/**
	 * 在 pointerup 时判断是否是轨迹点 click。
	 * @param {PointerEvent} event
	 */
	_handlePointerUp(event) {
		const pointerDown = this.pointerDown;
		this.pointerDown = null;

		if (!pointerDown || event.button !== 0) {
			return;
		}

		if (pointerDown.pointerId !== event.pointerId) {
			return;
		}

		if (!this._canInteract()) {
			return;
		}

		if (getPointerDistance(pointerDown, event) > TRACK_POINT_CLICK_THRESHOLD_PX) {
			return;
		}

		const hitMesh = this._pickTrackPointMesh(event);
		if (!hitMesh || hitMesh !== pointerDown.mesh) {
			return;
		}

		const point = hitMesh.userData.trackPoint;
		const eventPayload = {
			type: "track_point_click",
			tool: this,
			viewer: this.viewer,
			index: point.index,
			point,
		};
		this.dispatchEvent(eventPayload);
		this.viewer.dispatchEvent(eventPayload);
	}

	/** 统一清理 pointer 和 hover 状态。 */
	_resetPointerState() {
		this.pointerDown = null;
		this._updateHoveredMesh(null);
	}

	/**
	 * 设置轨迹点数据。
	 * @param {Array<Object>} points
	 */
	setData(points = []) {
		this.points = this._normalizePoints(points);
		this._rebuildMeshes();
	}

	/**
	 * 设置轨迹点渲染状态。
	 * @param {Object} nextState
	 */
	setState(nextState = {}) {
		const previousState = this.state;
		this.state = this._normalizeState(nextState);

		const requiresRebuild =
			previousState.size !== this.state.size ||
			previousState.showLabel !== this.state.showLabel;

		if (requiresRebuild) {
			this._rebuildMeshes();
			return;
		}

		this._refreshMeshes();
	}

	/** 清空轨迹点数据并重置显示状态。 */
	clear() {
		this.points = [];
		this.state = { ...DEFAULT_TRACK_POINT_STATE };
		clearTrackPointGroup(this.group);
		this.group.visible = false;
		this._resetPointerState();
	}

	/**
	 * 在 overlay pass 中单独渲染轨迹点圆环，保证其不被 EDL 点云合成结果覆盖。
	 */
	render() {
		if (!this.group.visible) {
			return;
		}

		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	dispose() {
		this.viewer.removeEventListener("render.pass.perspective_overlay", this._onRender);
		this._unbindPointerEvents();
		this.clear();
		this.scene.remove(this.group);
	}
}
