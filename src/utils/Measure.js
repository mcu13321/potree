
import * as THREE from "../../libs/three.js/build/three.module.js";
import {TextSprite} from "../TextSprite.js";
import {Utils} from "../utils.js";
import {Line2} from "../../libs/three.js/lines/Line2.js";
import {LineGeometry} from "../../libs/three.js/lines/LineGeometry.js";
import {LineMaterial} from "../../libs/three.js/lines/LineMaterial.js";
import { Circle } from '../../libs/konva/lib/shapes/Circle.js';
function createHeightLine(){
	let lineGeometry = new LineGeometry();

	lineGeometry.setPositions([
		0, 0, 0,
		0, 0, 0,
	]);

	let lineMaterial = new LineMaterial({ 
		color: 0x2e82ff, 
		dashSize: 5, 
		gapSize: 2,
		linewidth: 2, 
		resolution:  new THREE.Vector2(1000, 1000),
	});

	lineMaterial.depthTest = false;
	const heightEdge = new Line2(lineGeometry, lineMaterial);
	heightEdge.visible = false;

	return heightEdge;
}

function createHeightLabel(viewer){
	const heightLabel = new TextSprite('', viewer);
	heightLabel.visible = false;
	return heightLabel;
}

function createAreaLabel(viewer){
	const areaLabel = new TextSprite('', viewer);
	areaLabel.visible = false;
	return areaLabel;
}

function createCircleRadiusLabel(viewer){
	const circleRadiusLabel = new TextSprite("", viewer);
	circleRadiusLabel.visible = false;
	
	return circleRadiusLabel;
}

function createCircleRadiusLine(){
	const lineGeometry = new LineGeometry();

	lineGeometry.setPositions([
		0, 0, 0,
		0, 0, 0,
	]);

	const lineMaterial = new LineMaterial({ 
		color: 0xff0000, 
		linewidth: 2, 
		resolution:  new THREE.Vector2(1000, 1000),
		gapSize: 1,
		dashed: true,
	});

	lineMaterial.depthTest = false;

	const circleRadiusLine = new Line2(lineGeometry, lineMaterial);
	circleRadiusLine.visible = false;

	return circleRadiusLine;
}

function createCircleLine(){
	const coordinates = [];

	let n = 128;
	for(let i = 0; i <= n; i++){
		let u0 = 2 * Math.PI * (i / n);
		let u1 = 2 * Math.PI * (i + 1) / n;

		let p0 = new THREE.Vector3(
			Math.cos(u0), 
			Math.sin(u0), 
			0
		);

		let p1 = new THREE.Vector3(
			Math.cos(u1), 
			Math.sin(u1), 
			0
		);

		coordinates.push(
			...p0.toArray(),
			...p1.toArray(),
		);
	}

	const geometry = new LineGeometry();
	geometry.setPositions(coordinates);

	const material = new LineMaterial({ 
		color: 0xff0000, 
		dashSize: 5, 
		gapSize: 2,
		linewidth: 2, 
		resolution:  new THREE.Vector2(1000, 1000),
	});

	material.depthTest = false;

	const circleLine = new Line2(geometry, material);
	circleLine.visible = false;
	circleLine.computeLineDistances();

	return circleLine;
}

function createCircleCenter(){
	const sg = new THREE.SphereGeometry(1, 32, 32);
	const sm = new THREE.MeshNormalMaterial();
	
	const circleCenter = new THREE.Mesh(sg, sm);
	circleCenter.visible = false;

	return circleCenter;
}

function createLine(){
	const geometry = new LineGeometry();

	geometry.setPositions([
		0, 0, 0,
		0, 0, 0,
	]);

	const material = new LineMaterial({ 
		color: 0x2e82ff,
		linewidth: 2, 
		resolution:  new THREE.Vector2(1000, 1000),
		gapSize: 1,
		dashed: true,
	});

	material.depthTest = false;

	const line = new Line2(geometry, material);

	return line;
}

