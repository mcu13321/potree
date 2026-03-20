/**
 * 轻量级标签，仅包含 DOM 元素与点云关联，无 3D 包围盒。
 */
export class TreeTag {
	constructor(pointcloud, index) {
		this.pointcloud = pointcloud;
		this.index = index;
		this.domElement = null;
		this._createHtmlLabel();
	}

	_createHtmlLabel() {
		this.domElement = document.createElement("div");
		this.domElement.style.position = "absolute";
		this.domElement.style.width = "30px";
		this.domElement.style.height = "30px";
		this.domElement.style.border = "2px solid black";
		this.domElement.style.display = "flex";
		this.domElement.style.justifyContent = "center";
		this.domElement.style.alignItems = "center";
		this.domElement.style.fontWeight = "bold";
		this.domElement.style.fontSize = "18px";
		this.domElement.style.color = "black";
		this.domElement.style.cursor = "pointer";
		this.domElement.style.zIndex = "1000";
		this.domElement.innerText = this.index.toString();
		this.domElement.style.backgroundColor = "#cccccc";
	}

	/**
	 * 根据是否高亮更新标签样式
	 * @param {boolean} highlighted - 是否高亮（xrayEnabled=false）
	 */
	updateStyle(highlighted) {
		if (this.domElement) {
			this.domElement.style.backgroundColor = highlighted ? "#00ff00" : "#cccccc";
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
