import * as THREE from "../../libs/three.js/build/three.module.js";

const LABEL_FONT_SIZE_PX = 64;
const LABEL_PADDING_X_PX = 28;
const LABEL_PADDING_Y_PX = 18;
const LABEL_BORDER_RADIUS_PX = 24;

function nextPowerOfTwo(value) {
	return Math.pow(2, Math.ceil(Math.log2(Math.max(1, value))));
}

function drawRoundedRect(context, x, y, width, height, radius) {
	context.beginPath();
	context.moveTo(x + radius, y);
	context.lineTo(x + width - radius, y);
	context.quadraticCurveTo(x + width, y, x + width, y + radius);
	context.lineTo(x + width, y + height - radius);
	context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
	context.lineTo(x + radius, y + height);
	context.quadraticCurveTo(x, y + height, x, y + height - radius);
	context.lineTo(x, y + radius);
	context.quadraticCurveTo(x, y, x + radius, y);
	context.closePath();
}

/**
 * TreeTag 改为直接使用 3D sprite，避免依赖 HTML 叠层。
 */
export class TreeTag extends THREE.Sprite {
	/**
	 * @param {Object} pointcloud
	 * @param {number} fallbackIndex - 当 `pointcloud.userData.key` 未配置时的显示序号
	 */
	constructor(pointcloud, fallbackIndex) {
		const texture = new THREE.CanvasTexture(document.createElement("canvas"));
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		if ("colorSpace" in texture && THREE.SRGBColorSpace) {
			texture.colorSpace = THREE.SRGBColorSpace;
		}

		const material = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			sizeAttenuation: true,
		});

		super(material);

		this.pointcloud = pointcloud;
		this.labelText = TreeTag._resolveLabelText(pointcloud, fallbackIndex);
		this.texture = texture;
		this.material = material;
		this.center.set(0.5, 0);
		// 使用世界单位控制基础尺寸，实际屏幕尺寸会随相机远近自然变化。
		this.baseScale = 1;
		this.isHighlighted = false;

		this._redraw();
	}

	static _resolveLabelText(pointcloud, fallbackIndex) {
		const key = pointcloud?.userData?.key;
		if (key !== undefined && key !== null) {
			return String(key);
		}

		return String(fallbackIndex);
	}

	setBaseScale(scale) {
		this.baseScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
		this.scale.set(this.baseScale, this.baseScale, 1);
	}

	/**
	 * 根据是否高亮刷新贴图样式。
	 * @param {boolean} highlighted
	 */
	updateStyle(highlighted) {
		const nextHighlighted = Boolean(highlighted);
		if (this.isHighlighted === nextHighlighted) {
			return;
		}

		this.isHighlighted = nextHighlighted;
		this._redraw();
	}

	_redraw() {
		const canvas = this.texture.image;
		const context = canvas.getContext("2d");
		const font = `bold ${LABEL_FONT_SIZE_PX}px Arial, Helvetica, sans-serif`;

		if (!context) {
			// 测试环境下 jsdom 可能未实现 2D canvas，这里退化为仅设置贴图尺寸，避免影响运行时行为。
			const approxTextWidth = Math.max(1, this.labelText.length) * LABEL_FONT_SIZE_PX * 0.6;
			const contentWidth = Math.ceil(approxTextWidth + LABEL_PADDING_X_PX * 2);
			const contentHeight = LABEL_FONT_SIZE_PX + LABEL_PADDING_Y_PX * 2;
			canvas.width = nextPowerOfTwo(contentWidth);
			canvas.height = nextPowerOfTwo(contentHeight);
			this.texture.needsUpdate = true;
			return;
		}

		context.font = font;
		const metrics = context.measureText(this.labelText);
		const textWidth = Math.ceil(metrics.width);
		const textHeight = LABEL_FONT_SIZE_PX;

		const contentWidth = textWidth + LABEL_PADDING_X_PX * 2;
		const contentHeight = textHeight + LABEL_PADDING_Y_PX * 2;
		canvas.width = nextPowerOfTwo(contentWidth);
		canvas.height = nextPowerOfTwo(contentHeight);

		context.clearRect(0, 0, canvas.width, canvas.height);
		context.font = font;
		context.textAlign = "center";
		context.textBaseline = "middle";

		const offsetX = (canvas.width - contentWidth) / 2;
		const offsetY = (canvas.height - contentHeight) / 2;

		context.fillStyle = this.isHighlighted ? "rgba(0, 255, 0, 1)" : "rgba(204, 204, 204, 0.45)";
		drawRoundedRect(
			context,
			offsetX,
			offsetY,
			contentWidth,
			contentHeight,
			LABEL_BORDER_RADIUS_PX,
		);
		context.fill();

		context.fillStyle = "#000000";
		context.fillText(
			this.labelText,
			canvas.width / 2,
			canvas.height / 2,
		);

		this.texture.needsUpdate = true;
	}

	dispose() {
		if (this.parent) {
			this.parent.remove(this);
		}

		this.material.map?.dispose?.();
		this.material.dispose?.();
		this.pointcloud = null;
	}
}
