import * as THREE from "../../libs/three.js/build/three.module.js";
import {PointCloudSM} from "../utils/PointCloudSM.js";
import {EyeDomeLightingMaterial} from "../materials/EyeDomeLightingMaterial.js";
import {SphereVolume} from "../utils/Volume.js";
import {Utils} from "../utils.js";
import {getPointcloudEffectState, partitionPointcloudsByEDL} from "./PointcloudEffectUtils.js";

export class EDLRenderer{
	constructor(viewer){
		this.viewer = viewer;

		this.edlMaterial = null;

		this.rtRegular = null;
		this.rtEDL = null;

		this.gl = viewer.renderer.getContext();

		this.shadowMap = new PointCloudSM(this.viewer.pRenderer);
	}

	initEDL(){
		if (this.edlMaterial != null) {
			return;
		}

		this.edlMaterial = new EyeDomeLightingMaterial();
		this.edlMaterial.depthTest = true;
		this.edlMaterial.depthWrite = true;
		this.edlMaterial.transparent = true;

		this.rtEDL = new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType)
		});

		this.rtRegular = new THREE.WebGLRenderTarget(1024, 1024, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType)
		});
	};

	resize(width, height){
		if(this.screenshot){
			width = this.screenshot.target.width;
			height = this.screenshot.target.height;
		}

		this.rtEDL.setSize(width , height);
		this.rtRegular.setSize(width , height);
	}

	makeScreenshot(camera, size, callback){

		if(camera === undefined || camera === null){
			camera = this.viewer.scene.getActiveCamera();
		}

		if(size === undefined || size === null){
			size = this.viewer.renderer.getSize(new THREE.Vector2());
		}

		let {width, height} = size;

		width = 2 * width;
		height = 2 * height;

		let target = new THREE.WebGLRenderTarget(width, height, {
			format: THREE.RGBAFormat,
		});

		this.screenshot = {
			target: target
		};

		this.render({camera});

		let pixelCount = width * height;
		let buffer = new Uint8Array(4 * pixelCount);

		this.viewer.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);

		// 截图输出需要翻转回浏览器坐标系，避免上下颠倒。
		let bytesPerLine = width * 4;
		for(let i = 0; i < parseInt(height / 2); i++){
			let j = height - i - 1;

			let lineI = buffer.slice(i * bytesPerLine, i * bytesPerLine + bytesPerLine);
			let lineJ = buffer.slice(j * bytesPerLine, j * bytesPerLine + bytesPerLine);
			buffer.set(lineJ, i * bytesPerLine);
			buffer.set(lineI, j * bytesPerLine);
		}

		this.screenshot.target.dispose();
		delete this.screenshot;

		return {
			width: width,
			height: height,
			buffer: buffer
		};
	}

	clearTargets(){
		const viewer = this.viewer;
		const {renderer} = viewer;

		const oldTarget = renderer.getRenderTarget();

		renderer.setRenderTarget(this.rtEDL);
		renderer.clear(true, true, true);

		renderer.setRenderTarget(this.rtRegular);
		renderer.clear(true, true, false);

		renderer.setRenderTarget(oldTarget);
	}

	clear(){
		this.initEDL();
		const viewer = this.viewer;

		const {renderer, background} = viewer;

		if(background === "skybox"){
			renderer.setClearColor(0x000000, 0);
		} else if (background === "gradient") {
			renderer.setClearColor(0x000000, 0);
		} else if (background === "black") {
			renderer.setClearColor(0x000000, 1);
		} else if (background === "white") {
			renderer.setClearColor(0xFFFFFF, 1);
		} else {
			renderer.setClearColor(0x000000, 0);
		}
		
		renderer.clear();

		this.clearTargets();
	}

	renderShadowMap(pointclouds, camera, lights){

		const {viewer} = this;

		const doShadows = pointclouds.length > 0 && lights.length > 0 && !(lights[0].disableShadowUpdates);
		if(doShadows){
			let light = lights[0];

			this.shadowMap.setLight(light);

			let originalAttributes = new Map();
			for(let pointcloud of pointclouds){
				originalAttributes.set(pointcloud, pointcloud.material.activeAttributeName);
				pointcloud.material.disableEvents();
				pointcloud.material.activeAttributeName = "depth";
			}

			this.shadowMap.render(viewer.scene.scenePointCloud, camera, {
				pointclouds: pointclouds,
			});

			for(let pointcloud of pointclouds){
				let originalAttribute = originalAttributes.get(pointcloud);
				pointcloud.material.activeAttributeName = originalAttribute;
				pointcloud.material.enableEvents();
			}

			viewer.shadowTestCam.updateMatrixWorld();
			viewer.shadowTestCam.matrixWorldInverse.copy(viewer.shadowTestCam.matrixWorld).invert();
			viewer.shadowTestCam.updateProjectionMatrix();
		}

	}

	_getPointcloudGroups(visiblePointClouds){
		// 标准 EDL 渲染器需要将 EDL 点云与普通点云拆开分别走不同 pass。
		return partitionPointcloudsByEDL(visiblePointClouds, this.viewer.isEDLSupported());
	}

	_configureRegularPointclouds(pointclouds, camera, visiblePointCloudCount){
		const xrayUseDistanceRamp = visiblePointCloudCount > 1 ? 0 : 1;

		for (const pointcloud of pointclouds) {
			const {material} = pointcloud;
			const effectState = getPointcloudEffectState(pointcloud, this.viewer.isEDLSupported());

			material.useEDL = false;

			if (effectState.xrayEnabled) {
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
				material.opacity = effectState.xrayOpacity;
				material.cameraPosition = camera.position;
				material.uNear = nearestDistance;
				material.uFar = farthestDistance;
				material.uXrayUseDistanceRamp = xrayUseDistanceRamp;
			}else{
				material.useXRAY = false;
				material.opacity = 1.0;
			}
		}
	}

	_renderRegularPointclouds(pointclouds, camera, visiblePointCloudCount){
		if (pointclouds.length === 0) {
			return;
		}

		this._configureRegularPointclouds(pointclouds, camera, visiblePointCloudCount);

		this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, null, {
			clipSpheres: this.viewer.scene.volumes.filter(v => (v instanceof SphereVolume)),
			pointclouds: pointclouds,
		});
	}

	_configureEDLPointclouds(pointclouds, width, height){
		for (const pointcloud of pointclouds) {
			const octreeSize = pointcloud.pcoGeometry.boundingBox.getSize(new THREE.Vector3()).x;
			const {material} = pointcloud;

			material.weighted = false;
			material.useLogarithmicDepthBuffer = false;
			material.useEDL = true;
			material.useXRAY = false;
			material.opacity = 1.0;
			material.screenWidth = width;
			material.screenHeight = height;
			material.uniforms.visibleNodes.value = pointcloud.material.visibleNodesTexture;
			material.uniforms.octreeSize.value = octreeSize;
			material.spacing = pointcloud.pcoGeometry.spacing;
		}
	}

	_renderEDLPointclouds(pointclouds, camera, width, height, lights){
		if (pointclouds.length === 0) {
			return;
		}

		this._configureEDLPointclouds(pointclouds, width, height);

		const renderParams = {
			clipSpheres: this.viewer.scene.volumes.filter(v => (v instanceof SphereVolume)),
			transparent: false,
			pointclouds: pointclouds,
		};

		if (lights.length > 0) {
			renderParams.shadowMaps = [this.shadowMap];
		}

		this.viewer.renderer.setRenderTarget(this.rtEDL);
		this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, this.rtEDL, renderParams);
	}

	render(params = {}){
		this.initEDL();

		const viewer = this.viewer;
		let camera = params.camera ? params.camera : viewer.scene.getActiveCamera();
		const {width, height} = this.viewer.renderer.getSize(new THREE.Vector2());

		viewer.dispatchEvent({type: "render.pass.begin",viewer: viewer});
		
		this.resize(width, height);

		const visiblePointClouds = viewer.scene.pointclouds.filter(pc => pc.visible);
		const {edlPointclouds, regularPointclouds} = this._getPointcloudGroups(visiblePointClouds);

		if(this.screenshot){
			let oldBudget = Potree.pointBudget;
			Potree.pointBudget = Math.max(10 * 1000 * 1000, 2 * oldBudget);
			Potree.updatePointClouds(
				viewer.scene.pointclouds, 
				camera, 
				viewer.renderer);
			Potree.pointBudget = oldBudget;
		}

		let lights = [];
		viewer.scene.scene.traverse(node => {
			if(node.type === "SpotLight"){
				lights.push(node);
			}
		});

		if(viewer.background === "skybox"){
			viewer.skybox.camera.rotation.copy(viewer.scene.cameraP.rotation);
			viewer.skybox.camera.fov = viewer.scene.cameraP.fov;
			viewer.skybox.camera.aspect = viewer.scene.cameraP.aspect;

			viewer.skybox.parent.rotation.x = 0;
			viewer.skybox.parent.updateMatrixWorld();

			viewer.skybox.camera.updateProjectionMatrix();
			viewer.renderer.render(viewer.skybox.scene, viewer.skybox.camera);
		} else if (viewer.background === "gradient") {
			viewer.renderer.render(viewer.scene.sceneBG, viewer.scene.cameraBG);
		}

		// 仅对启用了 EDL 的点云更新阴影贴图，避免混入普通点云。
		this.renderShadowMap(edlPointclouds, camera, lights);
		this._renderRegularPointclouds(regularPointclouds, camera, visiblePointClouds.length);
		this._renderEDLPointclouds(edlPointclouds, camera, width, height, lights);

		viewer.dispatchEvent({type: "render.pass.scene", viewer: viewer, renderTarget: this.rtRegular});
		viewer.renderer.setRenderTarget(null);
		viewer.renderer.render(viewer.scene.scene, camera);

		if (edlPointclouds.length > 0) {
			const uniforms = this.edlMaterial.uniforms;

			uniforms.screenWidth.value = width;
			uniforms.screenHeight.value = height;

			let proj = camera.projectionMatrix;
			let projArray = new Float32Array(16);
			projArray.set(proj.elements);

			uniforms.uNear.value = camera.near;
			uniforms.uFar.value = camera.far;
			uniforms.uEDLColor.value = this.rtEDL.texture;
			uniforms.uEDLDepth.value = this.rtEDL.depthTexture;
			uniforms.uProj.value = projArray;

			uniforms.edlStrength.value = viewer.edlStrength;
			uniforms.radius.value = viewer.edlRadius;
			uniforms.opacity.value = viewer.edlOpacity;
			
			Utils.screenPass.render(viewer.renderer, this.edlMaterial);

			if(this.screenshot){
				Utils.screenPass.render(viewer.renderer, this.edlMaterial, this.screenshot.target);
			}
		}

		viewer.dispatchEvent({type: "render.pass.scene", viewer: viewer});

		viewer.renderer.clearDepth();

		viewer.transformationTool.update();

		viewer.dispatchEvent({type: "render.pass.perspective_overlay",viewer: viewer});

		viewer.renderer.render(viewer.controls.sceneControls, camera);
		viewer.renderer.render(viewer.clippingTool.sceneVolume, camera);
		viewer.renderer.render(viewer.transformationTool.scene, camera);
		
		viewer.dispatchEvent({type: "render.pass.end",viewer: viewer});
	}
}
