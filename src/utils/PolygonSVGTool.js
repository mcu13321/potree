
import { EventDispatcher } from "../EventDispatcher.js";

/**
 * 多边形标注工具 - 纯2D SVG渲染方案
 *
 * 左键点击添加顶点，右键闭合多边形完成绘制。
 * 绘制过程中 Ctrl+Z 可撤销最近一个点。
 * 多边形存在期间禁用相机操作，清除后恢复。
 */
export class PolygonSVGTool extends EventDispatcher {
	constructor(viewer) {
		super();
		this.viewer = viewer;

		// 裁剪数据快照（顶点 + 相机 + 视口）
		this._clipData = null;

		// 多边形顶点的屏幕坐标 [{x, y}, ...]
		this.vertices = null;
		// 当前鼠标位置（绘制时跟随光标的预览线用）
		this.currentMousePos = null;

		// 是否正在绘制
		this.isDrawing = false;
		// 是否正在拖拽顶点（编辑模式）
		this.isDraggingVertex = false;
		this.draggingVertexIndex = -1;

		// SVG 容器
		this.svgContainer = null;
		// SVG 元素引用
		this.polygonElement = null;   // 已完成的多边形填充
		this.previewLine = null;      // 绘制中的折线预览（polyline）
		this.circleElements = [];

		// 绑定的事件处理器引用
		this._onMouseDown = this.onMouseDown.bind(this);
		this._onMouseMove = this.onMouseMove.bind(this);
		this._onMouseUp = this.onMouseUp.bind(this);
		this._onContextMenu = this.onContextMenu.bind(this);
		this._onKeyDown = this.onKeyDown.bind(this);

		this._initSVG();
	}

	// ==================== 初始化 ====================

	_initSVG() {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("id", "polygon_svg_overlay");
		svg.style.position = "absolute";
		svg.style.top = "0";
		svg.style.left = "0";
		svg.style.width = "100%";
		svg.style.height = "100%";
		svg.style.pointerEvents = "none";
		svg.style.zIndex = "1001";
		this.svgContainer = svg;
		this.viewer.renderArea.appendChild(svg);
	}

	// ==================== 公开 API ====================

	/**
	 * 开始绘制多边形
	 */
	startInsertion() {
		if (this.vertices) {
			this._clearSVGElements();
		}
		this.vertices = [];
		this.currentMousePos = null;
		this.isDrawing = true;

		this._disableCamera();

		this.svgContainer.style.pointerEvents = "auto";
		this.svgContainer.style.cursor = "crosshair";

		// 创建预览折线
		this._createPreviewLine();

		this.svgContainer.addEventListener("mousedown", this._onMouseDown);
		this.svgContainer.addEventListener("mousemove", this._onMouseMove);
		this.svgContainer.addEventListener("mouseup", this._onMouseUp);
		this.svgContainer.addEventListener("contextmenu", this._onContextMenu);
		document.addEventListener("keydown", this._onKeyDown, true);

		this.dispatchEvent({ type: "start_insertion" });
	}

	/**
	 * 停止 / 清除多边形
	 */
	stopInsertion() {
		this.isDrawing = false;
		this.isDraggingVertex = false;
		this.draggingVertexIndex = -1;
		this.vertices = null;
		this._clipData = null;
		this.currentMousePos = null;

		this.svgContainer.removeEventListener("mousedown", this._onMouseDown);
		this.svgContainer.removeEventListener("mousemove", this._onMouseMove);
		this.svgContainer.removeEventListener("mouseup", this._onMouseUp);
		this.svgContainer.removeEventListener("contextmenu", this._onContextMenu);
		document.removeEventListener("keydown", this._onKeyDown, true);

		this._clearSVGElements();

		this.svgContainer.style.pointerEvents = "none";
		this.svgContainer.style.cursor = "default";

		this._enableCamera();

		this.dispatchEvent({ type: "stop_insertion" });
	}

	clear() {
		this.stopInsertion();
	}

	/**
	 * 获取多边形的屏幕坐标数据
	 */
	getPolygon() {
		return this.vertices ? this.vertices.map(v => ({ ...v })) : null;
	}

	// ==================== 鼠标事件 ====================

	onMouseDown(e) {
		// 仅处理左键
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();

		const pos = this._getLocalPosition(e);

		// --- 绘制模式：左键添加点 ---
		if (this.isDrawing) {
			this.vertices.push({ x: pos.x, y: pos.y });
			this._updatePreviewLine();
			return;
		}

		// --- 编辑模式：检测顶点拖拽 ---
		if (this.vertices && !this.isDrawing) {
			const hitIndex = this._hitTestVertices(pos);
			if (hitIndex >= 0) {
				this.isDraggingVertex = true;
				this.draggingVertexIndex = hitIndex;
			}
		}
	}

	onMouseMove(e) {
		e.preventDefault();
		e.stopPropagation();

		const pos = this._getLocalPosition(e);

		// 绘制中：更新预览线的最后一段（当前鼠标位置）
		if (this.isDrawing) {
			this.currentMousePos = pos;
			this._updatePreviewLine();
			return;
		}

		// 编辑中：拖拽顶点
		if (this.isDraggingVertex && this.draggingVertexIndex >= 0) {
			this.vertices[this.draggingVertexIndex] = { x: pos.x, y: pos.y };
			this._updatePolygon();
			this._updateCircles();
		}
	}

	onMouseUp(e) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();

