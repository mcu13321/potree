import * as THREE from "../../libs/three.js/build/three.module.js";

const _worldPosition = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();
const _screenPosition = new THREE.Vector3();
const _anchorWorldPosition = new THREE.Vector3();
const _anchorScreenPosition = new THREE.Vector3();
const _pixelScreenPosition = new THREE.Vector3();
const _screenDelta = new THREE.Vector2();

export class MeasureHtmlLabel extends THREE.Object3D {
	constructor(text = "", options = {}) {
		super();

		// 保持与旧测量标签一致的最小接口，同时把真实显示交给 DOM。
		this.visible = false;
		this.text = "";
		this.offsetX = options.offsetX ?? 0;
		this.offsetY = options.offsetY ?? 0;
		this.className = options.className ?? "";
		// DOM 锚点模式：bottom = 老行为(点在标签底部中心)，center = 以标签中心为锚（更适合做屏幕空间避让）。
		this.anchorMode = options.anchorMode ?? "bottom";
		this.screenAnchor = null;
		this.radialOffset = options.radialOffset ?? 0;
		// 仅在启用屏幕空间避让时使用（例如角度标签）
		this.markerRadiusPx = options.markerRadiusPx ?? 0;
		this.minGapPx = options.minGapPx ?? 0;
		this.domElement = this.createDomElement();

		this.setText(text);
	}

	// 创建绝对定位的 HTML 标签节点，并尽量还原旧 TextSprite 的视觉样式。
	createDomElement() {
		const domElement = document.createElement("div");
		const classNames = ["potree-measurement-label", this.className].filter(Boolean);
		domElement.className = classNames.join(" ");
		domElement.style.position = "absolute";
		domElement.style.pointerEvents = "none";
		domElement.style.transform = this.anchorMode === "center" ? "translate(-50%, -50%)" : "translate(-50%, -100%)";
		domElement.style.display = "none";
		domElement.style.left = "0px";
		domElement.style.top = "0px";
		domElement.setAttribute("aria-hidden", "true");
		this.applyLegacyMeasureStyle(domElement);

		return domElement;
	}

