/**
 * 创建 viewer 的 mock 对象，供 SVG 工具测试使用
 */
export function createMockViewer() {
	// 创建一个真实的 DOM 容器
	const renderArea = document.createElement('div');
	renderArea.style.width = '800px';
	renderArea.style.height = '600px';
	document.body.appendChild(renderArea);

	const domElement = document.createElement('canvas');
	domElement.style.width = '800px';
	domElement.style.height = '600px';
	// jsdom 不计算布局，需手动设置 clientWidth/Height
	Object.defineProperty(domElement, 'clientWidth', { value: 800 });
	Object.defineProperty(domElement, 'clientHeight', { value: 600 });
	renderArea.appendChild(domElement);

	const viewer = {
		renderArea,
		renderer: {
			domElement,
		},
		controls: {
			enabled: true,
		},
		scene: {
			getActiveCamera() {
				return {
					projectionMatrix: {
						elements: new Array(16).fill(0).map((_, i) => i),
					},
					matrixWorldInverse: {
						elements: new Array(16).fill(0).map((_, i) => i + 16),
					},
				};
			},
		},
	};

	return viewer;
}

/**
 * 创建模拟的 MouseEvent（带 clientX/clientY）
 */
export function createMouseEvent(type, x, y, button = 0) {
	return new MouseEvent(type, {
		clientX: x,
		clientY: y,
		button,
		bubbles: true,
		cancelable: true,
	});
}

/**
 * 创建模拟的 KeyboardEvent
 */
export function createKeyboardEvent(type, key, opts = {}) {
	return new KeyboardEvent(type, {
		key,
		keyCode: key === 'z' || key === 'Z' ? 90 : 0,
		ctrlKey: opts.ctrlKey || false,
		metaKey: opts.metaKey || false,
		bubbles: true,
		cancelable: true,
	});
}

/**
 * 清理 mock viewer 创建的 DOM
 */
export function cleanupMockViewer(viewer) {
	if (viewer.renderArea && viewer.renderArea.parentNode) {
		viewer.renderArea.parentNode.removeChild(viewer.renderArea);
	}
}
