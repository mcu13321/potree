
import * as THREE from "../../libs/three.js/build/three.module.js";
import {Measure, setMeasureLinePositions} from "./Measure.js";
import {Utils} from "../utils.js";
import {CameraMode} from "../defines.js";
import { EventDispatcher } from "../EventDispatcher.js";

function updateAzimuth(viewer, measure){

	const azimuth = measure.azimuth;

	const isOkay = measure.points.length === 2;

	azimuth.node.visible = isOkay && measure.showAzimuth;

	if(!azimuth.node.visible){
		return;
	}

	const camera = viewer.scene.getActiveCamera();
	const renderAreaSize = viewer.renderer.getSize(new THREE.Vector2());
	const width = renderAreaSize.width;
	const height = renderAreaSize.height;
	
	const [p0, p1] = measure.points;
	const r = p0.position.distanceTo(p1.position);
	const northVec = Utils.getNorthVec(p0.position, r, viewer.getProjection());
	const northPos = p0.position.clone().add(northVec);

	azimuth.center.position.copy(p0.position);
	azimuth.center.scale.set(2, 2, 2);
	
	azimuth.center.visible = false;
	// azimuth.target.visible = false;


	{ // north
		azimuth.north.position.copy(northPos);
		azimuth.north.scale.set(2, 2, 2);

		let distance = azimuth.north.position.distanceTo(camera.position);
		let pr = Utils.projectedRadius(1, camera, distance, width, height);

		let scale = (5 / pr);
		azimuth.north.scale.set(scale, scale, scale);
	}

	{ // target
		azimuth.target.position.copy(p1.position);
		azimuth.target.position.z = azimuth.north.position.z;

		let distance = azimuth.target.position.distanceTo(camera.position);
		let pr = Utils.projectedRadius(1, camera, distance, width, height);

		let scale = (5 / pr);
		azimuth.target.scale.set(scale, scale, scale);
	}


	azimuth.circle.position.copy(p0.position);
	azimuth.circle.scale.set(r, r, r);
	azimuth.circle.material.resolution?.set(width, height);

	// to target
	setMeasureLinePositions(azimuth.centerToTarget, [
		0, 0, 0,
		...p1.position.clone().sub(p0.position).toArray(),
	]);
	azimuth.centerToTarget.position.copy(p0.position);
	azimuth.centerToTarget.material.resolution?.set(width, height);

	// to target ground
	setMeasureLinePositions(azimuth.centerToTargetground, [
		0, 0, 0,
		p1.position.x - p0.position.x,
		p1.position.y - p0.position.y,
		0,
	]);
	azimuth.centerToTargetground.position.copy(p0.position);
	azimuth.centerToTargetground.material.resolution?.set(width, height);

	// to north
	setMeasureLinePositions(azimuth.centerToNorth, [
		0, 0, 0,
		northPos.x - p0.position.x,
		northPos.y - p0.position.y,
		0,
	]);
	azimuth.centerToNorth.position.copy(p0.position);
	azimuth.centerToNorth.material.resolution?.set(width, height);

	// label
	const radians = Utils.computeAzimuth(p0.position, p1.position, viewer.getProjection());
	let degrees = THREE.Math.radToDeg(radians);
	if(degrees < 0){
		degrees = 360 + degrees;
	}
	const txtDegrees = `${degrees.toFixed(2)}°`;
	const labelDir = northPos.clone().add(p1.position).multiplyScalar(0.5).sub(p0.position);
	if(labelDir.length() > 0){
		labelDir.z = 0;
		labelDir.normalize();
		const labelVec = labelDir.clone().multiplyScalar(r);
		const labelPos = p0.position.clone().add(labelVec);
		azimuth.label.position.copy(labelPos);
	}
	azimuth.label.setText(txtDegrees);
}

