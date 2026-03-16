import * as THREE from "../../libs/three.js/build/three.module.js";
import {BoundingBox} from "./BoundingBox.js";
import { EventDispatcher } from "../EventDispatcher.js";

export class BoundingBoxTool extends EventDispatcher{
	constructor (viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;

		this.addEventListener('start_inserting_bounding_box', e => {
			this.viewer.dispatchEvent({
				type: 'cancel_insertions'
			});
		});

		this.scene = new THREE.Scene();
		this.scene.name = 'scene_bounding_box';

		this.viewer.inputHandler.registerInteractiveScene(this.scene);

		this.onRemove = e => {
			this.scene.remove(e.boundingBox);
			e.boundingBox.dispose();
		};

		this.onAdd = e => {
			this.scene.add(e.boundingBox);
			// The DOM element needs to be appended to the viewer's render area
			if (e.boundingBox.domElement && !e.boundingBox.domElement.parentElement) {
				const renderArea = this.viewer.renderArea;
				if (renderArea instanceof HTMLElement) {
					renderArea.appendChild(e.boundingBox.domElement);
				} else if (renderArea && renderArea[0]) {
					// In case it's a jQuery object
					renderArea[0].appendChild(e.boundingBox.domElement);
				}
			}
		};

		for(let boundingBox of viewer.scene.boundingBoxes){
			this.onAdd({boundingBox: boundingBox});
		}

		viewer.addEventListener("update", this.update.bind(this));
		viewer.addEventListener("render.pass.scene", e => this.render(e));
		viewer.addEventListener("scene_changed", this.onSceneChange.bind(this));

		viewer.scene.addEventListener('bounding_box_added', this.onAdd);
		viewer.scene.addEventListener('bounding_box_removed', this.onRemove);
	}

	onSceneChange(e){
		if(e.oldScene){
			e.oldScene.removeEventListener('bounding_box_added', this.onAdd);
			e.oldScene.removeEventListener('bounding_box_removed', this.onRemove);
		}

		e.scene.addEventListener('bounding_box_added', this.onAdd);
		e.scene.addEventListener('bounding_box_removed', this.onRemove);
	}

	startInsertion (args = {}) {
		let boundingBox = new BoundingBox(args);
		
		boundingBox.name = args.name || 'BoundingBox';
		if (args.position) {
			boundingBox.position.copy(args.position);
		}

		this.dispatchEvent({
			type: 'start_inserting_bounding_box',
			boundingBox: boundingBox
		});

		this.viewer.scene.addBoundingBox(boundingBox);
		this.scene.add(boundingBox);

		return boundingBox;
	}

	update(){
		let camera = this.viewer.scene.getActiveCamera();
		let renderAreaSize = this.viewer.renderer.getSize(new THREE.Vector2());
		let clientWidth = renderAreaSize.width;
		let clientHeight = renderAreaSize.height;

		let boundingBoxes = this.viewer.scene.boundingBoxes;
		for (let boundingBox of boundingBoxes) {
			let domElement = boundingBox.domElement;
			if (domElement) {
				// We want the label to be at the bottom center of the bounding box
				let bottomCenterLocal = new THREE.Vector3(0, 0, -boundingBox.boxSize.z / 2);
				let bottomCenterWorld = bottomCenterLocal.applyMatrix4(boundingBox.matrixWorld);
				
				// Optional: Check if the point is behind the camera
				let viewPos = bottomCenterWorld.clone().applyMatrix4(camera.matrixWorldInverse);
				if(viewPos.z > 0) {
					// Behind camera
					domElement.style.display = 'none';
					continue;
				}

				let screenPos = bottomCenterWorld.clone().project(camera);
				
				// convert to css coordinates
				let x = Math.round((screenPos.x + 1) * clientWidth / 2);
				let y = Math.round((-screenPos.y + 1) * clientHeight / 2);

				domElement.style.display = 'flex';
				// Center the 30x30 div
				domElement.style.left = `${x - 15}px`;
				domElement.style.top = `${y - 15}px`;
			}
		}
	}

	render(params){
		const renderer = this.viewer.renderer;

		const oldTarget = renderer.getRenderTarget();
		
		if(params.renderTarget){
			renderer.setRenderTarget(params.renderTarget);
		}
		renderer.render(this.scene, this.viewer.scene.getActiveCamera());
		renderer.setRenderTarget(oldTarget);
	}

}
