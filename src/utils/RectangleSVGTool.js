
import { EventDispatcher } from "../EventDispatcher.js";

/**
 * 矩形标注工具 - 纯2D SVG渲染方案
 * 
 * 在 Potree 渲染区域上叠加 SVG 层，用屏幕坐标绘制矩形。
 * 矩形存在期间禁用相机操作，清除后恢复。
 */
export class RectangleSVGTool extends EventDispatcher {
	constructor(viewer) {
		super();
		this.viewer = viewer;

		// 裁剪数据快照（顶点 + 相机 + 视口）
		this._clipData = null;

		// 矩形四个顶点的屏幕坐标 [{x, y}, ...]，顺序：左上、右上、右下、左下
		this.vertices = null;

		// 当前是否处于绘制模式
		this.isDrawing = false;
		// 当前是否正在拖拽顶点
		this.isDraggingVertex = false;
		// 拖拽中的顶点索引
		this.draggingVertexIndex = -1;

		// SVG 容器
		this.svgContainer = null;
		// SVG 元素引用
		this.polygonElement = null;
		this.circleElements = [];

		// 绑定的事件处理器引用（用于移除）
		this._onMouseDown = this.onMouseDown.bind(this);
		this._onMouseMove = this.onMouseMove.bind(this);
		this._onMouseUp = this.onMouseUp.bind(this);

		this._initSVG();
	}

	/**
	 * 初始化 SVG 容器，挂在 renderArea 上
	 */
	_initSVG() {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("id", "rectangle_svg_overlay");
		svg.style.position = "absolute";
		svg.style.top = "0";
		svg.style.left = "0";
		svg.style.width = "100%";
		svg.style.height = "100%";
		// 默认不拦截鼠标事件
		svg.style.pointerEvents = "none";
		svg.style.zIndex = "1000";

		this.svgContainer = svg;
		this.viewer.renderArea.appendChild(svg);
	}

	/**
	 * 开始绘制矩形
	 */
	startInsertion() {
		// 如果已经有矩形存在，先清除
		if (this.vertices) {
			this._clearSVGElements();
		}
		this.vertices = null;
		this.isDrawing = true;

		// 禁用相机控制
		this._disableCamera();

		// SVG 层接收鼠标事件
		this.svgContainer.style.pointerEvents = "auto";
		this.svgContainer.style.cursor = "crosshair";

		// 绑定绘制事件
		this.svgContainer.addEventListener("mousedown", this._onMouseDown);
		this.svgContainer.addEventListener("mousemove", this._onMouseMove);
		this.svgContainer.addEventListener("mouseup", this._onMouseUp);

		this.dispatchEvent({ type: "start_insertion" });
	}

	/**
	 * 停止绘制 / 清除矩形
	 */
	stopInsertion() {
		this.isDrawing = false;
		this.isDraggingVertex = false;
		this.draggingVertexIndex = -1;
		this.vertices = null;
		this._clipData = null;

		// 移除绘制事件
		this.svgContainer.removeEventListener("mousedown", this._onMouseDown);
		this.svgContainer.removeEventListener("mousemove", this._onMouseMove);
		this.svgContainer.removeEventListener("mouseup", this._onMouseUp);

		// 清除SVG元素
		this._clearSVGElements();

		// SVG 层不再拦截事件
		this.svgContainer.style.pointerEvents = "none";
		this.svgContainer.style.cursor = "default";

		// 恢复相机控制
		this._enableCamera();

		this.dispatchEvent({ type: "stop_insertion" });
	}

	/**
	 * 清除矩形但保留工具状态（别名）
	 */
	clear() {
		this.stopInsertion();
	}

	/**
	 * 获取当前矩形的屏幕坐标数据
	 * @returns {Array|null} 四个顶点 [{x, y}, ...] 或 null
	 */
	getRectangle() {
		return this.vertices ? this.vertices.map(v => ({ ...v })) : null;
	}

	// ==================== 鼠标事件处理 ====================