function createCircle(){

	const coordinates = [];

	let n = 128;
	for(let i = 0; i <= n; i++){
		let u0 = 2 * Math.PI * (i / n);
		let u1 = 2 * Math.PI * (i + 1) / n;

		let p0 = new THREE.Vector3(
			Math.cos(u0), 
			Math.sin(u0), 
			0
		);

		let p1 = new THREE.Vector3(
			Math.cos(u1), 
			Math.sin(u1), 
			0
		);

		coordinates.push(
			...p0.toArray(),
			...p1.toArray(),
		);
	}

	const geometry = new LineGeometry();
	geometry.setPositions(coordinates);

	const material = new LineMaterial({ 
		color: 0xff0000, 
		dashSize: 5, 
		gapSize: 2,
		linewidth: 2, 
		resolution:  new THREE.Vector2(1000, 1000),
	});

	material.depthTest = false;

	const line = new Line2(geometry, material);
	line.computeLineDistances();

	return line;

}

function createAzimuth(viewer){

	const azimuth = {
		label: null,
		center: null,
		target: null,
		north: null,
		centerToNorth: null,
		centerToTarget: null,
		centerToTargetground: null,
		targetgroundToTarget: null,
		circle: null,

		node: null,
	};

	const sg = new THREE.SphereGeometry(1, 32, 32);
	const sm = new THREE.MeshNormalMaterial();

	{
		const label = new TextSprite("", viewer);
		azimuth.label = label;
	}

	azimuth.center = new THREE.Mesh(sg, sm);
	azimuth.target = new THREE.Mesh(sg, sm);
	azimuth.north = new THREE.Mesh(sg, sm);
	azimuth.centerToNorth = createLine();
	azimuth.centerToTarget = createLine();
	azimuth.centerToTargetground = createLine();
	azimuth.targetgroundToTarget = createLine();
	azimuth.circle = createCircle();

	azimuth.node = new THREE.Object3D();
	azimuth.node.add(
		azimuth.centerToNorth,
		azimuth.centerToTarget,
		azimuth.centerToTargetground,
		azimuth.targetgroundToTarget,
		azimuth.circle,
		azimuth.label,
		azimuth.center,
		azimuth.target,
		azimuth.north,
	);

	return azimuth;
}
export class Measure extends THREE.Object3D {
	constructor (_viewer) {
		super();
		this.viewer = _viewer;
		this.MeasuringTool = _viewer.measuringTool;
		this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;

		this.name = 'Measure_' + this.constructor.counter;
		this.points = [];
		this._showDistances = true;
		this._showCoordinates = false;
		this._showArea = false;
		this._closed = true;
		this._showAngles = false;
		this._showCircle = false;
		this._showHeight = false;
		this._showEdges = true;
		this._showAzimuth = false;
		this.maxMarkers = Number.MAX_SAFE_INTEGER;
		[this.materialBlue, this.materialRed] = this.creatMaterials();

		this.sphereGeometry = new THREE.SphereGeometry(0.4, 10, 10);
		this.color = new THREE.Color(0xff0000);
		this.finished = false;
		this.spheres = [];
		this.edges = [];
		this.sphereLabels = [];
		this.edgeLabels = [];
		this.angleLabels = [];
		this.coordinateLabels = [];

		this.heightEdge = createHeightLine();
		this.heightLabel = createHeightLabel(this.viewer);
		this.areaLabel = createAreaLabel(this.viewer);
		this.circleRadiusLabel = createCircleRadiusLabel(this.viewer);
		this.circleRadiusLine = createCircleRadiusLine();
		this.circleLine = createCircleLine();
		this.circleCenter = createCircleCenter();

		this.azimuth = createAzimuth(this.viewer);

		this.add(this.heightEdge);
		this.add(this.heightLabel);
		this.add(this.areaLabel);
		this.add(this.circleRadiusLabel);
		this.add(this.circleRadiusLine);
		this.add(this.circleLine);
		this.add(this.circleCenter);

		this.add(this.azimuth.node);
	}