export class MeasuringTool extends EventDispatcher{
	constructor (viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;

		this.addEventListener('start_inserting_measurement', e => {
			// this.viewer.dispatchEvent({
			// 	type: 'cancel_insertions'
			// });
		});

		this.showLabels = true;
		this.scene = new THREE.Scene();
		this.scene.name = 'scene_measurement';
		this.light = new THREE.PointLight(0xffffff, 1.0);
		this.scene.add(this.light);
		this.activeMeasurement = null;
		this.eventMeasurement = null;
		// 直接复用 renderArea 作为测量标签 HTML 的挂载根节点。
		this.renderArea = this.getRenderAreaElement();
		
		this.viewer.inputHandler.registerInteractiveScene(this.scene);

		// 测量对象进入或离开场景时，同时同步管理其 DOM 标签生命周期。
		this.onRemove = (e) => {
			if (e.measurement?.isCadVector) {
				return;
			}
			this.disposeMeasurementLabels(e.measurement);
			this.scene.remove(e.measurement);
			// Release measurement GPU resources after detaching it from the overlay scene.
			e.measurement?.dispose?.();
		};
		this.onAdd = e => {
			if (e.measurement?.isCadVector) {
				return;
			}
			this.scene.add(e.measurement);
			this.syncMeasurementLabels(e.measurement);
		};

		for(let measurement of viewer.scene.measurements){
			this.onAdd({measurement: measurement});
		}

		viewer.addEventListener("update", this.update.bind(this));
		viewer.addEventListener("render.pass.perspective_overlay", this.render.bind(this));
		viewer.addEventListener("scene_changed", this.onSceneChange.bind(this));

		viewer.scene.addEventListener('measurement_added', this.onAdd);
		viewer.scene.addEventListener('measurement_removed', this.onRemove);
		this.measurementTypeName = null;

		this.mouseDownPosition = null;
		this.viewer.renderer.domElement.addEventListener('mousedown', (e) => {
			// 统一记录为画布本地坐标，保证鼠标与触摸分支共用同一判定逻辑。
			this.mouseDownPosition = this.viewer.inputHandler.getEventLocalPosition(e);
		});
		this.viewer.renderer.domElement.addEventListener('touchstart', (e) => {
			// 统一记录为画布本地坐标，避免混用原始触摸坐标。
			this.mouseDownPosition = this.viewer.inputHandler.getEventLocalPosition(e);
		});



		this.viewer.addEventListener('cancel_insertions', (e) => {
			if (this.eventMeasurement && this.eventMeasurement.maxMarkers > 1) {
				this.eventMeasurement?.cancel?.callback(e)
			}
		});
		this.viewer.renderer.domElement.addEventListener('mouseup', (e) => {
			if (this.eventMeasurement && this.eventMeasurement.maxMarkers > 1) {
				this.eventMeasurement?.insertionCallback?.(e);
			}
		}, false);
		this.viewer.renderer.domElement.addEventListener('touchend', (e) => {
			if (this.eventMeasurement && this.eventMeasurement.maxMarkers > 1) {
				// 触摸结束时以抬手位置重新计算悬停点，避免沿用旧命中结果。
				let localPosition = this.viewer.inputHandler.getEventLocalPosition(e);
				if(localPosition){
					this.viewer.inputHandler.refreshHoveredPoint(localPosition);
				}
				this.eventMeasurement?.insertionCallback?.(e);
			}
		});
	}

	// 统一从事件中提取画布本地坐标，供测量插点和拖拽共用。
	getEventLocalPosition(event){
		return this.viewer.inputHandler.getEventLocalPosition(event);
	}

	// 统一复用 InputHandler 的轻点判定，避免不同模块阈值不一致。
	isTapEvent(event, endPosition){
		let pointerType = event.type.startsWith("touch") ? "touch" : "mouse";
		return this.viewer.inputHandler.isTapGesture(pointerType, this.mouseDownPosition, endPosition);
	}