	// 使用固定 CSS 像素，避免 PC 与移动端因 DPR 不同而显示尺寸不一致。
	applyLegacyMeasureStyle(domElement) {
		domElement.style.padding = "3px 8px";
		domElement.style.border = "1.5px solid #ffffff";
		domElement.style.borderRadius = "4px";
		domElement.style.backgroundColor = "#2e82ff";
		domElement.style.color = "#ffffff";
		domElement.style.fontFamily = "Arial, Helvetica, sans-serif";
		domElement.style.fontSize = "14px";
		domElement.style.fontWeight = "400";
		domElement.style.lineHeight = "1.2";
		domElement.style.whiteSpace = "nowrap";
		domElement.style.boxSizing = "border-box";
		domElement.style.userSelect = "none";
		domElement.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.3)";
	}

	// 兼容原有调用方式，直接更新标签文本内容。
	setText(text) {
		this.text = text == null ? "" : String(text);

		if (this.domElement) {
			this.domElement.textContent = this.text;
		}
	}

	// 兼容原有调用方式，保留业务可见性语义。
	setVisible(visible) {
		this.visible = visible;
	}

	// 设置屏幕空间的避让锚点，通常用于角度标签对应的顶点。
	setScreenAnchor(anchor, radialOffset = this.radialOffset) {
		this.screenAnchor = anchor ?? null;
		this.radialOffset = radialOffset;
	}

	// 挂载到 viewer.renderArea 或其它指定的 HTML 根节点。
	attach(parentElement) {
		if (!(parentElement instanceof HTMLElement) || !this.domElement) {
			return;
		}

		if (this.domElement.parentElement !== parentElement) {
			this.detach();
			parentElement.appendChild(this.domElement);
		}
	}

	// 从当前挂载节点脱离，但保留对象以便后续重新挂载。
	detach() {
		if (this.domElement?.parentElement) {
			this.domElement.parentElement.removeChild(this.domElement);
		}
	}

	// 彻底销毁 DOM 引用，避免测量删除后残留孤儿节点。
	dispose() {
		this.detach();
		this.domElement = null;
	}

	projectToScreen(worldPosition, camera, width, height, target) {
		target.copy(worldPosition).project(camera);
		target.x = ((target.x + 1) * width) / 2;
		target.y = ((-target.y + 1) * height) / 2;

		return target;
	}

	getDomSizePx() {
		if (!this.domElement) {
			return {width: 0, height: 0};
		}

		// 由于标签用 display:none 隐藏时无法测量，这里只在可显示时测量；
		// 尺寸为 0 时回退到保守默认值，避免 NaN 推开。
		const rect = this.domElement.getBoundingClientRect();
		const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 80;
		const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 22;

		return {width, height};
	}

	applyRadialScreenOffset(camera, width, height) {
		if (!this.screenAnchor || this.radialOffset <= 0) {
			return {x: 0, y: 0};
		}

		if (typeof this.screenAnchor.getWorldPosition === "function") {
			this.screenAnchor.getWorldPosition(_anchorWorldPosition);
		} else if (this.screenAnchor?.isVector3) {
			_anchorWorldPosition.copy(this.screenAnchor);
		} else {
			return {x: 0, y: 0};
		}

		this.projectToScreen(_anchorWorldPosition, camera, width, height, _anchorScreenPosition);
		this.projectToScreen(_worldPosition, camera, width, height, _pixelScreenPosition);

		_screenDelta.set(
			_pixelScreenPosition.x - _anchorScreenPosition.x,
			_pixelScreenPosition.y - _anchorScreenPosition.y,
		);

		if (_screenDelta.lengthSq() === 0) {
			_screenDelta.set(0, -1);
		} else {
			_screenDelta.normalize();
		}

		return {
			x: _screenDelta.x * this.radialOffset,
			y: _screenDelta.y * this.radialOffset,
		};
	}

	applyAvoidancePush(camera, width, height) {
		if (!this.screenAnchor || this.anchorMode !== "center") {
			return null;
		}

		const markerRadiusPx = Math.max(0, this.markerRadiusPx || 0);
		const minGapPx = Math.max(0, this.minGapPx || 0);
		if (markerRadiusPx + minGapPx <= 0) {
			return null;
		}

		// 计算从锚点(顶点)到标签当前位置的屏幕方向 dir
		if (typeof this.screenAnchor.getWorldPosition === "function") {
			this.screenAnchor.getWorldPosition(_anchorWorldPosition);
		} else if (this.screenAnchor?.isVector3) {
			_anchorWorldPosition.copy(this.screenAnchor);
		} else {
			return null;
		}

		this.projectToScreen(_anchorWorldPosition, camera, width, height, _anchorScreenPosition);
		this.projectToScreen(_worldPosition, camera, width, height, _pixelScreenPosition);

		_screenDelta.set(
			_pixelScreenPosition.x - _anchorScreenPosition.x,
			_pixelScreenPosition.y - _anchorScreenPosition.y,
		);

		if (_screenDelta.lengthSq() === 0) {
			_screenDelta.set(0, -1);
		} else {
			_screenDelta.normalize();
		}

		const {width: w, height: h} = this.getDomSizePx();
		const halfW = w / 2;
		const halfH = h / 2;

		// 方向上的投影半径：|dx| * (w/2) + |dy| * (h/2)
		const extent = Math.abs(_screenDelta.x) * halfW + Math.abs(_screenDelta.y) * halfH;
		const push = markerRadiusPx + minGapPx + extent;

		return {
			anchorX: _anchorScreenPosition.x,
			anchorY: _anchorScreenPosition.y,
			dirX: _screenDelta.x,
			dirY: _screenDelta.y,
			push,
		};
	}

	// 按当前相机把三维锚点投影到屏幕空间，并更新 DOM 位置。
	updateScreenPosition(camera, width, height, globalVisible = true) {
		if (!camera || !this.domElement) {
			return;
		}

		this.updateMatrixWorld(true);
		this.getWorldPosition(_worldPosition);
		_viewPosition.copy(_worldPosition).applyMatrix4(camera.matrixWorldInverse);

		if (!globalVisible || !this.visible || this.text.length === 0 || _viewPosition.z > 0) {
			this.setDomVisible(false);
			return;
		}

		_screenPosition.copy(_worldPosition).project(camera);
		const isOutOfFrustum =
			!Number.isFinite(_screenPosition.x) ||
			!Number.isFinite(_screenPosition.y) ||
			!Number.isFinite(_screenPosition.z) ||
			_screenPosition.x < -1 ||
			_screenPosition.x > 1 ||
			_screenPosition.y < -1 ||
			_screenPosition.y > 1 ||
			_screenPosition.z < -1 ||
			_screenPosition.z > 1;

		if (isOutOfFrustum) {
			this.setDomVisible(false);
			return;
		}

		// 先显示再测量尺寸，便于 center 模式做精确避让（display:none 时 rect 为 0）。
		this.setDomVisible(true);

		const baseX = ((_screenPosition.x + 1) * width) / 2;
		const baseY = ((-_screenPosition.y + 1) * height) / 2;

		const avoidance = this.applyAvoidancePush(camera, width, height);
		let screenX;
		let screenY;

		if (avoidance) {
			// center 模式：以 anchor(顶点) 为基准定位，避免“先投影标签再 push”造成过远/遮挡。
			// 注意：这里不再叠加 radialOffset，push 已包含避让所需距离。
			screenX = avoidance.anchorX + this.offsetX + avoidance.dirX * avoidance.push;
			screenY = avoidance.anchorY + this.offsetY + avoidance.dirY * avoidance.push;
		} else {
			const radialOffset = this.applyRadialScreenOffset(camera, width, height);
			screenX = baseX + this.offsetX + radialOffset.x;
			screenY = baseY + this.offsetY + radialOffset.y;
		}

		this.domElement.style.left = `${Math.round(screenX)}px`;
		this.domElement.style.top = `${Math.round(screenY)}px`;
	}

	// 统一管理 display，避免多个调用点各自修改 DOM 状态。
	setDomVisible(visible) {
		if (!this.domElement) {
			return;
		}

		this.domElement.style.display = visible ? "block" : "none";
	}
}