	creatMaterials() {
		const circle1 = new Circle({
			radius: 8,
			fill: '#ffffff',
			stroke: '#2e82ff',
			strokeWidth: 4,
		})
		const canvas1 = circle1.toCanvas()
		const texture1 = new THREE.CanvasTexture(canvas1)
		const material1 = new THREE.SpriteMaterial({
			map: texture1,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 1,
			sizeAttenuation: false, // 禁用大小衰减
		})

		const circle2 = new Circle({
			radius: 8,
			fill: '#ffffff',
			stroke: '#ff0000',
			strokeWidth: 4,
		})
		const canvas2 = circle2.toCanvas()
		const texture2 = new THREE.CanvasTexture(canvas2)
		const material2 = new THREE.SpriteMaterial({
			map: texture2,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 1,
			sizeAttenuation: false, // 禁用大小衰减
		})
		
		return [material1, material2]
	}

	updateMarkers () {
		this.spheres.forEach(sphere => {
			sphere.material = this.MeasuringTool.activeMeasurement == this ? this.materialRed : this.materialBlue;
			sphere.material.needsUpdate = true;
		})
	}

	addMarker (point) {
		if (point.x != null) {
			point = {position: point};
		}else if(point instanceof Array){
			point = {position: new THREE.Vector3(...point)};
		}
		
		this.points.push(point);

		// sphere
		let sphere = new THREE.Sprite(this.MeasuringTool.activeMeasurement == this ? this.materialRed : this.materialBlue)
		
		const _camera = this.viewer.scene.getActiveCamera();
		
		if (_camera.isPerspectiveCamera) {
			sphere.scale.set(20 / 1000, 20 / 1000, 1)
		} else {
			sphere.scale.set(20 / 1000 * _camera.zoom, 20 / 1000 * _camera.zoom, 1)
		}
		this.add(sphere);
		this.spheres.push(sphere);

		{ // edges
			let lineGeometry = new LineGeometry();
			lineGeometry.setPositions( [
					0, 0, 0,
					0, 0, 0,
			]);

			let lineMaterial = new LineMaterial({
				color: 0x2e82ff, 
				linewidth: 2, 
				resolution:  new THREE.Vector2(1000, 1000),
			});

			lineMaterial.depthTest = false;

			let edge = new Line2(lineGeometry, lineMaterial);
			edge.visible = true;

			this.add(edge);
			this.edges.push(edge);
		}

		{ // edge labels
			let edgeLabel = new TextSprite('', this.viewer);
			this.edgeLabels.push(edgeLabel);
			this.add(edgeLabel);
		}

		{ // coordinate labels
			let coordinateLabel = new TextSprite('', this.viewer);
			this.coordinateLabels.push(coordinateLabel);
			this.add(coordinateLabel);
		}

		{ // angle labels
			let angleLabel = new TextSprite('', this.viewer);
			this.angleLabels.push(angleLabel);
			this.add(angleLabel);
		}

		let lineGeometry = new LineGeometry();
		lineGeometry.setPositions( [
				point.position.x, point.position.y, point.position.z,
				point.position.x, point.position.y, point.position.z,
		]);

		let lineMaterial = new LineMaterial({
			color: 0x2e82ff, 
			linewidth: 2, 
			resolution:  new THREE.Vector2(1000, 1000),
		});

		lineMaterial.depthTest = false;
		//点占位元素，用于cameraControls.fitToSphere
		let placeholder = new Line2(lineGeometry, lineMaterial);
		placeholder.userData = {
			type: 'placeholder',
		}
		this.add(placeholder);

		{ // Event Listeners
			let drag = (e) => {
				let I = Utils.getMousePointCloudIntersection(
					e.drag.end, 
					e.viewer.scene.getActiveCamera(), 
					e.viewer, 
					e.viewer.scene.pointclouds,
					{pickClipped: true});

				if (I) {
					let i = this.spheres.indexOf(e.drag.object);
					if (i !== -1) {
						let point = this.points[i];
						
						// loop through current keys and cleanup ones that will be orphaned
						for (let key of Object.keys(point)) {
							if (!I.point[key]) {
								delete point[key];
							}
						}

						for (let key of Object.keys(I.point).filter(e => e !== 'position')) {
							point[key] = I.point[key];
						}
						this.setPosition(i, I.location);
						placeholder.geometry.setPositions([
							I.location.x,
							I.location.y,
							I.location.z,
							I.location.x,
							I.location.y,
							I.location.z,
						]);
					}
				}
			};

			let drop = e => {
				drag(e);
				let i = this.spheres.indexOf(e.drag.object);
				if (i !== -1) {
					this.dispatchEvent({
						'type': 'marker_dropped',
						'measurement': this,
						'index': i
					});
					if (this.name == 'point') {
						this.coordinateLabels[0].setVisible(true);
						this.dispatchEvent({
							'type': 'measure_finished',
							'measurement': this,
						});
					}
				}
			};

			// let mouseover = (e) => e.object.material.emissive.setHex(0x888888);
			// let mouseleave = (e) => e.object.material.emissive.setHex(0x000000);

			let setActive = () => {
				this.MeasuringTool.setActiveMeasurement(this);
				this.viewer.scene.dispatchEvent({
					type: 'measurement_selected',
					measurement: this,
				});
			}

			sphere.addEventListener('drag', drag);
			sphere.addEventListener('drop', drop);
			sphere.addEventListener('active', setActive)
			// sphere.addEventListener('mouseover', mouseover);
			// sphere.addEventListener('mouseleave', mouseleave);
		}

		let event = {
			type: 'marker_added',
			measurement: this,
			sphere: sphere
		};
		this.dispatchEvent(event);

		this.setMarker(this.points.length - 1, point);
	};

