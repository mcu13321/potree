import * as THREE from "../../libs/three.js/build/three.module.js";
import { TreeTag } from "./TreeTag.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";

export class TreeTagTool extends EventDispatcher {
	constructor(viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.tags = new Map(); // pointcloud -> TreeTag
		this.highlightedPointclouds = []; // 高亮的点云数组，空表示全部高亮

		this._onPointcloudAdded = (e) => this._onPointcloudAddedOrVisibilityChanged(e.pointcloud);
		this._onVisibilityChanged = (e) => this._onPointcloudAddedOrVisibilityChanged(e.pointcloud);
		this._onSceneChange = (e) => this._handleSceneChange(e);
		this._onClick = (e) => this._handleClick(e);
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
			renderArea.addEventListener("click", this._onClick);
		}
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
			this.highlightedPointclouds = [];
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

		// 仅为尚未有 tag 的可见点云添加 tag，index 按可见顺序 1,2,3...
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
			this.highlightedPointclouds = this.highlightedPointclouds.filter(
				(p) => p !== pointcloud
			);
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
	 * 应用选择规则并更新 highlightedPointclouds
	 * @param {Object} pointcloud - 被点击的点云
	 * @param {boolean} ctrlKey - 是否 Ctrl 多选
	 */
	_applySelection(pointcloud, ctrlKey) {
		if (ctrlKey) {
			// Ctrl + 点击：切换多选
			const idx = this.highlightedPointclouds.indexOf(pointcloud);
			if (idx >= 0) {
				this.highlightedPointclouds = this.highlightedPointclouds.filter(
					(p) => p !== pointcloud
				);
			} else {
				this.highlightedPointclouds = [
					...this.highlightedPointclouds,
					pointcloud,
				];
			}
		} else {
			// 非 Ctrl：单选
			if (
				this.highlightedPointclouds.length === 1 &&
				this.highlightedPointclouds[0] === pointcloud
			) {
				// 已是唯一选中，取消选中
				this.highlightedPointclouds = [];
			} else {
				this.highlightedPointclouds = [pointcloud];
			}
		}

		this._applyXRAYStates();
	}

	_applyXRAYStates() {
		const highlighted = this.highlightedPointclouds;
		const hasSelection = highlighted.length > 0;

		if (this.tags.size === 0) {
			// 无 tag 时，所有点云高亮
			for (const pc of this.viewer.scene.pointclouds) {
				if (!pc.userData) pc.userData = {};
				pc.userData.xrayEnabled = false;
			}
		} else {
			for (const [pointcloud, tag] of this.tags) {
				if (!pointcloud.userData) pointcloud.userData = {};
				const isHighlighted = !hasSelection || highlighted.includes(pointcloud);
				pointcloud.userData.xrayEnabled = !isHighlighted;
				tag.updateStyle(isHighlighted);
			}
		}

		this.viewer.scene.dispatchEvent({
			type: "tree_tag_highlight_changed",
			highlightedPointclouds: [...this.highlightedPointclouds],
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
			domElement.style.left = `${x - 15}px`;
			domElement.style.top = `${y - 15}px`;
		}
	}

	/**
	 * 获取当前高亮的点云数组。空数组表示全部高亮（无选中）。
	 */
	getHighlightedPointclouds() {
		return [...this.highlightedPointclouds];
	}

	/**
	 * 供外部修改高亮状态时调用。更新内部数组并同步到 userData 与 tag 样式。
	 * @param {Object[]} pointclouds - 要高亮的点云数组；空数组表示全部高亮（无选中）
	 */
	setHighlightedPointclouds(pointclouds) {
		this.highlightedPointclouds = Array.isArray(pointclouds)
			? [...pointclouds]
			: [];
		this._applyXRAYStates();
	}

	dispose() {
		const renderArea = this._getRenderArea();
		if (renderArea) {
			renderArea.removeEventListener("click", this._onClick);
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
		this.highlightedPointclouds = [];
	}
}