	// 兼容真实 viewer 与测试 mock，统一解析 renderArea 根节点。
	getRenderAreaElement(){
		const renderArea = this.viewer.renderArea;
		if (renderArea instanceof HTMLElement) {
			return renderArea;
		}
		if (renderArea && renderArea[0] instanceof HTMLElement) {
			return renderArea[0];
		}

		return this.viewer.renderer.domElement?.parentElement ?? null;
	}

	// 兼容真实 Measure 与测试 mock，统一收集当前测量持有的标签对象。
	collectMeasurementLabels(measurement){
		if (typeof measurement?.getAllLabels === "function") {
			return measurement.getAllLabels();
		}

		return [
			...(measurement?.sphereLabels ?? []),
			...(measurement?.edgeLabels ?? []),
			...(measurement?.angleLabels ?? []),
			...(measurement?.coordinateLabels ?? []),
			measurement?.heightLabel,
			measurement?.areaLabel,
			measurement?.circleRadiusLabel,
			measurement?.azimuth?.label,
		].filter(Boolean);
	}

	// 把尚未挂载的测量标签补挂到 renderArea，支持插点过程中的动态新增标签。
	syncMeasurementLabels(measurement){
		this.renderArea = this.getRenderAreaElement();
		if (!this.renderArea) {
			return;
		}

		for (const label of this.collectMeasurementLabels(measurement)) {
			label.attach?.(this.renderArea);
		}
	}

	// 测量删除时统一释放其 DOM 标签，避免 renderArea 中残留节点。
	disposeMeasurementLabels(measurement){
		if (typeof measurement?.disposeLabels === "function") {
			measurement.disposeLabels();
			return;
		}

		for (const label of this.collectMeasurementLabels(measurement)) {
			label.dispose?.();
		}
	}

	// 每帧根据相机位置刷新测量标签的屏幕投影结果。
	updateMeasurementLabels(measurement, camera, clientWidth, clientHeight){
		this.syncMeasurementLabels(measurement);

		const measurementVisible = measurement?.visible !== false;
		const globalVisible = this.showLabels && measurementVisible;

		for (const label of this.collectMeasurementLabels(measurement)) {
			label.updateScreenPosition?.(camera, clientWidth, clientHeight, globalVisible);
		}
	}

	setActiveMeasurement(measurement){
		this.activeMeasurement = measurement;
		
		this.viewer.scene.measurements.forEach(measurement => {
			measurement.update();
		});
	}

	setReadonlyStatus(readonly){
		this.viewer.inputHandler.setMeasurementReadonlyStatus(readonly);
	}

	onSceneChange(e){
		if(e.oldScene){
			e.oldScene.removeEventListener('measurement_added', this.onAdd);
			e.oldScene.removeEventListener('measurement_removed', this.onRemove);
		}

		e.scene.addEventListener('measurement_added', this.onAdd);
		e.scene.addEventListener('measurement_removed', this.onRemove);
	}