	removeMarker (index) {
		this.points.splice(index, 1);

		this.remove(this.spheres[index]);

		let edgeIndex = (index === 0) ? 0 : (index - 1);
		this.remove(this.edges[edgeIndex]);
		this.edges.splice(edgeIndex, 1);

		this.remove(this.edgeLabels[edgeIndex]);
		this.edgeLabels.splice(edgeIndex, 1);
		this.coordinateLabels.splice(index, 1);
		
		this.remove(this.angleLabels[index]);
		this.angleLabels.splice(index, 1);

		this.spheres.splice(index, 1);

		this.update();

		this.dispatchEvent({type: 'marker_removed', measurement: this});
	};

	setMarker (index, point) {
		this.points[index] = point;

		let event = {
			type: 'marker_moved',
			measure:	this,
			index:	index,
			position: point.position.clone()
		};
		this.dispatchEvent(event);

		this.update();
	}

	setPosition (index, position) {
		let point = this.points[index];
		point.position.copy(position);

		let event = {
			type: 'marker_moved',
			measure:	this,
			index:	index,
			position: position.clone()
		};
		this.dispatchEvent(event);

		this.update();
	};

	getArea () {
		let area = 0;
		let j = this.points.length - 1;

		for (let i = 0; i < this.points.length; i++) {
			let p1 = this.points[i].position;
			let p2 = this.points[j].position;
			area += (p2.x + p1.x) * (p1.y - p2.y);
			j = i;
		}

		return Math.abs(area / 2);
	};

	getTotalDistance () {
		if (this.points.length === 0) {
			return 0;
		}

		let distance = 0;

		for (let i = 1; i < this.points.length; i++) {
			let prev = this.points[i - 1].position;
			let curr = this.points[i].position;
			let d = prev.distanceTo(curr);

			distance += d;
		}

		if (this.closed && this.points.length > 1) {
			let first = this.points[0].position;
			let last = this.points[this.points.length - 1].position;
			let d = last.distanceTo(first);

			distance += d;
		}

		return distance;
	}

