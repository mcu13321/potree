import * as THREE from "../../libs/three.js/build/three.module.js";
import { TreeTag } from "./TreeTag.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";

/** 按下与松开之间位移超过该值（像素）则视为拖拽（如旋转相机），不触发选中 */
const POINTER_DRAG_THRESHOLD_PX = 5;

export class TreeTagTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.tags = new Map(); // pointcloud -> TreeTag
		/** 当前高亮对应的身份键，优先为 `pointcloud.userData.key`，缺省时为 `pointcloud.name`。空数组表示无选中（全部高亮） */
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

		// 初始同步：为已有点云绑定 visibility_changed，并执行 _syncTags
		for (const pointcloud of viewer.scene.pointclouds) {
			this._bindVisibilityChanged(pointcloud);
		}
		this._syncTags();

		viewer.addEventListener("update", this._onUpdate);
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

	/**
	 * 与标签、选中一致的身份键：优先 `userData.key`，否则 `name`（与无 key 时 TreeTag 展示回退一致）
	 * @param {Object} pointcloud
	 * @returns {string|number}
	 */
	_highlightIdentityKey(pointcloud) {
		const k = pointcloud?.userData?.key;
		if (k !== undefined && k !== null) {
			return k;
		}
		return pointcloud?.name ?? "";
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
		if (pointcloud._treeTagToolVisibilityBound) return;
		pointcloud._treeTagToolVisibilityBound = true;
		pointcloud.addEventListener("visibility_changed", this._onVisibilityChanged);
	}

	_unbindVisibilityChanged(pointcloud) {
		if (!pointcloud._treeTagToolVisibilityBound) return;
		pointcloud._treeTagToolVisibilityBound = false;
		pointcloud.removeEventListener("visibility_changed", this._onVisibilityChanged);
	}

	_onPointcloudAddedOrVisibilityChanged(pointcloud) {
		this._bindVisibilityChanged(pointcloud);
		this._syncTags();
	}

	/**
	 * 同步 tag：仅当多个点云可见时添加 tag，已添加的不重复添加；可见数<2 时移除所有 tag
	 */
	_syncTags() {
		const visible = this._getVisiblePointclouds();

		if (visible.length < 2) {
			// 移除所有 tag，清空高亮状态
			this.highlightedKeys = [];
			for (const pc of [...this.tags.keys()]) {
				this._removeTagForPointcloud(pc);
			}
			this._applyXRAYStates();
			return;
		}

		// 移除不可见点云的 tag
		for (const pc of [...this.tags.keys()]) {
			if (!visible.includes(pc)) {
				this._removeTagForPointcloud(pc);
			}
		}

		// 仅为尚未有 tag 的可见点云添加 tag；文案优先 `userData.key`，否则为可见顺序 1,2,3…
		visible.forEach((pc, i) => {
			if (this.tags.has(pc)) return;
			const tag = new TreeTag(pc, i + 1);
			this.tags.set(pc, tag);
			const renderArea = this._getRenderArea();
			if (renderArea && tag.domElement && !tag.domElement.parentElement) {
				renderArea.appendChild(tag.domElement);
			}
		});

		this._applyXRAYStates();
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

	/**
	 * 点击优先级：先判断 tag 命中，没有任何 tag 命中时再射线检测点云
	 */
	_handleClick(e) {
		// 1. event.target 是否为 tag DOM
		let hitTag = null;
		for (const tag of this.tags.values()) {
			if (e.target === tag.domElement) {
				hitTag = tag;
				break;
			}
		}

		// 2. 若未直接命中，遍历所有 tag 的 getBoundingClientRect
		if (!hitTag) {
			const clientX = e.clientX;
			const clientY = e.clientY;
			for (const tag of this.tags.values()) {
				if (!tag.domElement || tag.domElement.style.display === "none") continue;
				const rect = tag.domElement.getBoundingClientRect();
				if (
					clientX >= rect.left &&
					clientX <= rect.right &&
					clientY >= rect.top &&
					clientY <= rect.bottom
				) {
					hitTag = tag;
					break;
				}
			}
		}

		// 3. 若有 tag 命中，使用该 tag 的 pointcloud
		if (hitTag) {
			this._applySelection(hitTag.pointcloud, e.ctrlKey || e.metaKey);
			return;
		}

		// 4. 没有任何 tag 命中，射线检测点云
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
	 * 应用选择规则并更新 highlightedKeys
	 * @param {Object} pointcloud - 被点击的点云
	 * @param {boolean} ctrlKey - 是否 Ctrl 多选
	 */
	_applySelection(pointcloud, ctrlKey) {
		const key = this._highlightIdentityKey(pointcloud);
		if (ctrlKey) {
			// Ctrl + 点击：切换多选
			const idx = this.highlightedKeys.indexOf(key);
			if (idx >= 0) {
				this.highlightedKeys = this.highlightedKeys.filter((k) => k !== key);
			} else {
				this.highlightedKeys = [...this.highlightedKeys, key];
			}
		} else {
			// 非 Ctrl：单选
			if (
				this.highlightedKeys.length === 1 &&
				this.highlightedKeys[0] === key
			) {
				// 已是唯一选中，取消选中
				this.highlightedKeys = [];
			} else {
				this.highlightedKeys = [key];
			}
		}

		this._applyXRAYStates();
	}

	_applyXRAYStates() {
		const highlightedKeys = this.highlightedKeys;
		const hasSelection = highlightedKeys.length > 0;

		if (this.tags.size === 0) {
			// 无 tag 时，所有点云高亮
			for (const pc of this.viewer.scene.pointclouds) {
				if (!pc.userData) pc.userData = {};
				pc.userData.xrayEnabled = false;
			}
		} else {
			for (const [pointcloud, tag] of this.tags) {
				if (!pointcloud.userData) pointcloud.userData = {};
				const idKey = this._highlightIdentityKey(pointcloud);
				const isHighlighted =
					!hasSelection || highlightedKeys.includes(idKey);
				pointcloud.userData.xrayEnabled = !isHighlighted;
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

	update() {
		const camera = this.viewer.scene.getActiveCamera();
		const renderAreaSize = this.viewer.renderer.getSize(new THREE.Vector2());
		const clientWidth = renderAreaSize.width;
		const clientHeight = renderAreaSize.height;

		for (const [pointcloud, tag] of this.tags) {
			const domElement = tag.domElement;
			if (!domElement) continue;

			const box = pointcloud.pcoGeometry?.tightBoundingBox || pointcloud.boundingBox;
			if (!box) continue;

			const boxWorld = Utils.computeTransformedBoundingBox(
				box,
				pointcloud.matrixWorld
			);
			const center = boxWorld.getCenter(new THREE.Vector3());
			const bottomCenterWorld = new THREE.Vector3(
				center.x,
				center.y,
				boxWorld.min.z
			);

			const viewPos = bottomCenterWorld
				.clone()
				.applyMatrix4(camera.matrixWorldInverse);
			if (viewPos.z > 0) {
				domElement.style.display = "none";
				continue;
			}

			const screenPos = bottomCenterWorld.clone().project(camera);
			const x = Math.round((screenPos.x + 1) * clientWidth / 2);
			const y = Math.round((-screenPos.y + 1) * clientHeight / 2);

			domElement.style.display = "flex";
			domElement.style.left = `${x - 12}px`;
			domElement.style.top = `${y - 12}px`;
		}
	}

	/**
	 * 获取当前高亮对应的身份键（优先 `userData.key`，否则 `name`）。空数组表示无选中（全部高亮）。
	 */
	getHighlightedKeys() {
		return [...this.highlightedKeys];
	}

	/**
	 * 根据当前高亮键解析出的点云对象数组（顺序与键一致）。
	 */
	getHighlightedPointclouds() {
		return this.highlightedKeys
			.map((k) => this._findPointcloudByHighlightKey(k))
			.filter(Boolean);
	}

	/**
	 * 供外部修改高亮状态时调用。更新内部键列表并同步到 userData 与 tag 样式。
	 * @param {Array<string|number|Object>} items - 可为 `userData.key` 同类型的键，或点云对象（将按 `userData.key` / `name` 换算）
	 */
	setHighlightedPointclouds(items) {
		if (!Array.isArray(items)) {
			this.highlightedKeys = [];
		} else {
			this.highlightedKeys = items.map(v => Number(v));
		}
		this._applyXRAYStates();
	}

	dispose() {
		this._clearPointerDocumentListeners();
		this._pointerActiveId = null;

		const renderArea = this._getRenderArea();
		if (renderArea) {
			renderArea.removeEventListener("pointerdown", this._onPointerDown);
		}

		this.viewer.removeEventListener("update", this._onUpdate);
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