	startInsertion (args = {}) {
		this.viewer.axisLineMarkerTool?.stopInsertion?.({
			discardDraft: true,
			reason: "other_measurement_started",
		});
		this.measurementTypeName = args.name;
		
		this.viewer.scene.measurements.forEach(measurement => {
			if (!measurement.finished) {
				this.viewer.scene.removeMeasurement(measurement);
			}
		});
		let domElement = this.viewer.renderer.domElement;
		let measure = new Measure(this.viewer);
		
		this.dispatchEvent({
			type: 'start_inserting_measurement',
			measure: measure
		});
		this.viewer.scene.dispatchEvent({
			type: 'measurement_selected',
			measurement: null,
		});
		this.setActiveMeasurement(null)
		this.eventMeasurement = measure;

		const pick = (defaul, alternative) => {
			if(defaul != null){
				return defaul;
			}else{
				return alternative;
			}
		};

		measure.showDistances = (args.showDistances === null) ? true : args.showDistances;

		measure.showArea = pick(args.showArea, false);
		measure.showAngles = pick(args.showAngles, false);
		measure.showCoordinates = pick(args.showCoordinates, false);
		measure.showHeight = pick(args.showHeight, false);
		measure.showCircle = pick(args.showCircle, false);
		measure.showAzimuth = pick(args.showAzimuth, false);
		measure.showEdges = pick(args.showEdges, true);
		measure.closed = pick(args.closed, false);
		measure.maxMarkers = pick(args.maxMarkers, Infinity);

		measure.name = args.name || 'Measurement';

		this.scene.add(measure);

		let cancel = {
			removeLastMarker: measure.maxMarkers > 3,
			callback: null
		};
		
		let insertionCallback = (e) => {
			let endPosition = this.getEventLocalPosition(e);
			if (this.mouseDownPosition && endPosition) {
				const hasMoved = !this.isTapEvent(e, endPosition);
				let hoveredPoint = this.viewer.inputHandler.hoveredPoint;
				let isAreaPlaneClick = this.eventMeasurement && this.eventMeasurement.name === 'area' && this.eventMeasurement.points.length >= 4;
				
				if ((e.button === THREE.MOUSE.LEFT || e.type === 'touchend') && !hasMoved && (hoveredPoint || isAreaPlaneClick)) {

					if (this.eventMeasurement.points.length >= this.eventMeasurement.maxMarkers) {
						cancel.callback();
					} else {
						this.eventMeasurement.addMarker(this.eventMeasurement.points[this.eventMeasurement.points.length - 1].position.clone());
						this.viewer.scene.dispatchEvent({
							type: 'measurement_selected',
							measurement: this.eventMeasurement,
						});
						this.setActiveMeasurement(this.eventMeasurement);

						this.viewer.inputHandler.startDragging(this.eventMeasurement.spheres[this.eventMeasurement.spheres.length - 1]);
					}

	
				} else if (e.button === THREE.MOUSE.RIGHT) {
					cancel.callback({fromRightClick: true});	
				}
			}
		};

		cancel.callback = e => {
			
			if (cancel.removeLastMarker) {
				this.eventMeasurement.removeMarker(this.eventMeasurement.points.length - 1);
			}
			// domElement.removeEventListener('mouseup', insertionCallback, false);
			// this.viewer.removeEventListener('cancel_insertions', cancel.callback);
			if (this.measurementTypeName == this.eventMeasurement.name) {
				this.eventMeasurement.dispatchEvent({
					'type': 'measure_finished',
					'measurement': this.eventMeasurement,
					'fromRightClick': e && !!e.fromRightClick
				});
			}
			// if (e && !!e.fromRightClick && (measure.name == 'height' || measure.name == 'angle')) {
			// 	this.viewer.scene.removeMeasurement(measure);
			// }
		};

		measure.cancel = cancel;
		measure.insertionCallback = insertionCallback;

		measure.reStart = () => {
			measure.removeEventListener('measure_finished', measureFinished)
			const copyMeasurement = {
				name: measure.name,
				points: JSON.parse(JSON.stringify(measure.points)),
			};
			this.viewer.scene.removeMeasurement(measure);
			setTimeout(() => {
				if (this.measurementTypeName == copyMeasurement.name) {
					this.createNewMeasure(copyMeasurement)
				}
			})
		}

		// if (measure.maxMarkers > 1) {
			// this.viewer.addEventListener('cancel_insertions', cancel.callback);
			// domElement.addEventListener('mouseup', insertionCallback, false);
		// }

		const measureFinished = (e) => {
			measure.removeEventListener('measure_finished', measureFinished)
			e.measurement.finished = true;
			const copyMeasurement = {
				name: e.measurement.name,
				points: JSON.parse(JSON.stringify(e.measurement.points)),
			};
			if (!(e.measurement.name == 'length' && e.measurement.points.length < 2) 
				&& !(e.measurement.name == 'area' && e.measurement.points.length < 3) 
				&& !(e.fromRightClick && (measure.name == 'height' || measure.name == 'angle'))
				&& !(e.measurement.name == 'height' && e.measurement.points.length < 2) 
				&& !(e.measurement.name == 'angle' && e.measurement.points.length < 3) 
			) {
				this.viewer.scene.addMeasurement2platform(e.measurement);
			} else {
				this.viewer.scene.removeMeasurement(e.measurement);
				this.update();
			}
			if (e.measurement.name == 'tag') {
				this.viewer.scene.removeMeasurement(e.measurement);		
				this.stopInsertion('tag');
			} else {
				setTimeout(() => {
					if (this.measurementTypeName == copyMeasurement.name) {
						this.createNewMeasure(copyMeasurement)
					}
				})	
			}
		}

		measure.addEventListener('measure_finished', measureFinished)

		// const p = args.position ? new THREE.Vector3().copy(args.position) : new THREE.Vector3(100000, 100000, 0) 
		const p = new THREE.Vector3(100000, 100000, 0) 

		measure.addMarker(p);
		
		this.viewer.inputHandler.startDragging(measure.spheres[measure.spheres.length - 1]);

		this.viewer.scene.addMeasurement(measure);

		return measure;
	}