	getAngleBetweenLines (cornerPoint, point1, point2) {
		let v1 = new THREE.Vector3().subVectors(point1.position, cornerPoint.position);
		let v2 = new THREE.Vector3().subVectors(point2.position, cornerPoint.position);

		// avoid the error printed by threejs if denominator is 0
		const denominator = Math.sqrt( v1.lengthSq() * v2.lengthSq() );
		if(denominator === 0){
			return 0;
		}else{
			return v1.angleTo(v2);
		}
	};

	getAngle (index) {
		if (this.points.length < 3 || index >= this.points.length) {
			return 0;
		}

		let previous = (index === 0) ? this.points[this.points.length - 1] : this.points[index - 1];
		let point = this.points[index];
		let next = this.points[(index + 1) % (this.points.length)];

		return this.getAngleBetweenLines(point, previous, next);
	}

	// updateAzimuth(){
	// 	// if(this.points.length !== 2){
	// 	// 	return;
	// 	// }

	// 	// const azimuth = this.azimuth;

	// 	// const [p0, p1] = this.points;

	// 	// const r = p0.position.distanceTo(p1.position);
		
	// }

	update () {
		this.updateMarkers()
		if (this.points.length === 0) {
			return;
		} else if (this.points.length === 1) {
			let point = this.points[0];
			let position = point.position;
			this.spheres[0].position.copy(position);

			{ // coordinate labels
				let coordinateLabel = this.coordinateLabels[0];

				if (!!coordinateLabel) {
					let msg = position.toArray().map(p => Utils.addCommas(p.toFixed(2))).join(" / ");
					coordinateLabel.setText(msg);
					coordinateLabel.position.copy(position);
				}
			}

			return;
		}

		let lastIndex = this.points.length - 1;

		let centroid = new THREE.Vector3();
		for (let i = 0; i <= lastIndex; i++) {
			let point = this.points[i];
			centroid.add(point.position);
		}
		centroid.divideScalar(this.points.length);

		for (let i = 0; i <= lastIndex; i++) {
			let index = i;
			let nextIndex = (i + 1 > lastIndex) ? 0 : i + 1;
			let previousIndex = (i === 0) ? lastIndex : i - 1;

			let point = this.points[index];
			let nextPoint = this.points[nextIndex];
			let previousPoint = this.points[previousIndex];

			let sphere = this.spheres[index];

			// spheres
			sphere.position.copy(point.position);
			// sphere.material.color = this.color;

			{ // edges
				let edge = this.edges[index];

				edge.material.color = this.MeasuringTool.activeMeasurement == this ? new THREE.Color(0xff0000) : new THREE.Color(0x2e82ff);

				edge.position.copy(point.position);

				edge.geometry.setPositions([
					0, 0, 0,
					...nextPoint.position.clone().sub(point.position).toArray(),
				]);

				edge.geometry.verticesNeedUpdate = true;
				edge.geometry.computeBoundingSphere();
				edge.computeLineDistances();
				edge.visible = index < lastIndex || this.closed;
				
				if(!this.showEdges){
					edge.visible = false;
				}
			}

			{ // edge labels
				let edgeLabel = this.edgeLabels[i];

				let center = new THREE.Vector3().add(point.position);
				center.add(nextPoint.position);
				center = center.multiplyScalar(0.5);
				let distance = point.position.distanceTo(nextPoint.position);

				edgeLabel.position.copy(center);

				let suffix = "";
				if(this.lengthUnit != null && this.lengthUnitDisplay != null){
					distance = distance / this.lengthUnit.unitspermeter * this.lengthUnitDisplay.unitspermeter;  //convert to meters then to the display unit
					suffix = this.lengthUnitDisplay.code;
				}

				let txtLength = Utils.addCommas(distance.toFixed(2));
				edgeLabel.setText(`${txtLength} ${suffix}`);
				edgeLabel.setVisible(this.showDistances && (index < lastIndex) && distance > 0 && this.points.length >= 2)
				// edgeLabel.visible = this.showDistances && (index < lastIndex)
				// edgeLabel.visible = this.showDistances && (index < lastIndex || this.closed) && this.points.length >= 2 && distance > 0;
			}

			{ // angle labels
				let angleLabel = this.angleLabels[i];
				let angle = this.getAngleBetweenLines(point, previousPoint, nextPoint);

				let dir = nextPoint.position.clone().sub(previousPoint.position);
				dir.multiplyScalar(0.5);
				dir = previousPoint.position.clone().add(dir).sub(point.position).normalize();

				let dist = Math.min(point.position.distanceTo(previousPoint.position), point.position.distanceTo(nextPoint.position));
				dist = dist / 9;

				let labelPos = point.position.clone().add(dir.multiplyScalar(dist));
				angleLabel.position.copy(labelPos);

				let msg = Utils.addCommas((angle * (180.0 / Math.PI)).toFixed(1)) + '\u00B0';
				angleLabel.setText(msg);
				// angleLabel.visible = this.showAngles && (index <= lastIndex)
				angleLabel.setVisible(this.showAngles && (index <= lastIndex) && this.points.length >= 3 && angle > 0)
				// angleLabel.visible = this.showAngles && (index < lastIndex || this.closed) && this.points.length >= 3 && angle > 0;
			}
		}

		{ // update height stuff
			let heightEdge = this.heightEdge;
			heightEdge.visible = this.showHeight;
			this.heightLabel.visible = this.showHeight;

			if (this.showHeight) {
				let sorted = this.points.slice().sort((a, b) => a.position.z - b.position.z);
				let lowPoint = sorted[0].position.clone();
				let highPoint = sorted[sorted.length - 1].position.clone();
				let min = lowPoint.z;
				let max = highPoint.z;
				let height = max - min;

				let start = new THREE.Vector3(highPoint.x, highPoint.y, min);
				let end = new THREE.Vector3(highPoint.x, highPoint.y, max);

				heightEdge.position.copy(lowPoint);

				heightEdge.geometry.setPositions([
					0, 0, 0,
					...start.clone().sub(lowPoint).toArray(),
					...start.clone().sub(lowPoint).toArray(),
					...end.clone().sub(lowPoint).toArray(),
				]);
				heightEdge.material.color = this.MeasuringTool.activeMeasurement == this ? new THREE.Color(0xff0000) : new THREE.Color(0x2e82ff);

				heightEdge.geometry.verticesNeedUpdate = true;
				// heightEdge.geometry.computeLineDistances();
				// heightEdge.geometry.lineDistancesNeedUpdate = true;
				heightEdge.geometry.computeBoundingSphere();
				heightEdge.computeLineDistances();

				// heightEdge.material.dashSize = height / 40;
				// heightEdge.material.gapSize = height / 40;

				let heightLabelPosition = start.clone().add(end).multiplyScalar(0.5);
				this.heightLabel.position.copy(heightLabelPosition);

				let suffix = "";
				if(this.lengthUnit != null && this.lengthUnitDisplay != null){
					height = height / this.lengthUnit.unitspermeter * this.lengthUnitDisplay.unitspermeter;  //convert to meters then to the display unit
					suffix = this.lengthUnitDisplay.code;
				}

				let txtHeight = Utils.addCommas(height.toFixed(2));
				let msg = `${txtHeight} ${suffix}`;
				this.heightLabel.setText(msg);
			}
		}

		{ // update circle stuff
			const circleRadiusLabel = this.circleRadiusLabel;
			const circleRadiusLine = this.circleRadiusLine;
			const circleLine = this.circleLine;
			const circleCenter = this.circleCenter;

			const circleOkay = this.points.length === 3;

			circleRadiusLabel.visible = this.showCircle && circleOkay;
			circleRadiusLine.visible = this.showCircle && circleOkay;
			circleLine.visible = this.showCircle && circleOkay;
			circleCenter.visible = this.showCircle && circleOkay;

			if(this.showCircle && circleOkay){

				const A = this.points[0].position;
				const B = this.points[1].position;
				const C = this.points[2].position;
				const AB = B.clone().sub(A);
				const AC = C.clone().sub(A);
				const N = AC.clone().cross(AB).normalize();

				const center = Potree.Utils.computeCircleCenter(A, B, C);
				const radius = center.distanceTo(A);


				const scale = radius / 20;
				circleCenter.position.copy(center);
				circleCenter.scale.set(scale, scale, scale);

				//circleRadiusLine.geometry.vertices[0].set(0, 0, 0);
				//circleRadiusLine.geometry.vertices[1].copy(B.clone().sub(center));

				circleRadiusLine.geometry.setPositions( [
					0, 0, 0,
					...B.clone().sub(center).toArray()
				] );

				circleRadiusLine.geometry.verticesNeedUpdate = true;
				circleRadiusLine.geometry.computeBoundingSphere();
				circleRadiusLine.position.copy(center);
				circleRadiusLine.computeLineDistances();

				const target = center.clone().add(N);
				circleLine.position.copy(center);
				circleLine.scale.set(radius, radius, radius);
				circleLine.lookAt(target);
				
				circleRadiusLabel.visible = true;
				circleRadiusLabel.position.copy(center.clone().add(B).multiplyScalar(0.5));
				circleRadiusLabel.setText(`${radius.toFixed(3)}`);

			}
		}

		{ // update area label
			this.areaLabel.position.copy(centroid);
			this.areaLabel.visible = this.showArea && this.points.length >= 3;
			let area = this.getArea();

			let suffix = "";
			if(this.lengthUnit != null && this.lengthUnitDisplay != null){
				area = area / Math.pow(this.lengthUnit.unitspermeter, 2) * Math.pow(this.lengthUnitDisplay.unitspermeter, 2);  //convert to square meters then to the square display unit
				suffix = this.lengthUnitDisplay.code;
			}

			let txtArea = Utils.addCommas(area.toFixed(1));
			let msg =  `${txtArea} ${suffix}\u00B2`;
			this.areaLabel.setText(msg);
		}

		// this.updateAzimuth();
	};

