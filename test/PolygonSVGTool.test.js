import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolygonSVGTool } from '../src/utils/PolygonSVGTool.js';
import { createMockViewer, createMouseEvent, createKeyboardEvent, cleanupMockViewer } from './helpers.js';

describe('PolygonSVGTool', () => {
	let viewer;
	let tool;

	beforeEach(() => {
		viewer = createMockViewer();
		tool = new PolygonSVGTool(viewer);
	});

	afterEach(() => {
		tool.clear();
		cleanupMockViewer(viewer);
	});

	// ==================== 初始化 ====================

	describe('初始化', () => {
		it('应在 renderArea 中创建 SVG 容器', () => {
			const svg = viewer.renderArea.querySelector('#polygon_svg_overlay');
			expect(svg).not.toBeNull();
			expect(svg.tagName.toLowerCase()).toBe('svg');
		});

		it('初始状态 vertices 为 null', () => {
			expect(tool.vertices).toBeNull();
			expect(tool.isDrawing).toBe(false);
		});
	});

	// ==================== startInsertion ====================

	describe('startInsertion()', () => {
		it('应禁用相机控制', () => {
			tool.startInsertion();
			expect(viewer.controls.enabled).toBe(false);
		});

		it('应创建预览折线', () => {
			tool.startInsertion();
			const polylines = tool.svgContainer.querySelectorAll('polyline');
			expect(polylines.length).toBe(1);
		});

		it('应初始化 vertices 为空数组', () => {
			tool.startInsertion();
			expect(tool.vertices).toEqual([]);
		});
	});

	// ==================== stopInsertion / clear ====================

	describe('stopInsertion()', () => {
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
	});

	// ==================== 左键添加顶点 ====================

	describe('左键添加顶点', () => {
		it('每次左键点击应添加一个顶点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;

			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			expect(tool.vertices).toHaveLength(1);

			svg.dispatchEvent(createMouseEvent('mousedown', 200, 150, 0));
			expect(tool.vertices).toHaveLength(2);

			svg.dispatchEvent(createMouseEvent('mousedown', 250, 300, 0));
			expect(tool.vertices).toHaveLength(3);
		});

		it('右键不应添加顶点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;

			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			// 右键 button=2，onMouseDown 中 e.button !== 0 直接 return
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 2));
			expect(tool.vertices).toHaveLength(1);
		});
	});

	// ==================== mousemove 预览 ====================

	describe('mousemove 预览', () => {
		it('鼠标移动应更新 currentMousePos', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousemove', 200, 200, 0));
			expect(tool.currentMousePos).toEqual({ x: 200, y: 200 });
		});
	});

	// ==================== 右键闭合 ====================

	describe('右键闭合多边形', () => {
		it('少于3个点时右键不应闭合', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			// 右键 contextmenu
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			expect(tool.isDrawing).toBe(true); // 仍在绘制
		});

		it('3个点以上右键应闭合', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			expect(tool.isDrawing).toBe(false); // 绘制结束
		});

		it('闭合后应创建正式 polygon 和控制点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

			expect(svg.querySelectorAll('polygon').length).toBe(1);
			expect(svg.querySelectorAll('circle').length).toBe(3);
		});
	});

	// ==================== Ctrl+Z 撤销 ====================

	describe('Ctrl+Z 撤销', () => {
		it('应移除最后添加的顶点', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 150, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 300, 200, 0));
			expect(tool.vertices).toHaveLength(3);

			document.dispatchEvent(createKeyboardEvent('keydown', 'z', { ctrlKey: true }));
			expect(tool.vertices).toHaveLength(2);

			document.dispatchEvent(createKeyboardEvent('keydown', 'z', { ctrlKey: true }));
			expect(tool.vertices).toHaveLength(1);
		});

		it('空数组时不应出错', () => {
			tool.startInsertion();
			expect(tool.vertices).toHaveLength(0);
			// 不应抛出异常
			document.dispatchEvent(createKeyboardEvent('keydown', 'z', { ctrlKey: true }));
			expect(tool.vertices).toHaveLength(0);
		});

		it('绘制完成后 Ctrl+Z 不应生效', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

			// 绘制已完成，isDrawing = false
			document.dispatchEvent(createKeyboardEvent('keydown', 'z', { ctrlKey: true }));
			expect(tool.vertices).toHaveLength(3); // 不变
		});
	});

	// ==================== clipData ====================

	describe('getClipData()', () => {
		it('绘制前返回 null', () => {
			expect(tool.getClipData()).toBeNull();
		});

		it('绘制完成后返回完整裁剪数据', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

			const data = tool.getClipData();
			expect(data).not.toBeNull();
			expect(data.type).toBe('polygon');
			expect(data.vertices).toHaveLength(3);
			expect(data.viewport).toHaveProperty('width');
			expect(data.camera).toHaveProperty('projectionMatrix');
			expect(data.camera.projectionMatrix).toHaveLength(16);
		});

		it('clear() 后返回 null', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			tool.clear();
			expect(tool.getClipData()).toBeNull();
		});
	});

	// ==================== getPolygon ====================

	describe('getPolygon()', () => {
		it('无多边形时返回 null', () => {
			expect(tool.getPolygon()).toBeNull();
		});

		it('绘制后返回顶点副本', () => {
			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 10, 20, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 20, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 80, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

			const poly = tool.getPolygon();
			expect(poly).toHaveLength(3);
			expect(poly[0]).toEqual({ x: 10, y: 20 });
		});
	});

	// ==================== 事件派发 ====================

	describe('事件派发', () => {
		it('闭合时派发 polygon_drawn 事件（含 clipData）', () => {
			let received = null;
			tool.addEventListener('polygon_drawn', (e) => { received = e; });

			tool.startInsertion();
			const svg = tool.svgContainer;
			svg.dispatchEvent(createMouseEvent('mousedown', 100, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 100, 0));
			svg.dispatchEvent(createMouseEvent('mousedown', 200, 200, 0));
			svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

			expect(received).not.toBeNull();
			expect(received.type).toBe('polygon_drawn');
			expect(received.clipData).not.toBeNull();
			expect(received.vertices).toHaveLength(3);
		});
	});
});