	stopInsertion(type = 'measurement'){
		this.measurementTypeName = null;
		this.eventMeasurement = null;
		this.viewer.inputHandler.endDragging();
		this.viewer.scene.measurements.forEach(measurement => {
			if (type == 'measurement') {
				if (!measurement.finished && measurement.name != 'tag') {
					this.viewer.scene.removeMeasurement(measurement);
				}
			} else if (type == 'tag') {
				if (measurement.name == 'tag') {
					this.viewer.scene.removeMeasurement(measurement);
				}
			}
			
		});
	}
	
	update(){
		let camera = this.viewer.scene.getActiveCamera();
		let measurements = this.viewer.scene.measurements;

		const renderAreaSize = this.renderer.getSize(new THREE.Vector2());
		let clientWidth = renderAreaSize.width ?? renderAreaSize.x;
		let clientHeight = renderAreaSize.height ?? renderAreaSize.y;

		this.light.position.copy(camera.position);
		const dpr = window.devicePixelRatio || 1;
		const isMobile = dpr > 1.5;
		// make size independant of distance
		for (let measure of measurements) {
			if (measure.isCadVector) {
				continue;
			}
			measure.lengthUnit = this.viewer.lengthUnit;
			measure.lengthUnitDisplay = this.viewer.lengthUnitDisplay;
			measure.update();
			// 在投影 HTML 标签前主动刷新矩阵，确保标签世界坐标可直接读取。
			measure.updateMatrixWorld(true);

			updateAzimuth(this.viewer, measure);
			//TODO 移动端横屏与竖屏测量标记显示大小不一致，尚未找到原因，下方根据横屏或竖屏设置不同scaley为权宜之计
			//spheres
			if (camera.isPerspectiveCamera) {
				const scaleyOverlay = isMobile ?  window.innerHeight > window.innerWidth ? 1.3 : 2.6 : 1;
				for(let sphere of measure.spheres){
					sphere.scale.set(20 / 1000 * scaleyOverlay, 20 / 1000 * scaleyOverlay, 1)
				}
			} else {
				const scaleyOverlay = isMobile ?  window.innerHeight > window.innerWidth ? 1.3 : 2.6 : 1;
				const currentWorldHeight = (camera.top - camera.bottom) / camera.zoom;
				for(let sphere of measure.spheres){
					sphere.scale.set(currentWorldHeight / 75 * scaleyOverlay, currentWorldHeight / 75 * scaleyOverlay, 1);
				}
			}

			//spheres
			// for(let sphere of measure.spheres){
			// 	let distance = camera.position.distanceTo(sphere.getWorldPosition(new THREE.Vector3()));
			// 	let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
			// 	let scale = (15 / pr);
			// 	sphere.scale.set(scale, scale, scale);
			// }

			// labels
			// let labels = measure.edgeLabels.concat(measure.angleLabels);
			// for(let label of labels){
			// 	let distance = camera.position.distanceTo(label.getWorldPosition(new THREE.Vector3()));
			// 	let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
			// 	let scale = (70 / pr);

			// 	if(Potree.debug.scale){
			// 		scale = (Potree.debug.scale / pr);
			// 	}

			// 	label.scale.set(scale, scale, scale);
			// }

			//coordinate labels
			// for (let j = 0; j < measure.coordinateLabels.length; j++) {
			// 	let label = measure.coordinateLabels[j];
			// 	let sphere = measure.spheres[j];

			// 	let sphereWorldPos = sphere.getWorldPosition(new THREE.Vector3());
			// 	let distance = camera.position.distanceTo(sphereWorldPos);
			// 	// 检查sphere是否在camera后方
			// 	// 获取从camera到sphere的向量
			// 	let cameraToSphere = sphereWorldPos.clone().sub(camera.position);
			// 	// 获取camera的前方向
			// 	let cameraDirection = camera.getWorldDirection(new THREE.Vector3());
			// 	// 点积：如果为负，说明sphere在camera后面
			// 	let dotProduct = cameraToSphere.dot(cameraDirection);
			// 	if (dotProduct < 0) {
			// 		continue
			// 	}


			// 	// 简化的做法：直接在世界坐标中计算偏移
			// 	// 方向：从camera指向sphere
			// 	let direction = sphereWorldPos.clone().sub(camera.position).normalize();
				
			// 	// 垂直方向（屏幕向上）
			// 	let upDir = new THREE.Vector3(0, 0, 1);
				
			// 	// 根据相机距离自动计算偏移距离
			// 	// 相机越近，偏移越小；相机越远，偏移越大
			// 	let offsetDistance = -distance * 0.13;  // 距离的 15%
				
			// 	// label 位置 = sphere 位置 + 向上偏移
			// 	let labelPos = sphereWorldPos.clone().add(upDir.multiplyScalar(offsetDistance));
			// }

			// height label
			if (measure.showHeight) {
				// let label = measure.heightLabel;

				{
					// let distance = label.position.distanceTo(camera.position);
					// let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
					// let scale = (70 / pr);
					// label.scale.set(scale, scale, scale);
				}

				{ // height edge
					let edge = measure.heightEdge;

					let sorted = measure.points.slice().sort((a, b) => a.position.z - b.position.z);
					let lowPoint = sorted[0].position.clone();
					let highPoint = sorted[sorted.length - 1].position.clone();
					let min = lowPoint.z;
					let max = highPoint.z;

					let start = new THREE.Vector3(highPoint.x, highPoint.y, min);
					let end = new THREE.Vector3(highPoint.x, highPoint.y, max);

					let lowScreen = lowPoint.clone().project(camera);
					let startScreen = start.clone().project(camera);
					let endScreen = end.clone().project(camera);

					let toPixelCoordinates = v => {
						let r = v.clone().addScalar(1).divideScalar(2);
						r.x = r.x * clientWidth;
						r.y = r.y * clientHeight;
						r.z = 0;

						return r;
					};

					let lowEL = toPixelCoordinates(lowScreen);
					let startEL = toPixelCoordinates(startScreen);
					let endEL = toPixelCoordinates(endScreen);

					let lToS = lowEL.distanceTo(startEL);
					let sToE = startEL.distanceTo(endEL);

					if (edge.isLine2) {
						edge.geometry.lineDistances = [0, lToS, lToS, lToS + sToE];
						edge.geometry.lineDistancesNeedUpdate = true;
						edge.material.dashSize = 10;
						edge.material.gapSize = 10;
					}
				}
			}

			{ // area label
				// let label = measure.areaLabel;
				// let distance = label.position.distanceTo(camera.position);
				// let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);

				// let scale = (70 / pr);
				// label.scale.set(scale, scale, scale);
			}

			{ // radius label
				// HTML 标签固定为屏幕尺寸，这里不再执行 sprite 缩放。
			}

			{ // edges
				const materials = [
					measure.circleRadiusLine.material,
					...measure.edges.map( (e) => e.material),
					measure.heightEdge.material,
					measure.circleLine.material,
				];

				for(const material of materials){
					material.resolution?.set(clientWidth, clientHeight);
				}
			}

			if(!this.showLabels){

				const labels = [
					...measure.sphereLabels, 
					...measure.edgeLabels, 
					...measure.angleLabels, 
					...measure.coordinateLabels,
					measure.heightLabel,
					measure.areaLabel,
					measure.circleRadiusLabel,
				];

				for(const label of labels){
					label.updateScreenPosition?.(camera, clientWidth, clientHeight, false);
				}
			} else {
				const measurementVisible = measure?.visible !== false;
				const globalVisible = this.showLabels && measurementVisible;
				const labels = [
					...measure.sphereLabels, 
					...measure.edgeLabels, 
					...measure.angleLabels, 
					...measure.coordinateLabels,
					measure.heightLabel,
					measure.areaLabel,
					measure.circleRadiusLabel,
				];
				if (camera.isPerspectiveCamera) {
					//TODO 移动端横屏与竖屏测量标记显示大小不一致，尚未找到原因，下方根据横屏或竖屏设置不同scaley为权宜之计
					const scaleyOverlay = isMobile ?  window.innerHeight > window.innerWidth ? 0.8 : 1.8 : 1;
					for(let label of labels){
						label.updateScreenPosition?.(camera, clientWidth, clientHeight, globalVisible);
					}
				} else {
					const scaleyOverlay = isMobile ? window.innerHeight > window.innerWidth ? 0.55 : 1.2: 0.75;
					const trueZoom = (camera.top - camera.bottom) / camera.zoom * scaleyOverlay;
					for(let label of labels){
						label.updateScreenPosition?.(camera, clientWidth, clientHeight, globalVisible);
					}
				}
			}

			// 统一收口到 HTML 标签投影更新，补齐方位角等不在旧数组中的标签。
			this.updateMeasurementLabels(measure, camera, clientWidth, clientHeight);
		}
	}