	raycast (raycaster, intersects) {
		for (let i = 0; i < this.points.length; i++) {
			let sphere = this.spheres[i];

			sphere.raycast(raycaster, intersects);
		}

		// recalculate distances because they are not necessarely correct
		// for scaled objects.
		// see https://github.com/mrdoob/three.js/issues/5827
		// TODO: remove this once the bug has been fixed
		for (let i = 0; i < intersects.length; i++) {
			let I = intersects[i];
			I.distance = raycaster.ray.origin.distanceTo(I.point);
		}
		intersects.sort(function (a, b) { return a.distance - b.distance; });
	};

	get showCoordinates () {
		return this._showCoordinates;
	}

	set showCoordinates (value) {
		this._showCoordinates = value;
		this.update();
	}

	get showAngles () {
		return this._showAngles;
	}

	set showAngles (value) {
		this._showAngles = value;
		this.update();
	}

	get showCircle () {
		return this._showCircle;
	}

	set showCircle (value) {
		this._showCircle = value;
		this.update();
	}

	get showAzimuth(){
		return this._showAzimuth;
	}

	set showAzimuth(value){
		this._showAzimuth = value;
		this.update();
	}

	get showEdges () {
		return this._showEdges;
	}

	set showEdges (value) {
		this._showEdges = value;
		this.update();
	}

	get showHeight () {
		return this._showHeight;
	}

	set showHeight (value) {
		this._showHeight = value;
		this.update();
	}

	get showArea () {
		return this._showArea;
	}

	set showArea (value) {
		this._showArea = value;
		this.update();
	}

	get closed () {
		return this._closed;
	}

	set closed (value) {
		this._closed = value;
		this.update();
	}

	get showDistances () {
		return this._showDistances;
	}

	set showDistances (value) {
		this._showDistances = value;
		this.update();
	}

}
