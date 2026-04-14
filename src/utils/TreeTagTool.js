import * as THREE from "../../libs/three.js/build/three.module.js";
import { TreeTag } from "./TreeTag.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";
import {
	clearPointcloudEffects,
	isGroupPointcloudSource,
	setPointcloudEDLEnabled,
	setPointcloudXRAYEnabled,
} from "../viewer/PointcloudEffectUtils.js";

/** 按下与松开之间位移超过该阈值（像素）时视为拖拽，不触发选中。 */
const POINTER_DRAG_THRESHOLD_PX = 5;
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _targetWorldPosition = new THREE.Vector3();
const _boxSize = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();

export class TreeTagTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.scene = new THREE.Scene();
		this.scene.name = "scene_tree_tag";
		this.tags = new Map(); // pointcloud -> TreeTag
		/** 当前高亮对应的身份键，优先 `pointcloud.userData.key`，缺省时回退到 `pointcloud.name`。 */
		this.highlightedKeys = [];

		this._pointerActiveId = null;
		this._pointerDownX = 0;
		this._pointerDownY = 0;

		this._onPointcloudAdded = (e) => this._onPointcloudAddedOrVisibilityChanged(e.pointcloud);
		this._onVisibilityChanged = (e) => this._onPointcloudAddedOrVisibilityChanged(e.pointcloud);
		this._onSceneChange = (e) => this._handleSceneChange(e);
		this._onPointerDown = (e) => this._handlePointerDown(e);
		this._onPointerUpDocument = (e) => this._handlePointerUpDocument(e);
		this._onPointerCancelDocument = (e) => this._handlePointerCancelDocument(e);
		this._onUpdate = () => this.update();
		this._onRender = () => this.render();

		// 初始化时先为已有点云绑定可见性监听，再同步标签和效果状态。
		for (const pointcloud of viewer.scene.pointclouds) {
			this._bindVisibilityChanged(pointcloud);
		}
		this._syncTags();

		viewer.addEventListener("update", this._onUpdate);
		viewer.addEventListener("render.pass.perspective_overlay", this._onRender);
		viewer.addEventListener("scene_changed", this._onSceneChange);
		viewer.scene.addEventListener("pointcloud_added", this._onPointcloudAdded);

		const renderArea = this._getRenderArea();
		if (renderArea) {
			renderArea.addEventListener("pointerdown", this._onPointerDown);
		}
	}

	_clearPointerDocumentListeners() {
		document.removeEventListener("pointerup", this._onPointerUpDocument);
		document.removeEventListener("pointercancel", this._onPointerCancelDocument);
	}

	_handlePointerDown(e) {
		if (e.button !== 0) {
			return;
		}

		// 如果测量工具正在绘制标记，则跳过 TreeTagTool 的指针事件处理，避免功能冲突。
		if (this.viewer.measuringTool?.eventMeasurement) {
			return;
		}

		this._pointerActiveId = e.pointerId;
		this._pointerDownX = e.clientX;
		this._pointerDownY = e.clientY;
		document.addEventListener("pointerup", this._onPointerUpDocument);
		document.addEventListener("pointercancel", this._onPointerCancelDocument);
	}

	_handlePointerUpDocument(e) {
		if (this._pointerActiveId === null || e.pointerId !== this._pointerActiveId) {
			return;
		}
		this._clearPointerDocumentListeners();
		this._pointerActiveId = null;

		if (e.button !== 0) {
			return;
		}

		const dx = e.clientX - this._pointerDownX;
		const dy = e.clientY - this._pointerDownY;
		const th = POINTER_DRAG_THRESHOLD_PX;
		if (dx * dx + dy * dy > th * th) {
			return;
		}

		this._handleClick(e);
	}

	_handlePointerCancelDocument(e) {
		if (this._pointerActiveId === null || e.pointerId !== this._pointerActiveId) {
			return;
		}
		this._clearPointerDocumentListeners();
		this._pointerActiveId = null;
	}

	_getRenderArea() {
		const ra = this.viewer.renderArea;
		return ra instanceof HTMLElement ? ra : ra && ra[0] ? ra[0] : null;
	}

	_getVisiblePointclouds() {
		return this.viewer.scene.pointclouds.filter(
			(pc) => pc.visible !== false
		);
	}

	_isGroupSource() {
		// TreeTag 多点云模式统一由来源模式控制，而不是依赖可见数量。
		return isGroupPointcloudSource(this.viewer);
	}

	_isEDLSupported() {
		// 测试环境里的 viewer 可能只是最小 mock，这里对能力检测做兼容兜底。
		if (typeof this.viewer.isEDLSupported === "function") {
			return this.viewer.isEDLSupported();
		}

		return true;
	}

	/**
	 * 与标签、选中一致的身份键：优先 `userData.key`，否则回退到 `name`。
	 * @param {Object} pointcloud
	 * @returns {string}
	 */
	_highlightIdentityKey(pointcloud) {
		const key = pointcloud?.userData?.key;
		if (key !== undefined && key !== null) {
			return String(key);
		}

		return String(pointcloud?.name ?? "");
	}

	_findPointcloudByHighlightKey(key) {
		for (const pc of this.viewer.scene.pointclouds) {
			if (this._highlightIdentityKey(pc) === key) {
				return pc;
			}
		}

		return null;
	}

	_bindVisibilityChanged(pointcloud) {
		if (pointcloud._treeTagToolVisibilityBound) {
			return;
		}

		pointcloud._treeTagToolVisibilityBound = true;
		pointcloud.addEventListener("visibility_changed", this._onVisibilityChanged);
	}

	_unbindVisibilityChanged(pointcloud) {
		if (!pointcloud._treeTagToolVisibilityBound) {
			return;
		}

		pointcloud._treeTagToolVisibilityBound = false;
		pointcloud.removeEventListener("visibility_changed", this._onVisibilityChanged);
	}

	_onPointcloudAddedOrVisibilityChanged(pointcloud) {
		this._bindVisibilityChanged(pointcloud);
		this._syncTags();
	}

	_syncTags() {
		const visible = this._getVisiblePointclouds();

		if (!this._isGroupSource()) {
			this.highlightedKeys = [];
			for (const pc of [...this.tags.keys()]) {
				this._removeTagForPointcloud(pc);
			}
			this._applyHighlightStates();
			return;
		}

		for (const pc of [...this.tags.keys()]) {
			if (!visible.includes(pc)) {
				this._removeTagForPointcloud(pc);
			}
		}

		// 仅为尚未创建 tag 的可见点云补齐 sprite，文案优先 `userData.key`。
		visible.forEach((pc, i) => {
			if (this.tags.has(pc)) {
				return;
			}

			const tag = new TreeTag(pc, i + 1);
			this.tags.set(pc, tag);
			this.scene.add(tag);
		});

		this._applyHighlightStates();
	}

	_removeTagForPointcloud(pointcloud) {
		const tag = this.tags.get(pointcloud);
		if (tag) {
			tag.dispose();
			this.tags.delete(pointcloud);
			const idKey = this._highlightIdentityKey(pointcloud);
			this.highlightedKeys = this.highlightedKeys.filter((k) => k !== idKey);
		}
	}

	_handleSceneChange(e) {
		if (e.oldScene) {
			e.oldScene.removeEventListener("pointcloud_added", this._onPointcloudAdded);
			for (const pc of e.oldScene.pointclouds) {
				this._unbindVisibilityChanged(pc);
				this._removeTagForPointcloud(pc);
			}
		}

		e.scene.addEventListener("pointcloud_added", this._onPointcloudAdded);
		for (const pc of e.scene.pointclouds) {
			this._bindVisibilityChanged(pc);
		}
		this._syncTags();
	}

	_getClientToNdc(clientX, clientY) {
		const canvas = this.renderer.domElement;
		const rect = canvas.getBoundingClientRect();
		const width = rect.width || canvas.clientWidth || 1;
		const height = rect.height || canvas.clientHeight || 1;

		_pointerNdc.set(
			((clientX - rect.left) / width) * 2 - 1,
			-((clientY - rect.top) / height) * 2 + 1,
		);

		return _pointerNdc;
	}

	_pickTag(clientX, clientY) {
		const camera = this.viewer.scene.getActiveCamera();
		const pointer = this._getClientToNdc(clientX, clientY);

		_raycaster.setFromCamera(pointer, camera);
		const intersections = _raycaster.intersectObjects([...this.tags.values()], false);

		return intersections[0]?.object ?? null;
	}

	/**
	 * 点击优先级：先判断 sprite tag 命中，没有命中时再射线检测点云。
	 */
	_handleClick(e) {
		const hitTag = this._pickTag(e.clientX, e.clientY);
		if (hitTag) {
			this._applySelection(hitTag.pointcloud, e.ctrlKey || e.metaKey);
			return;
		}

		const canvas = this.renderer.domElement;
		const rect = canvas.getBoundingClientRect();
		const mouse = new THREE.Vector2(
			e.clientX - rect.left,
			e.clientY - rect.top
		);

		const camera = this.viewer.scene.getActiveCamera();
		const pointcloudsToPick = Array.from(this.tags.keys());
		const intersection = Utils.getMousePointCloudIntersection(
			mouse,
			camera,
			this.viewer,
			pointcloudsToPick
		);

		if (intersection && intersection.pointcloud) {
			this._applySelection(intersection.pointcloud, e.ctrlKey || e.metaKey);
		}
	}

	/**
	 * 应用选择规则并更新 highlightedKeys。
	 * @param {Object} pointcloud
	 * @param {boolean} ctrlKey
	 */
	_applySelection(pointcloud, ctrlKey) {
		const key = this._highlightIdentityKey(pointcloud);
		if (ctrlKey) {
			const idx = this.highlightedKeys.indexOf(key);
			if (idx >= 0) {
				this.highlightedKeys = this.highlightedKeys.filter((k) => k !== key);
			} else {
				this.highlightedKeys = [...this.highlightedKeys, key];
			}
		} else if (
			this.highlightedKeys.length === 1 &&
			this.highlightedKeys[0] === key
		) {
			this.highlightedKeys = [];
		} else {
			this.highlightedKeys = [key];
		}

		this._applyHighlightStates();
	}

	_applyHighlightStates() {
		const highlightedKeys = this.highlightedKeys;
		const hasSelection = highlightedKeys.length > 0;
		const edlSupported = this._isEDLSupported();

		if (!this._isGroupSource() || this.tags.size === 0) {
			// 非多点云模式下不再维持 TreeTag 带来的批量效果状态。
			for (const pc of this.viewer.scene.pointclouds) {
				clearPointcloudEffects(pc);
			}
		} else {
			for (const [pointcloud, tag] of this.tags) {
				const idKey = this._highlightIdentityKey(pointcloud);
				const isHighlighted =
					!hasSelection || highlightedKeys.includes(idKey);

				if (edlSupported) {
					if (isHighlighted) {
						// 高亮点云直接切到 EDL，未高亮点云切到 XRAY。
						setPointcloudEDLEnabled(pointcloud, true, true);
					} else {
						setPointcloudXRAYEnabled(pointcloud, true);
					}
				} else if (isHighlighted) {
					// 无 EDL 能力时回退到旧逻辑：高亮项保持普通显示。
					clearPointcloudEffects(pointcloud);
				} else {
					setPointcloudXRAYEnabled(pointcloud, true);
				}

				tag.updateStyle(isHighlighted);
			}
		}

		this.viewer.scene.dispatchEvent({
			type: "tree_tag_highlight_changed",
			highlightedKeys: [...this.highlightedKeys],
			highlightedPointclouds: this.getHighlightedPointclouds(),
			scene: this.viewer.scene,
		});
	}

	_getTagAnchorWorldPosition(pointcloud, tagBaseScale = 0) {
		pointcloud.updateMatrixWorld?.(true);

		const offset = pointcloud.userData?.offset ?? { x: 0, y: 0, z: 0 };
		const hasExplicitLocation =
			pointcloud.userData?.locX != null &&
			pointcloud.userData?.locY != null &&
			pointcloud.userData?.locZ != null;

		if (hasExplicitLocation) {
			// 标签锚点沿 z 轴下移半个标签边长，替代原先固定的 -0.4 偏移。
			const halfTagSize = Math.max(0, tagBaseScale);
			_targetWorldPosition.set(
				Number(pointcloud.userData.locX) + Number(offset.x ?? 0),
				Number(pointcloud.userData.locY) + Number(offset.y ?? 0),
				Number(pointcloud.userData.locZ) + Number(offset.z ?? 0) - halfTagSize,
			);
			return _targetWorldPosition;
		}

		const box = pointcloud.pcoGeometry?.tightBoundingBox || pointcloud.boundingBox;
		if (!box) {
			return null;
		}

		const boxWorld = Utils.computeTransformedBoundingBox(
			box,
			pointcloud.matrixWorld
		);
		boxWorld.getCenter(_boxCenter);
		_targetWorldPosition.set(
			_boxCenter.x,
			_boxCenter.y,
			boxWorld.min.z,
		);

		return _targetWorldPosition;
	}

	_getTagBaseScale(pointcloud) {
		const box = pointcloud.pcoGeometry?.tightBoundingBox || pointcloud.boundingBox;
		if (!box) {
			return 1.5;
		}

		const boxWorld = Utils.computeTransformedBoundingBox(
			box,
			pointcloud.matrixWorld
		);
		boxWorld.getSize(_boxSize);
		const maxDimension = Math.max(_boxSize.x, _boxSize.y, _boxSize.z);

		// 让标签基础尺寸和点云体量挂钩，再交给 sprite 的 sizeAttenuation 处理远近变化。
		return THREE.MathUtils.clamp(maxDimension * 0.03, 1.2, 24);
	}

	update() {
		const camera = this.viewer.scene.getActiveCamera();

		for (const [pointcloud, tag] of this.tags) {
			const tagBaseScale = this._getTagBaseScale(pointcloud);
			const targetWorldPosition = this._getTagAnchorWorldPosition(pointcloud, tagBaseScale);
			if (!targetWorldPosition) {
				tag.visible = false;
				continue;
			}

			_viewPosition.copy(targetWorldPosition).applyMatrix4(camera.matrixWorldInverse);
			if (_viewPosition.z > 0) {
				tag.visible = false;
				continue;
			}

			tag.visible = pointcloud.visible !== false;
			tag.position.copy(targetWorldPosition);
			tag.setBaseScale(tagBaseScale);
		}
	}

	render() {
		this.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	/**
	 * 获取当前高亮对应的身份键（优先 `userData.key`，否则 `name`）。
	 */
	getHighlightedKeys() {
		return [...this.highlightedKeys];
	}

	/**
	 * 根据当前高亮键解析出点云对象数组。
	 */
	getHighlightedPointclouds() {
		return this.highlightedKeys
			.map((k) => this._findPointcloudByHighlightKey(k))
			.filter(Boolean);
	}

	/**
	 * 供外部修改高亮状态时调用，传入键值数组或点云对象数组。
	 * @param {Array<string|number|Object>} items
	 */
	setHighlightedPointclouds(items) {
		if (!Array.isArray(items)) {
			this.highlightedKeys = [];
		} else {
			// 外部可能直接传字符串数组，这里统一保留为字符串，避免强转数字。
			this.highlightedKeys = items.map((item) => {
				if (item && typeof item === "object") {
					return this._highlightIdentityKey(item);
				}

				return String(item);
			});
		}
		this._applyHighlightStates();
	}

	dispose() {
		this._clearPointerDocumentListeners();
		this._pointerActiveId = null;

		const renderArea = this._getRenderArea();
		if (renderArea) {
			renderArea.removeEventListener("pointerdown", this._onPointerDown);
		}

		this.viewer.removeEventListener("update", this._onUpdate);
		this.viewer.removeEventListener("render.pass.perspective_overlay", this._onRender);
		this.viewer.removeEventListener("scene_changed", this._onSceneChange);
		this.viewer.scene.removeEventListener("pointcloud_added", this._onPointcloudAdded);

		for (const pc of this.viewer.scene.pointclouds) {
			this._unbindVisibilityChanged(pc);
		}

		for (const tag of this.tags.values()) {
			tag.dispose();
		}
		this.tags.clear();
		this.highlightedKeys = [];
	}
}