	render(){
		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}

	createNewMeasure(oldMeasurement) {
		switch(oldMeasurement.name){
			case 'point':
				this.startInsertion({
					showDistances: false,
					showAngles: false,
					showCoordinates: true,
					showArea: false,
					closed: true,
					maxMarkers: 1,
					name: 'point',
					position: oldMeasurement.points[oldMeasurement.points.length-1]?.position || null,
				});
				break;
			case 'length':
				this.startInsertion({
					showDistances: true,
					showArea: false,
					closed: false,
					name: 'length',
					position: oldMeasurement.points[oldMeasurement.points.length-1]?.position || null,
				});
				break;
			case 'height':
				this.startInsertion({
					showDistances: false,
					showHeight: true,
					showArea: false,
					closed: false,
					maxMarkers: 2,
					name: 'height',
					position: oldMeasurement.points[oldMeasurement.points.length-1]?.position || null,
				});
				break;
			case 'angle':
				this.startInsertion({
					showDistances: false,
					showAngles: true,
					showArea: false,
					closed: true,
					maxMarkers: 3,
					name: 'angle',
					position: oldMeasurement.points[oldMeasurement.points.length-1]?.position || null,
				});
				break;
			case 'area':
				this.startInsertion({
					showDistances: false,
					showArea: true,
					closed: true,
					name: 'area',
					position: oldMeasurement.points[oldMeasurement.points.length-1]?.position || null,
				});
				break;
		}
	}
};
