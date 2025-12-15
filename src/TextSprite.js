

// /**
//  * adapted from http://stemkoski.github.io/Three.js/Sprite-Text-Labels.html
//  */

import * as THREE from "../libs/three.js/build/three.module.js";

import { Rect } from '../libs/konva/lib/shapes/Rect.js';
import { Text } from '../libs/konva/lib/shapes/Text.js';
import { Layer } from '../libs/konva/lib/Layer.js';


export class TextSprite extends THREE.Object3D{
	
	constructor(text,_viewer){
		super();
		this.viewer = _viewer;
		this.visible = false;
		this.text = '';
		this.sprite = this.getMeasureLabel({ text: '' });
		this.add(this.sprite);
		this.setText(text);
	}

	setText(text){
		if (this.text !== text){
			this.text = text;
			this.update();
		}
	}

	setVisible(visible){
		if (this.visible != visible) {
			this.visible = visible;
			this.update();
		}
	}

	update() {
		if (this.visible) {
			this.remove(this.sprite);
			this.sprite = this.getMeasureLabel({ text: this.text });
			this.add(this.sprite);
		}
		
	}

	getMeasureLabel({ text = '', offsetY = 80, orthoZoom = 100 }) {
    	// 获取设备像素比（处理高 DPI 屏幕）
		const dpr = window.devicePixelRatio || 1;
		const isMobile = dpr > 1.5;
		
		// 增加字体大小以适应高 DPI
		const fontSize = 20 * Math.sqrt(dpr);
		const padding = 10 * Math.sqrt(dpr);
		const cornerRadius = 4 * Math.sqrt(dpr);
		const strokeWidth = 2 * Math.sqrt(dpr);
		
		const tempText = new Text({
			x: 1 * dpr,
			y: 2 * dpr,
			text,
			fontSize: fontSize,
			fill: '#ffffff',
			padding: padding,
		})
		
		const tempTextBg = new Rect({
			x: 1 * dpr,
			y: 1 * dpr,
			stroke: '#ffffff',
			strokeWidth: strokeWidth,
			fill: '#2e82ff',
			width: tempText.width(),
			height: tempText.height(),
			cornerRadius: cornerRadius,
		})
		
		const layer = new Layer({ listening: false })
		
		layer.add(tempTextBg)
		layer.add(tempText)
		if (offsetY > 0) {
			const offsetSpace = new Rect({
				x: 0,
				y: tempTextBg.height(),
				fill: 'transparent',
				width: tempTextBg.width(),
				height: isMobile ? offsetY * dpr * 0.5 : offsetY * dpr,
			})
			layer.add(offsetSpace)
		}

		// 生成高清 canvas
		const canvas = layer.toCanvas()
		
		// 确保 canvas 尺寸是 2 的幂次方（避免纹理缩放警告）
		const nextPowerOf2 = (n) => Math.pow(2, Math.ceil(Math.log2(n)));
		const size = Math.max(nextPowerOf2(canvas.width), nextPowerOf2(canvas.height));
		
		// 创建正确尺寸的高清 canvas
		const resizedCanvas = document.createElement('canvas');
		resizedCanvas.width = size;
		resizedCanvas.height = size;
		const ctx = resizedCanvas.getContext('2d');
		const offsetX2 = (size - canvas.width) / 2;
		const offsetY2 = (size - canvas.height) / 2;
		ctx.drawImage(canvas, offsetX2, offsetY2);
		
		const texture = new THREE.CanvasTexture(resizedCanvas)
		// 设置纹理过滤方式为线性插值，在高 DPI 下效果更清晰
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = THREE.LinearFilter;
		texture.needsUpdate = true;
		
		const material = new THREE.SpriteMaterial({
			map: texture,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 1,
			sizeAttenuation: false,
		})
		
		material.map.colorSpace = THREE.SRGBColorSpace
		const mesh = new THREE.Sprite(material)
		mesh.visible = this.visible;
		
		if (!this.viewer) {
			return mesh
		}
		
		const _camera = this.viewer.scene.getActiveCamera();
		
		// 缩放时考虑实际渲染尺寸
		const scaleX = size / 1300;
		const scaleY = size / 1300;
		const scaleyOverlay = isMobile ? 1.5 : 1;
		
		if (_camera.isPerspectiveCamera) {
			mesh.scale.set(scaleX / scaleyOverlay, scaleY / scaleyOverlay, 1)
		} else {
			mesh.scale.set(size / orthoZoom / scaleyOverlay, size / orthoZoom / scaleyOverlay, 1)
		}
		
		return mesh
	}
}


