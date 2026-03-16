import * as THREE from "../../libs/three.js/build/three.module.js";
import {Utils} from "../utils.js";

export class BoundingBox extends THREE.Object3D {

	constructor(args = {}){
		super(args);

		this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;
		this.name = 'bounding_box_' + this.constructor.counter;

		let size = new THREE.Vector3(1, 1, 1);
		let center = new THREE.Vector3(0, 0, 0);

		if (args.pointCloud) {
			let box = args.pointCloud.pcoGeometry.tightBoundingBox ? args.pointCloud.pcoGeometry.tightBoundingBox : args.pointCloud.boundingBox;
			let boxWorld = Utils.computeTransformedBoundingBox(box, args.pointCloud.matrixWorld);
			size = boxWorld.getSize(new THREE.Vector3());
			center = boxWorld.getCenter(new THREE.Vector3());
			this.position.copy(center);
		} else if (args.size) {
			size = args.size;
			if(args.position) this.position.copy(args.position);
		}

		this.boxSize = size;
		this.number = args.number !== undefined ? args.number : this.constructor.counter;
		this._selected = args.selected !== undefined ? args.selected : false;

		let boxFrameGeometry = new THREE.Geometry();
		{
			let Vector3 = THREE.Vector3;

			boxFrameGeometry.vertices.push(
				// bottom
				new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, -0.5, -0.5),
				new Vector3(0.5, -0.5, -0.5), new Vector3(0.5, 0.5, -0.5),
				new Vector3(0.5, 0.5, -0.5), new Vector3(-0.5, 0.5, -0.5),
				new Vector3(-0.5, 0.5, -0.5), new Vector3(-0.5, -0.5, -0.5),
				// top
				new Vector3(-0.5, -0.5, 0.5), new Vector3(0.5, -0.5, 0.5),
				new Vector3(0.5, -0.5, 0.5), new Vector3(0.5, 0.5, 0.5),
				new Vector3(0.5, 0.5, 0.5), new Vector3(-0.5, 0.5, 0.5),
				new Vector3(-0.5, 0.5, 0.5), new Vector3(-0.5, -0.5, 0.5),
				// sides
				new Vector3(-0.5, -0.5, -0.5), new Vector3(-0.5, -0.5, 0.5),
				new Vector3(0.5, -0.5, -0.5), new Vector3(0.5, -0.5, 0.5),
				new Vector3(0.5, 0.5, -0.5), new Vector3(0.5, 0.5, 0.5),
				new Vector3(-0.5, 0.5, -0.5), new Vector3(-0.5, 0.5, 0.5),
			);
		}

		this.frame = new THREE.LineSegments(boxFrameGeometry, new THREE.LineBasicMaterial({color: 0x00ff00}));
		this.frame.scale.copy(this.boxSize);
		this.frame.raycast = function() {}; // Disable line raycast
		this.add(this.frame);

		this.createHtmlLabel();

		this.updateState();
	}

	createHtmlLabel() {
		this.domElement = document.createElement('div');
		this.domElement.style.position = 'absolute';
		this.domElement.style.width = '30px';
		this.domElement.style.height = '30px';
		this.domElement.style.border = '2px solid black';
		this.domElement.style.display = 'flex';
		this.domElement.style.justifyContent = 'center';
		this.domElement.style.alignItems = 'center';
		this.domElement.style.fontWeight = 'bold';
		this.domElement.style.fontSize = '18px';
		this.domElement.style.color = 'black';
		this.domElement.style.cursor = 'pointer';
		this.domElement.style.zIndex = '1000';
		this.domElement.innerText = this.number.toString();

		this.domElement.addEventListener('click', (e) => {
			e.stopPropagation();
			console.log("click html label");
			this.selected = !this.selected;
		});
	}

	get selected() {
		return this._selected;
	}

	set selected(value) {
		if (this._selected !== value) {
			this._selected = value;
			this.updateState();
		}
	}

	updateState() {
		this.frame.visible = this._selected;
		
		if (this._selected) {
			this.domElement.style.backgroundColor = '#00ff00';
		} else {
			this.domElement.style.backgroundColor = '#cccccc';
		}

		this.dispatchEvent({type: "visibility_changed", object: this});
	}

	dispose() {
		if (this.domElement && this.domElement.parentElement) {
			this.domElement.parentElement.removeChild(this.domElement);
		}
	}

};