	onMouseDown(e) {
		e.preventDefault();
		e.stopPropagation();

		const pos = this._getLocalPosition(e);

		// 如果正在绘制模式且尚未开始拖拽
		if (this.isDrawing && !this.vertices) {
			// 开始绘制矩形 - 记录起始点
			this.vertices = [
				{ x: pos.x, y: pos.y }, // P0 左上
				{ x: pos.x, y: pos.y }, // P1 右上
				{ x: pos.x, y: pos.y }, // P2 右下
				{ x: pos.x, y: pos.y }, // P3 左下
			];
			this._createPolygon();
			return;
		}

		// 如果矩形已存在，检查是否点击了控制点
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

		// 绘制过程中的拖拽
		if (this.isDrawing && this.vertices) {
			const p0 = this.vertices[0]; // 起始点（固定）
			// 对角点
			this.vertices[1] = { x: pos.x, y: p0.y };
			this.vertices[2] = { x: pos.x, y: pos.y };
			this.vertices[3] = { x: p0.x, y: pos.y };
			this._updatePolygon();
			return;
		}

		// 编辑模式中的顶点拖拽
		if (this.isDraggingVertex && this.draggingVertexIndex >= 0) {
			this._moveVertex(this.draggingVertexIndex, pos);
			this._updatePolygon();
			this._updateCircles();
		}
	}

	onMouseUp(e) {
		e.preventDefault();
		e.stopPropagation();

		// 绘制完成
		if (this.isDrawing && this.vertices) {
			this.isDrawing = false;
			this.svgContainer.style.cursor = "default";

			// 创建4个控制点圆圈
			this._createCircles();
			this._updatePolygon();
			this._updateCircles();

			// 保存裁剪数据快照
			this._snapshotCamera();

			this.dispatchEvent({
				type: "rectangle_drawn",
				vertices: this.getRectangle(),
				clipData: this.getClipData(),
			});
			return;
		}

		// 编辑拖拽完成
		if (this.isDraggingVertex) {
			this.isDraggingVertex = false;
			this.draggingVertexIndex = -1;

			// 更新裁剪数据快照
			this._snapshotCamera();

			this.dispatchEvent({
				type: "rectangle_modified",
				vertices: this.getRectangle(),
				clipData: this.getClipData(),
			});
		}
	}

	// ==================== 顶点约束逻辑 ====================

	/**
	 * 移动某个顶点，同时联动相邻两个顶点以保持矩形
	 * 顶点顺序: 0=左上, 1=右上, 2=右下, 3=左下
	 */
	_moveVertex(index, pos) {
		this.vertices[index] = { x: pos.x, y: pos.y };

		switch (index) {
			case 0: // 左上: 联动左下(x)和右上(y)
				this.vertices[3].x = pos.x;
				this.vertices[1].y = pos.y;
				break;
			case 1: // 右上: 联动右下(x)和左上(y)
				this.vertices[2].x = pos.x;
				this.vertices[0].y = pos.y;
				break;
			case 2: // 右下: 联动右上(x)和左下(y)
				this.vertices[1].x = pos.x;
				this.vertices[3].y = pos.y;
				break;
			case 3: // 左下: 联动左上(x)和右下(y)
				this.vertices[0].x = pos.x;
				this.vertices[2].y = pos.y;
				break;
		}
	}

	// ==================== SVG 渲染 ====================

	_createPolygon() {
		const ns = "http://www.w3.org/2000/svg";
		const polygon = document.createElementNS(ns, "polygon");
		polygon.setAttribute("fill", "rgba(46, 130, 255, 0.15)");
		polygon.setAttribute("stroke", "#2e82ff");
		polygon.setAttribute("stroke-width", "2");
		polygon.setAttribute("stroke-dasharray", "6,3");
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
		for (let i = 0; i < 4; i++) {
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
		for (const c of this.circleElements) {
			c.remove();
		}
		this.circleElements = [];
	}

	// ==================== 辅助方法 ====================

	/**
	 * 获取鼠标相对于 SVG 容器的坐标
	 */
	_getLocalPosition(e) {
		const rect = this.svgContainer.getBoundingClientRect();
		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
	}

	/**
	 * 检测鼠标是否命中某个顶点控制柄（半径 10px）
	 */
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
			type: 'rectangle',
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
		// 返回深拷贝，防止外部修改内部状态
		return JSON.parse(JSON.stringify(this._clipData));
	}

	/**
	 * 禁用相机控制
	 */
	_disableCamera() {
		if (this.viewer.controls) {
			this.viewer.controls.enabled = false;
		}
	}

	/**
	 * 启用相机控制
	 */
	_enableCamera() {
		if (this.viewer.controls) {
			this.viewer.controls.enabled = true;
		}
	}
}
