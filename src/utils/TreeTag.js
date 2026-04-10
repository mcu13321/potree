/**
 * 轻量级标签，仅包含 DOM 元素与点云关联，无 3D 包围盒。
 */
export class TreeTag {
	/**
	 * @param {Object} pointcloud
	 * @param {number} fallbackIndex - 当 `pointcloud.userData.key` 未设置时的显示序号（可见顺序 1,2,…）
	 */
	constructor(pointcloud, fallbackIndex) {
		this.pointcloud = pointcloud;
		this.labelText = TreeTag._resolveLabelText(pointcloud, fallbackIndex);
		this.domElement = null;
		this._createHtmlLabel();
	}

	static _resolveLabelText(pointcloud, fallbackIndex) {
		const key = pointcloud?.userData?.key;
		if (key !== undefined && key !== null) {
			return String(key);
		}
		return String(fallbackIndex);
	}

	_createHtmlLabel() {
		this.domElement = document.createElement("div");
		this.domElement.style.position = "absolute";
		this.domElement.style.width = "24px";
		this.domElement.style.height = "24px";
		this.domElement.style.border = "none";
		this.domElement.style.boxSizing = "border-box";
		this.domElement.style.display = "flex";
		this.domElement.style.justifyContent = "center";
		this.domElement.style.alignItems = "center";
		this.domElement.style.fontSize = "12px";
		this.domElement.style.color = "black";
		this.domElement.style.cursor = "pointer";
		this.domElement.style.zIndex = "1000";
		this.domElement.innerText = this.labelText;
		this.domElement.style.backgroundColor = "#cccccc";
		this.domElement.style.opacity = "0.3";
	}

	/**
	 * 根据是否高亮更新标签样式。
	 * @param {boolean} highlighted - 是否高亮（高亮点云对应 EDL 选中态）
	 */
	updateStyle(highlighted) {
		if (this.domElement) {
			this.domElement.style.backgroundColor = highlighted ? "#00ff00" : "#cccccc";
			this.domElement.style.opacity = highlighted ? "1.0" : "0.3";
		}
	}

	dispose() {
		if (this.domElement && this.domElement.parentElement) {
			this.domElement.parentElement.removeChild(this.domElement);
		}
		this.domElement = null;
		this.pointcloud = null;
	}
}
