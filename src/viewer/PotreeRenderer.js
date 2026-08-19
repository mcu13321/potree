
import * as THREE from "../../libs/three.js/build/three.module.js";
import {getPointcloudEffectState, getPointcloudMultiXrayOpacity, isGroupPointcloudSource} from "./PointcloudEffectUtils.js";


export class PotreeRenderer {

	constructor (viewer) {
		this.viewer = viewer;
		this.renderer = viewer.renderer;

		{
			let dummyScene = new THREE.Scene();
			let geometry = new THREE.SphereGeometry(0.001, 2, 2);
			let mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
			mesh.position.set(36453, 35163, 764712);
			dummyScene.add(mesh);

			this.dummyMesh = mesh;
			this.dummyScene = dummyScene;
		}
	}

	clearTargets(){

	}

	clear(){
		let {viewer, renderer} = this;


		// render skybox
		if(viewer.background === "skybox"){
			renderer.setClearColor(0xff0000, 1);
		}else if(viewer.background === "gradient"){
			renderer.setClearColor(0x00ff00, 1);
		}else if(viewer.background === "black"){
			renderer.setClearColor(0x000000, 1);
		}else if(viewer.background === "white"){
			renderer.setClearColor(0xFFFFFF, 1);
		}else{
			renderer.setClearColor(0x000000, 0);
		}

		renderer.clear();
	}
 
	render(params){
		let {viewer, renderer} = this;

		// Offscreen passes reuse this renderer without dispatching viewer overlay events.
		const camera = params.camera ? params.camera : viewer.scene.getActiveCamera();
		const target = params.target || null;
		const offscreen = params.offscreen === true;
		const skipBackground = params.skipBackground === true;
		if (target) {
			renderer.setRenderTarget(target);
		}

		if (!offscreen) {
			viewer.dispatchEvent({type: "render.pass.begin",viewer: viewer});
		}

		const renderAreaSize = renderer.getSize(new THREE.Vector2());
		const width = params.viewport ? params.viewport[2] : renderAreaSize.x;
		const height = params.viewport ? params.viewport[3] : renderAreaSize.y;

		// render skybox
		if(!skipBackground && viewer.background === "skybox"){
			viewer.skybox.camera.rotation.copy(viewer.scene.cameraP.rotation);
			viewer.skybox.camera.fov = viewer.scene.cameraP.fov;
			viewer.skybox.camera.aspect = viewer.scene.cameraP.aspect;
			
			viewer.skybox.parent.rotation.x = 0;
			viewer.skybox.parent.updateMatrixWorld();

			viewer.skybox.camera.updateProjectionMatrix();
			renderer.render(viewer.skybox.scene, viewer.skybox.camera);
		}else if(!skipBackground && viewer.background === "gradient"){
			renderer.render(viewer.scene.sceneBG, viewer.scene.cameraBG);
		}
		
		for(let pointcloud of this.viewer.scene.pointclouds){
			const {material} = pointcloud;
			material.useEDL = false;
		}

		const visiblePointClouds = this.viewer.scene.pointclouds.filter(pc => pc.visible);
		// 单双点云模式统一由 sourceKind 决定，不再依赖可见数量。
		const xrayUseDistanceRamp = isGroupPointcloudSource(viewer) ? 0 : 1;
		
		for(const pointcloud of this.viewer.scene.pointclouds){
			const {material} = pointcloud;
			const effectState = getPointcloudEffectState(pointcloud, viewer.isEDLSupported());
			const enabled = effectState.xrayEnabled;
			const opacity = effectState.xrayOpacity;

			if(enabled){
				const bbox = this.viewer.scene.getBoundingBox([pointcloud]);
				const center = new THREE.Vector3();
				bbox.getCenter(center);
				const size = new THREE.Vector3();
				bbox.getSize(size);
				const maxDimension = Math.max(size.x, size.y, size.z);
				const distanceToCenter = camera.position.distanceTo(center);
				const nearestDistance = Math.max(0, distanceToCenter - maxDimension / 2);
				const farthestDistance = distanceToCenter + maxDimension / 2;

				material.useXRAY = true;
				material.opacity = opacity;
				material.cameraPosition = camera.position;
				material.uNear = nearestDistance;
				material.uFar = farthestDistance;
				material.uXrayUseDistanceRamp = xrayUseDistanceRamp;
				// 多点云 XRAY 透明度由距离和层级共同驱动，单点云仍沿用原有 distance ramp。
				material.uXrayMultiOpacity = getPointcloudMultiXrayOpacity(pointcloud, camera.position, bbox);
			}else{
				material.useXRAY = false;
				material.opacity = 1.0;
			}
		}
		
		viewer.pRenderer.render(viewer.scene.scenePointCloud, camera, target, {
			clipSpheres: viewer.scene.volumes.filter(v => (v instanceof Potree.SphereVolume)),
			// 标准渲染器仅负责非 EDL 点云；EDL 点云会在专用渲染器中单独处理。
			pointclouds: visiblePointClouds.filter((pointcloud) => {
				return !getPointcloudEffectState(pointcloud, viewer.isEDLSupported()).edlEnabled;
			}),
		});
		
		// render scene
		renderer.setRenderTarget(target);
		renderer.render(viewer.scene.scene, camera);

		if (offscreen) {
			return;
		}

		viewer.dispatchEvent({type: "render.pass.scene",viewer: viewer});
		
		viewer.clippingTool.update();
		renderer.render(viewer.clippingTool.sceneMarker, viewer.scene.cameraScreenSpace); //viewer.scene.cameraScreenSpace);
		renderer.render(viewer.clippingTool.sceneVolume, camera);

		renderer.render(viewer.controls.sceneControls, camera);
		
		renderer.clearDepth();
		
		viewer.transformationTool.update();
		
		viewer.dispatchEvent({type: "render.pass.perspective_overlay",viewer: viewer});

		// renderer.render(viewer.controls.sceneControls, camera);
		// renderer.render(viewer.clippingTool.sceneVolume, camera);
		// renderer.render(viewer.transformationTool.scene, camera);
		
		// renderer.setViewport(width - viewer.navigationCube.width, 
		// 							height - viewer.navigationCube.width, 
		// 							viewer.navigationCube.width, viewer.navigationCube.width);
		// renderer.render(viewer.navigationCube, viewer.navigationCube.camera);		
		// renderer.setViewport(0, 0, width, height);
		
		viewer.dispatchEvent({type: "render.pass.end",viewer: viewer});
	}

}