		// 编辑拖拽完成
		if (this.isDraggingVertex) {
			this.isDraggingVertex = false;
			this.draggingVertexIndex = -1;

			// 更新裁剪数据快照
			this._snapshotCamera();

			this.dispatchEvent({
				type: "polygon_modified",
				vertices: this.getPolygon(),
				clipData: this.getClipData(),
			});
		}
	}

	onContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();

		// 右键完成多边形绘制（至少需要3个点）
		if (this.isDrawing && this.vertices.length >= 3) {
			this._finishDrawing();
		}
	}

	onKeyDown(e) {
		// Ctrl+Z 撤销最近一个点（兼容不同键盘布局/系统）
		const isCtrlZ = (e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.keyCode === 90);
		if (isCtrlZ && this.isDrawing && this.vertices.length > 0) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			this.vertices.pop();
			this._updatePreviewLine();
		}
	}

	// ==================== 内部逻辑 ====================

	/**
	 * 完成绘制：移除预览线，创建正式多边形和控制点
	 */
	_finishDrawing() {
		this.isDrawing = false;
		this.currentMousePos = null;
		this.svgContainer.style.cursor = "default";

		// 移除预览折线
		if (this.previewLine) {
			this.previewLine.remove();
			this.previewLine = null;
		}

		// 创建正式多边形和控制点
		this._createPolygon();
		this._updatePolygon();
		this._createCircles();
		this._updateCircles();

		// 保存裁剪数据快照
		this._snapshotCamera();

		this.dispatchEvent({
			type: "polygon_drawn",
			vertices: this.getPolygon(),
			clipData: this.getClipData(),
		});
	}

	// ==================== SVG 渲染 ====================

	_createPreviewLine() {
		const ns = "http://www.w3.org/2000/svg";
		const polyline = document.createElementNS(ns, "polyline");
		polyline.setAttribute("fill", "rgba(46, 130, 255, 0.10)");
		polyline.setAttribute("stroke", "#2e82ff");
		polyline.setAttribute("stroke-width", "2");
		polyline.setAttribute("stroke-dasharray", "6,3");
		this.svgContainer.appendChild(polyline);
		this.previewLine = polyline;
	}

	_updatePreviewLine() {
		if (!this.previewLine || !this.vertices) return;
		// 已确认的点 + 当前鼠标位置
		let points = this.vertices.map(v => `${v.x},${v.y}`);
		if (this.currentMousePos) {
			points.push(`${this.currentMousePos.x},${this.currentMousePos.y}`);
		}
		this.previewLine.setAttribute("points", points.join(" "));
	}

	_createPolygon() {
		const ns = "http://www.w3.org/2000/svg";
		const polygon = document.createElementNS(ns, "polygon");
		polygon.setAttribute("fill", "rgba(46, 130, 255, 0.15)");
		polygon.setAttribute("stroke", "#2e82ff");
		polygon.setAttribute("stroke-width", "2");
		this.svgContainer.appendChild(polygon);
		this.polygonElement = polygon;
	}

	_updatePolygon() {
		if (!this.polygonElement || !this.vertices) return;
		const pointsStr = this.vertices.map(v => `${v.x},${v.y}`).join(" ");
		this.polygonElement.setAttribute("points", pointsStr);
	}

	_createCircles() {
		const ns = "http://www.w3.org/2000/svg";
		for (let i = 0; i < this.vertices.length; i++) {
			const circle = document.createElementNS(ns, "circle");
			circle.setAttribute("r", "6");
			circle.setAttribute("fill", "#ffffff");
			circle.setAttribute("stroke", "#2e82ff");
			circle.setAttribute("stroke-width", "2");
			circle.style.cursor = "pointer";
			circle.style.pointerEvents = "auto";
			circle.dataset.vertexIndex = i;
			this.svgContainer.appendChild(circle);
			this.circleElements.push(circle);
		}
	}

	_updateCircles() {
		if (!this.vertices) return;
		for (let i = 0; i < this.circleElements.length; i++) {
			const v = this.vertices[i];
			this.circleElements[i].setAttribute("cx", v.x);
			this.circleElements[i].setAttribute("cy", v.y);
		}
	}

	_clearSVGElements() {
		if (this.polygonElement) {
			this.polygonElement.remove();
			this.polygonElement = null;
		}
		if (this.previewLine) {
			this.previewLine.remove();
			this.previewLine = null;
		}
		for (const c of this.circleElements) {
			c.remove();
		}
		this.circleElements = [];
	}

	// ==================== 辅助方法 ====================

	_getLocalPosition(e) {
		const rect = this.svgContainer.getBoundingClientRect();
		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
	}

	_hitTestVertices(pos) {
		if (!this.vertices) return -1;
		const threshold = 10;
		for (let i = 0; i < this.vertices.length; i++) {
			const v = this.vertices[i];
			const dx = pos.x - v.x;
			const dy = pos.y - v.y;
			if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
				return i;
			}
		}
		return -1;
	}

	/**
	 * 拍摄当前相机快照，保存裁剪所需的全部数据
	 */
	_snapshotCamera() {
		const camera = this.viewer.scene.getActiveCamera();
		const domElement = this.viewer.renderer.domElement;

		this._clipData = {
			type: 'polygon',
			vertices: this.vertices.map(v => ({ ...v })),
			viewport: {
				width: domElement.clientWidth,
				height: domElement.clientHeight,
			},
			camera: {
				projectionMatrix: Array.from(camera.projectionMatrix.elements),
				matrixWorldInverse: Array.from(camera.matrixWorldInverse.elements),
			},
		};
	}

	/**
	 * 获取完整的裁剪数据（顶点 + 相机 + 视口），供外部发送给后端
	 * @returns {Object|null}
	 */
	getClipData() {
		if (!this._clipData) return null;
		return JSON.parse(JSON.stringify(this._clipData));
	}

	_disableCamera() {
		if (this.viewer.controls) {
			this.viewer.controls.enabled = false;
		}
	}

	_enableCamera() {
		if (this.viewer.controls) {
			this.viewer.controls.enabled = true;
		}
	}
}
