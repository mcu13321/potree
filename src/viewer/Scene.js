
import * as THREE from "../../libs/three.js/build/three.module.js";
import {Annotation} from "../Annotation.js";
import {CameraMode} from "../defines.js";
import {View} from "./View.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";


export class Scene extends EventDispatcher{

	constructor(){
		super();

		this.annotations = new Annotation();
		
		this.scene = new THREE.Scene();
		this.sceneBG = new THREE.Scene();
		this.scenePointCloud = new THREE.Scene();

		this.cameraP = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 1000*1000);
		this.cameraO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000*1000);
		this.cameraVR = new THREE.PerspectiveCamera();
		this.cameraBG = new THREE.Camera();
		this.cameraScreenSpace = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.cameraMode = CameraMode.PERSPECTIVE;
		this.overrideCamera = null;
		this.pointclouds = [];
		this.groupOffsets = new Map();
		this.activePointCloudTransformOffset = null;
		this.activePointCloudOffsetAnchor = null;
		this.pointCloudOffsetReconcileQueued = false;

		this.measurements = [];
		this.profiles = [];
		this.volumes = [];
		this.boundingBoxes = [];
		this.polygonClipVolumes = [];
		this.cameraAnimations = [];
		this.orientedImages = [];
		this.images360 = [];
		this.geopackages = [];
		
		this.fpControls = null;
		this.orbitControls = null;
		this.earthControls = null;
		this.geoControls = null;
		this.deviceControls = null;
		this.inputHandler = null;
		this.cameraControls = null;

		this.view = new View();

		this.directionalLight = null;

		this.initialize();
		// const axesHelper = new THREE.AxesHelper( 50 );
		// this.scene.add( axesHelper );
	}

	estimateHeightAt (position) {
		let height = null;
		let fromSpacing = Infinity;

		for (let pointcloud of this.pointclouds) {
			if (pointcloud.root.geometryNode === undefined) {
				continue;
			}

			let pHeight = null;
			let pFromSpacing = Infinity;

			let lpos = position.clone().sub(pointcloud.position);
			lpos.z = 0;
			let ray = new THREE.Ray(lpos, new THREE.Vector3(0, 0, 1));

			let stack = [pointcloud.root];
			while (stack.length > 0) {
				let node = stack.pop();
				let box = node.getBoundingBox();

				let inside = ray.intersectBox(box);

				if (!inside) {
					continue;
				}

				let h = node.geometryNode.mean.z +
					pointcloud.position.z +
					node.geometryNode.boundingBox.min.z;

				if (node.geometryNode.spacing <= pFromSpacing) {
					pHeight = h;
					pFromSpacing = node.geometryNode.spacing;
				}

				for (let index of Object.keys(node.children)) {
					let child = node.children[index];
					if (child.geometryNode) {
						stack.push(node.children[index]);
					}
				}
			}

			if (height === null || pFromSpacing < fromSpacing) {
				height = pHeight;
				fromSpacing = pFromSpacing;
			}
		}

		return height;
	}
	
	getBoundingBox(pointclouds = this.pointclouds){
		let box = new THREE.Box3();

		this.scenePointCloud.updateMatrixWorld(true);
		this.referenceFrame.updateMatrixWorld(true);

		for (let pointcloud of pointclouds.filter(pc => pc.visible)) {
			pointcloud.updateMatrixWorld(true);
			let pointcloudBox = pointcloud.pcoGeometry.tightBoundingBox ? pointcloud.pcoGeometry.tightBoundingBox : pointcloud.boundingBox;
			let boxWorld = Utils.computeTransformedBoundingBox(pointcloudBox, pointcloud.matrixWorld);
			box.union(boxWorld);
		}

		return box;
	}

	getBoundingBox4One(pointcloud){
		let box = new THREE.Box3();
		this.scenePointCloud.updateMatrixWorld(true);
		this.referenceFrame.updateMatrixWorld(true);
		pointcloud.updateMatrixWorld(true);
		let pointcloudBox = pointcloud.pcoGeometry.tightBoundingBox ? pointcloud.pcoGeometry.tightBoundingBox : pointcloud.boundingBox;
		let boxWorld = Utils.computeTransformedBoundingBox(pointcloudBox, pointcloud.matrixWorld);
		box.union(boxWorld);

		return box;
	}

	getR3FPointCloudCoordinateOffset(pointcloud){
		// 与 R3F 基座点云保持一致：XY 使用 tightBoundingBox 的世界中心，Z 优先使用 metadata.offset[2]。
		const center = this.getBoundingBox4One(pointcloud).getCenter(new THREE.Vector3());
		const metadataOffsetZ = Number(pointcloud.pcoGeometry?.loader?.metadata?.offset?.[2]);

		if (Number.isFinite(metadataOffsetZ)) {
			center.z = metadataOffsetZ;
		}

		return center;
	}

	applyR3FPointCloudTransform(pointcloud){
		// 与 R3F 当前流程保持一致：先执行 moveToOrigin，再按 tightBoundingBox 的 min.z 贴地。
		pointcloud.position.set(0, 0, 0);
		pointcloud.updateMatrixWorld(true);

		const originBox = this.getBoundingBox4One(pointcloud);
		pointcloud.position.set(0, 0, 0).sub(originBox.getCenter(new THREE.Vector3()));
		pointcloud.updateMatrixWorld(true);

		const groundBox = this.getBoundingBox4One(pointcloud);
		pointcloud.position.z += -groundBox.min.z;
		pointcloud.updateMatrixWorld(true);
	}

	isOrdinaryPointCloud(pointcloud){
		// Forestry group pointclouds keep their existing independent placement workflow.
		return pointcloud?.treemindPointCloudSourceMode?.sourceKind !== 'group';
	}

	getOrdinaryPointClouds(){
		return this.pointclouds.filter((pointcloud) => this.isOrdinaryPointCloud(pointcloud));
	}

	getPointCloudCoordinateOffset(){
		// Expose one authoritative offset for coordinate labels and parent bridges.
		return this.activePointCloudTransformOffset?.clone()
			?? this.pointclouds[0]?.userData?.offset?.clone()
			?? new THREE.Vector3();
	}

	applyPointCloudTransformOffset(pointcloud, offset){
		// Rebuild from the source position to avoid cumulative floating-point drift.
		const sourcePosition = pointcloud.userData?.sourcePosition;
		if (!sourcePosition) {
			return;
		}

		pointcloud.position.copy(sourcePosition).add(offset);
		pointcloud.userData.appliedTransformOffset = offset.clone();
		pointcloud.userData.offset = offset.clone();
		pointcloud.updateMatrixWorld(true);
	}

	translateSceneObject(object, delta){
		if (!object) {
			return;
		}

		object.position?.add?.(delta);
		object.cameraPosition?.add?.(delta);
		object.cameraTarget?.add?.(delta);
		object.update?.();
		object.updateMatrixWorld?.(true);
	}

	rebasePointCloudCoordinateOffset(nextOffset, reason = 'multi-to-single'){
		// Translate every scene-space consumer in one transaction when the shared offset changes.
		const previousOffset = this.activePointCloudTransformOffset;
		if (!previousOffset) {
			this.activePointCloudTransformOffset = nextOffset.clone();
			this.getOrdinaryPointClouds().forEach((pointcloud) => {
				this.applyPointCloudTransformOffset(pointcloud, nextOffset);
			});
			return false;
		}

		const delta = nextOffset.clone().sub(previousOffset);
		if (delta.lengthSq() === 0) {
			return false;
		}

		this.getOrdinaryPointClouds().forEach((pointcloud) => {
			this.applyPointCloudTransformOffset(pointcloud, nextOffset);
		});

		// Move the navigation state once so camera and pivot keep their world relation.
		this.view.position.add(delta);
		this.cameraP.position.add(delta);
		this.cameraO.position.add(delta);
		this.cameraVR.position.add(delta);

		this.measurements.forEach((measurement) => {
			measurement.points?.forEach((point) => point.position?.add(delta));
			measurement.update?.();
		});
		this.profiles.forEach((profile) => {
			profile.points?.forEach((point) => point.add?.(delta));
			this.translateSceneObject(profile, delta);
		});
		this.volumes.forEach((volume) => this.translateSceneObject(volume, delta));
		this.polygonClipVolumes.forEach((volume) => this.translateSceneObject(volume, delta));
		this.annotations.traverse?.((annotation) => this.translateSceneObject(annotation, delta));

		this.activePointCloudTransformOffset = nextOffset.clone();
		this.dispatchEvent({
			type: 'pointcloud_offset_changed',
			previousOffset: previousOffset.clone(),
			nextOffset: nextOffset.clone(),
			delta: delta.clone(),
			reason,
		});

		return true;
	}

	reconcilePointCloudCoordinateOffset(){
		// Keep a ghost anchor while two or more ordinary pointclouds remain visible.
		this.pointCloudOffsetReconcileQueued = false;
		const visiblePointclouds = this.getOrdinaryPointClouds().filter((pointcloud) => pointcloud.visible);

		if (visiblePointclouds.length === 0) {
			this.activePointCloudTransformOffset = null;
			this.activePointCloudOffsetAnchor = null;
			return;
		}

		if (!this.activePointCloudTransformOffset) {
			const anchor = visiblePointclouds[0];
			const offset = anchor.userData?.selfTransformOffset;
			if (!offset) {
				return;
			}
			this.activePointCloudTransformOffset = offset.clone();
			this.activePointCloudOffsetAnchor = anchor;
			this.getOrdinaryPointClouds().forEach((pointcloud) => {
				this.applyPointCloudTransformOffset(pointcloud, offset);
			});
			return;
		}

		if (visiblePointclouds.length === 1) {
			const remainingPointcloud = visiblePointclouds[0];
			this.activePointCloudOffsetAnchor = remainingPointcloud;
			this.rebasePointCloudCoordinateOffset(
				remainingPointcloud.userData.selfTransformOffset,
				'multi-to-single',
			);
		}
	}

	queuePointCloudCoordinateOffsetReconcile(){
		// Coalesce sequential visibility writes so only the final set drives a rebase.
		if (this.pointCloudOffsetReconcileQueued) {
			return;
		}
		this.pointCloudOffsetReconcileQueued = true;
		queueMicrotask(() => this.reconcilePointCloudCoordinateOffset());
	}

	addPointCloud (pointcloud, translateToCenter = true) {
		this.pointclouds.push(pointcloud);
		this.scenePointCloud.add(pointcloud);
		
		if (translateToCenter) {
			const sourceMode = pointcloud.treemindPointCloudSourceMode;
			const cacheKey = pointcloud.sourceCacheKey;
			const oldPosition = pointcloud.position.clone();
			const isOrdinaryPointCloud = this.isOrdinaryPointCloud(pointcloud);
			
			// 如果是组模式且已有缓存的共享位移，则直接应用该位移
			if (sourceMode?.sourceKind === 'group' && cacheKey && this.groupOffsets.has(cacheKey)) {
				const sharedOffset = this.groupOffsets.get(cacheKey);
				pointcloud.position.copy(oldPosition.clone().add(sharedOffset));
			} else {
				// 首次加载按 R3F 当前顺序计算坐标 offset，再执行 moveToOrigin 与 Z 贴地。
				this.applyR3FPointCloudTransform(pointcloud);
				
				// 如果是组模式的第一个点云，记录产生的位移量（New - Old）供后续同步
				if (sourceMode?.sourceKind === 'group' && cacheKey) {
					// 组模式缓存第一份平移量和坐标 offset，后续同组点云复用同一套场景坐标系。
					const offset = pointcloud.position.clone().sub(oldPosition);
					this.groupOffsets.set(cacheKey, offset);
				}
			}

			// offset 表示点云对象真实平移量
			if (!pointcloud.userData) {
				pointcloud.userData = {};
			}
			const newPosition = pointcloud.position.clone();
			const selfTransformOffset = newPosition.subVectors(newPosition, oldPosition);
			pointcloud.userData.offset = selfTransformOffset.clone();

			if (isOrdinaryPointCloud) {
				// Keep the immutable source position so repeated rebases do not accumulate error.
				pointcloud.userData.sourcePosition = oldPosition.clone();
				pointcloud.userData.selfTransformOffset = selfTransformOffset.clone();

				if (!this.activePointCloudTransformOffset && pointcloud.visible) {
					this.activePointCloudTransformOffset = selfTransformOffset.clone();
					this.activePointCloudOffsetAnchor = pointcloud;
				}

				const activeOffset = this.activePointCloudTransformOffset ?? selfTransformOffset;
				this.applyPointCloudTransformOffset(pointcloud, activeOffset);
				pointcloud.addEventListener?.('visibility_changed', () => {
					this.queuePointCloudCoordinateOffsetReconcile();
				});
			}
		}

		this.dispatchEvent({
			type: 'pointcloud_added',
			pointcloud: pointcloud
		});
	}

	removePointCloud(pointcloud){
		// Keep Scene offset state in sync with explicit pointcloud disposal.
		const index = this.pointclouds.indexOf(pointcloud);
		if (index === -1) {
			return;
		}

		this.pointclouds.splice(index, 1);
		this.scenePointCloud.remove(pointcloud);
		this.reconcilePointCloudCoordinateOffset();
		this.dispatchEvent({type: 'pointcloud_removed', pointcloud});
	}

	addVolume (volume) {
		this.volumes.push(volume);
		this.dispatchEvent({
			'type': 'volume_added',
			'scene': this,
			'volume': volume
		});
	}

	addOrientedImages(images){
		this.orientedImages.push(images);
		this.scene.add(images.node);

		this.dispatchEvent({
			'type': 'oriented_images_added',
			'scene': this,
			'images': images
		});
	};

	removeOrientedImages(images){
		let index = this.orientedImages.indexOf(images);
		if (index > -1) {
			this.orientedImages.splice(index, 1);

			this.dispatchEvent({
				'type': 'oriented_images_removed',
				'scene': this,
				'images': images
			});
		}
	};

	add360Images(images){
		this.images360.push(images);
		this.scene.add(images.node);

		this.dispatchEvent({
			'type': '360_images_added',
			'scene': this,
			'images': images
		});
	}

	remove360Images(images){
		let index = this.images360.indexOf(images);
		if (index > -1) {
			this.images360.splice(index, 1);

			this.dispatchEvent({
				'type': '360_images_removed',
				'scene': this,
				'images': images
			});
		}
	}

	addGeopackage(geopackage){
		this.geopackages.push(geopackage);
		this.scene.add(geopackage.node);

		this.dispatchEvent({
			'type': 'geopackage_added',
			'scene': this,
			'geopackage': geopackage
		});
	};

	removeGeopackage(geopackage){
		let index = this.geopackages.indexOf(geopackage);
		if (index > -1) {
			this.geopackages.splice(index, 1);

			this.dispatchEvent({
				'type': 'geopackage_removed',
				'scene': this,
				'geopackage': geopackage
			});
		}
	};

	removeVolume (volume) {
		let index = this.volumes.indexOf(volume);
		if (index > -1) {
			this.volumes.splice(index, 1);

			this.dispatchEvent({
				'type': 'volume_removed',
				'scene': this,
				'volume': volume
			});
		}
	};

	addBoundingBox (boundingBox) {
		this.boundingBoxes.push(boundingBox);
		this.dispatchEvent({
			'type': 'bounding_box_added',
			'scene': this,
			'boundingBox': boundingBox
		});
	}

	removeBoundingBox (boundingBox) {
		let index = this.boundingBoxes.indexOf(boundingBox);
		if (index > -1) {
			this.boundingBoxes.splice(index, 1);

			this.dispatchEvent({
				'type': 'bounding_box_removed',
				'scene': this,
				'boundingBox': boundingBox
			});
		}
	}

	addCameraAnimation(animation) {
		this.cameraAnimations.push(animation);
		this.dispatchEvent({
			'type': 'camera_animation_added',
			'scene': this,
			'animation': animation
		});
	};

	removeCameraAnimation(animation){
		let index = this.cameraAnimations.indexOf(volume);
		if (index > -1) {
			this.cameraAnimations.splice(index, 1);

			this.dispatchEvent({
				'type': 'camera_animation_removed',
				'scene': this,
				'animation': animation
			});
		}
	};

	addPolygonClipVolume(volume){
		this.polygonClipVolumes.push(volume);
		this.dispatchEvent({
			"type": "polygon_clip_volume_added",
			"scene": this,
			"volume": volume
		});
	};
	
	removePolygonClipVolume(volume){
		let index = this.polygonClipVolumes.indexOf(volume);
		if (index > -1) {
			this.polygonClipVolumes.splice(index, 1);
			this.dispatchEvent({
				"type": "polygon_clip_volume_removed",
				"scene": this,
				"volume": volume
			});
		}
	};
	
	addMeasurement(measurement){
		measurement.lengthUnit = this.lengthUnit;
		measurement.lengthUnitDisplay = this.lengthUnitDisplay;
		this.measurements.push(measurement);
		this.dispatchEvent({
			'type': 'measurement_added',
			'scene': this,
			'measurement': measurement
		});
	};

	addMeasurement2platform(measurement){
		if (measurement.name == 'tag') {
			this.dispatchEvent({
				'type': 'tag_point_added_to_platform',
				'point': measurement.points[0].position
			});
		} else {
			this.dispatchEvent({
				'type': 'measurement_added_to_platform',
				'scene': this,
				'measurement': measurement
			});
		}
	};

	removeMeasurement (measurement) {
		const index = this.measurements.findIndex(m => m.uuid === measurement.uuid);
		if (index > -1) {
			this.measurements.splice(index, 1);
			this.dispatchEvent({
				'type': 'measurement_removed',
				'scene': this,
				'measurement': measurement
			});
		}
	}

	addProfile (profile) {
		this.profiles.push(profile);
		this.dispatchEvent({
			'type': 'profile_added',
			'scene': this,
			'profile': profile
		});
	}

	removeProfile (profile) {
		let index = this.profiles.indexOf(profile);
		if (index > -1) {
			this.profiles.splice(index, 1);
			this.dispatchEvent({
				'type': 'profile_removed',
				'scene': this,
				'profile': profile
			});
		}
	}

	removeAllMeasurements () {
		while (this.measurements.length > 0) {
			this.removeMeasurement(this.measurements[0]);
		}

		while (this.profiles.length > 0) {
			this.removeProfile(this.profiles[0]);
		}

		while (this.volumes.length > 0) {
			this.removeVolume(this.volumes[0]);
		}

		while (this.boundingBoxes.length > 0) {
			this.removeBoundingBox(this.boundingBoxes[0]);
		}
	}

	removeAllClipVolumes(){
		let clipVolumes = this.volumes.filter(volume => volume.clip === true);
		for(let clipVolume of clipVolumes){
			this.removeVolume(clipVolume);
		}

		while(this.polygonClipVolumes.length > 0){
			this.removePolygonClipVolume(this.polygonClipVolumes[0]);
		}
	}

	getActiveCamera() {

		if(this.overrideCamera){
			return this.overrideCamera;
		}

		if(this.cameraMode === CameraMode.PERSPECTIVE){
			return this.cameraP;
		}else if(this.cameraMode === CameraMode.ORTHOGRAPHIC){
			return this.cameraO;
		}else if(this.cameraMode === CameraMode.VR){
			return this.cameraVR;
		}

		return null;
	}
	
	initialize(){
		
		this.referenceFrame = new THREE.Object3D();
		this.referenceFrame.matrixAutoUpdate = false;
		this.scenePointCloud.add(this.referenceFrame);

		this.cameraP.up.set(0, 0, 1);
		this.cameraP.position.set(1000, 1000, 1000);
		this.cameraO.up.set(0, 0, 1);
		this.cameraO.position.set(1000, 1000, 1000);
		//this.camera.rotation.y = -Math.PI / 4;
		//this.camera.rotation.x = -Math.PI / 6;
		this.cameraScreenSpace.lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
		
		this.directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
		this.directionalLight.position.set( 10, 10, 10 );
		this.directionalLight.lookAt( new THREE.Vector3(0, 0, 0));
		this.scenePointCloud.add( this.directionalLight );
		
		let light = new THREE.AmbientLight( 0x555555 ); // soft white light
		this.scenePointCloud.add( light );

		{ // background
			let texture = Utils.createBackgroundTexture(512, 512);

			texture.minFilter = texture.magFilter = THREE.NearestFilter;
			texture.minFilter = texture.magFilter = THREE.LinearFilter;
			let bg = new THREE.Mesh(
				new THREE.PlaneBufferGeometry(2, 2, 1),
				new THREE.MeshBasicMaterial({
					map: texture
				})
			);
			bg.material.depthTest = false;
			bg.material.depthWrite = false;
			this.sceneBG.add(bg);
		}

		// { // lights
		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(10, 10, 1);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}

		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(-10, 10, 1);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}

		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(0, -10, 20);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}
		// }
	}
	
	addAnnotation(position, args = {}){		
		if(position instanceof Array){
			args.position = new THREE.Vector3().fromArray(position);
		} else if (position.x != null) {
			args.position = position;
		}
		let annotation = new Annotation(args);
		this.annotations.add(annotation);

		return annotation;
	}

	getAnnotations () {
		return this.annotations;
	};

	removeAnnotation(annotationToRemove) {
		this.annotations.remove(annotationToRemove);
	}
};
