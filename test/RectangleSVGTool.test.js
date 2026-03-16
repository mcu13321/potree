import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RectangleSVGTool } from '../src/utils/RectangleSVGTool.js';
import { createMockViewer, createMouseEvent, cleanupMockViewer } from './helpers.js';

describe('RectangleSVGTool', () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = createMockViewer();
		tool = new RectangleSVGTool(viewer);
	});

	afterEach(() => {
		tool.clear();
		cleanupMockViewer(viewer);
	});

	// ==================== 初始化 ====================

	describe('初始化', () => {
		it('应在 renderArea 中创建 SVG 容器', () => {
			const svg = viewer.renderArea.querySelector('#rectangle_svg_overlay');
			expect(svg).not.toBeNull();
			expect(svg.tagName.toLowerCase()).toBe('svg');
		});

		it('初始状态 vertices 为 null', () => {
			expect(tool.vertices).toBeNull();
			expect(tool.isDrawing).toBe(false);
		});

		it('初始状态 SVG 不拦截事件', () => {
			expect(tool.svgContainer.style.pointerEvents).toBe('none');
		});
	});

	// ==================== startInsertion ====================

	describe('startInsertion()', () => {
		it('应禁用相机控制', () => {
			tool.startInsertion();
			expect(viewer.controls.enabled).toBe(false);
		});

		it('应设置 SVG 为可交互', () => {
			tool.startInsertion();
			expect(tool.svgContainer.style.pointerEvents).toBe('auto');
			expect(tool.svgContainer.style.cursor).toBe('crosshair');
		});

		it('应设置 isDrawing 为 true', () => {
			tool.startInsertion();
			expect(tool.isDrawing).toBe(true);
		});
	});

	// ==================== stopInsertion / clear ====================

	describe('stopInsertion() / clear()', () => {
		it('应恢复相机控制', () => {
			tool.startInsertion();
			tool.stopInsertion();
			expect(viewer.controls.enabled).toBe(true);
		});

		it('应清除 vertices 和 clipData', () => {
			tool.startInsertion();
			tool.stopInsertion();
			expect(tool.vertices).toBeNull();
			expect(tool._clipData).toBeNull();
		});

		it('应恢复 SVG 状态', () => {
			tool.startInsertion();
			tool.stopInsertion();
			expect(tool.svgContainer.style.pointerEvents).toBe('none');
		});
	});

	// ==================== 矩形绘制流程 ====================

	describe('绘制流程', () => {
		it('mousedown 应创建四个顶点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			expect(tool.vertices).toHaveLength(4);
			expect(tool.vertices[0]).toEqual({ x: 100, y: 100 });
		});

		it('mousemove 应更新对角线顶点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			// P0 固定，P1 右上，P2 右下（对角），P3 左下
			expect(tool.vertices[0]).toEqual({ x: 100, y: 100 });
			expect(tool.vertices[1]).toEqual({ x: 300, y: 100 });
			expect(tool.vertices[2]).toEqual({ x: 300, y: 250 });
			expect(tool.vertices[3]).toEqual({ x: 100, y: 250 });
		});

		it('mouseup 应完成绘制并设 isDrawing=false', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));
			expect(tool.isDrawing).toBe(false);
		});

		it('绘制完成后应创建控制点圆圈', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));
			const circles = svg.querySelectorAll('circle');
			expect(circles.length).toBe(4);
		});
	});

	// ==================== 顶点约束 ====================

	describe('顶点约束逻辑 (_moveVertex)', () => {
		it('移动左上角应联动右上(y)和左下(x)', () => {
			tool.vertices = [
				{ x: 100, y: 100 },
				{ x: 300, y: 100 },
				{ x: 300, y: 250 },
				{ x: 100, y: 250 },
			];
			tool._moveVertex(0, { x: 50, y: 80 });
			expect(tool.vertices[0]).toEqual({ x: 50, y: 80 });
			expect(tool.vertices[1].y).toBe(80);  // 右上 y 联动
			expect(tool.vertices[3].x).toBe(50);  // 左下 x 联动
		});

		it('移动右下角应联动右上(x)和左下(y)', () => {
			tool.vertices = [
				{ x: 100, y: 100 },
				{ x: 300, y: 100 },
				{ x: 300, y: 250 },
				{ x: 100, y: 250 },
			];
			tool._moveVertex(2, { x: 400, y: 350 });
			expect(tool.vertices[2]).toEqual({ x: 400, y: 350 });
			expect(tool.vertices[1].x).toBe(400);  // 右上 x 联动
			expect(tool.vertices[3].y).toBe(350);  // 左下 y 联动
		});
	});

	// ==================== clipData ====================

	describe('getClipData()', () => {
		it('绘制前返回 null', () => {
			expect(tool.getClipData()).toBeNull();
		});

		it('绘制完成后返回包含 vertices / viewport / camera 的对象', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));

			const data = tool.getClipData();
			expect(data).not.toBeNull();
			expect(data.type).toBe('rectangle');
			expect(data.vertices).toHaveLength(4);
			expect(data.viewport).toHaveProperty('width');
			expect(data.viewport).toHaveProperty('height');
			expect(data.camera).toHaveProperty('projectionMatrix');
			expect(data.camera).toHaveProperty('matrixWorldInverse');
			expect(data.camera.projectionMatrix).toHaveLength(16);
		});

		it('返回的是深拷贝（不影响内部状态）', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));

			const data1 = tool.getClipData();
			data1.vertices[0].x = 99999;
			const data2 = tool.getClipData();
			expect(data2.vertices[0].x).not.toBe(99999);
		});

		it('clear() 后返回 null', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));
			tool.clear();
			expect(tool.getClipData()).toBeNull();
		});
	});

	// ==================== getRectangle ====================

	describe('getRectangle()', () => {
		it('无矩形时返回 null', () => {
			expect(tool.getRectangle()).toBeNull();
		});

		it('绘制后返回四个顶点的副本', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 10, 20));
			svg.dispatchEvent(createMouseEvent('mousemove', 200, 150));
			svg.dispatchEvent(createMouseEvent('mouseup', 200, 150));

			const rect = tool.getRectangle();
			expect(rect).toHaveLength(4);
			expect(rect[0]).toEqual({ x: 10, y: 20 });
			expect(rect[2]).toEqual({ x: 200, y: 150 });
		});
	});

	// ==================== 事件派发 ====================

	describe('事件派发', () => {
		it('绘制完成时派发 rectangle_drawn 事件（含 clipData）', () => {
			let received = null;
			tool.addEventListener('rectangle_drawn', (e) => { received = e; });

			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100));
			svg.dispatchEvent(createMouseEvent('mousemove', 300, 250));
			svg.dispatchEvent(createMouseEvent('mouseup', 300, 250));

			expect(received).not.toBeNull();
			expect(received.type).toBe('rectangle_drawn');
			expect(received.clipData).not.toBeNull();
			expect(received.vertices).toHaveLength(4);
		});
	});
});
