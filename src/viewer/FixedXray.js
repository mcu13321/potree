import * as THREE from "../../libs/three.js/build/three.module.js";
import {getPointCloudLabelAppearance, isPointCloudRuntimeHidden} from "../utils/PointCloudLabelAppearance.js";
import {getPointcloudEffectState} from "./PointcloudEffectUtils.js";
import {chooseXrayCut, shareXrayBudget, spreadXrayPoints, XrayFrameRate, xrayPointOrder} from "./FixedXraySampling.js";

const INITIAL_POINTS = 1_000_000;
const MAX_POINTS = 3_000_000;
// The XRay queue has its own limit across Viewer instances sharing this bundle.
const MAX_XRAY_REQUESTS = 3;
let activeXrayRequests = 0;
const BASE_EXPOSURE = Object.freeze({densityScale: 1.8, maxOpacity: 0.78, frontDetailStrength: 0.35, colorGamma: 0.55});
const recordCount = records => records.reduce((sum, record) => sum + record.count, 0);

/** Own compact rendering buffers independently of the native octree's LRU and pick nodes. */
function copyRecord(node, count, sourceGeometry = node.geometry){
	const positions = sourceGeometry?.getAttribute("position");
	if(!positions || positions.count !== node.numPoints) throw new Error(`Incomplete XRay node ${node.name}`);
	const seed = [...node.name].reduce((value, digit) => Math.imul(value, 31) + digit.charCodeAt(0), 0);
	const order = xrayPointOrder(node.numPoints, count, seed);
	const geometry = new THREE.BufferGeometry();
	for(const [name, source] of Object.entries(sourceGeometry.attributes)){
		const {array, itemSize, normalized} = source;
		const compact = new array.constructor(count * itemSize);
		for(let index = 0; index < count; index++){
			const offset = order[index] * itemSize;
			for(let component = 0; component < itemSize; component++){
				compact[index * itemSize + component] = array[offset + component];
			}
		}
		geometry.setAttribute(name, new THREE.BufferAttribute(compact, itemSize, normalized));
	}
	return {
		source: node, capacity: count, count, geometry, drawCount: count, name: node.name,
		geometryNode: {geometry, estimatedSpacing: node.estimatedSpacing ?? node.spacing},
		sceneNode: {matrixWorld: new THREE.Matrix4()},
		getLevel: () => node.level, getBoundingBox: () => node.boundingBox,
	};
}

function disposeRecords(records){
	for(const record of records) record.geometry.dispose();
}

function createBatch(nodes, limit){
	const counts = spreadXrayPoints(nodes.map(node => node.numPoints), limit);
	const tasks = nodes.flatMap((node, index) => counts[index] ? [{node, count: counts[index], record: null}] : []);
	return {tasks, records: [], next: 0, complete: 0};
}

/** Borrow resident positions without reordering the native cache or waiting on its requests. */
function findResidentGeometry(root, node){
	let native = root;
	for(let index = 1; native && index < node.name.length; index++){
		native = native.children[node.name[index]];
	}
	const geometry = native?.loaded ? native.geometry : null;
	return geometry?.getAttribute("position")?.count === node.numPoints ? geometry : null;
}

function smoothstep(value){
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

/** Estimate near-view exposure from evenly spaced samples of the displayed points. */
function viewWeight(states, draws, count, camera){
	if(!count) return 0;
	const stride = Math.max(1, Math.ceil(count / 12_000));
	const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
	const bounds = new THREE.Box3();
	const point = new THREE.Vector3();
	const clip = new THREE.Vector4();
	const depths = [];
	let index = 0;
	for(const state of states){
		bounds.union(state.cloud.boundingBox.clone().applyMatrix4(state.cloud.matrixWorld));
		for(const record of draws.get(state.cloud)){
			const positions = record.geometry.getAttribute("position");
			for(let i = (stride - index % stride) % stride; i < record.drawCount; i += stride){
				point.fromBufferAttribute(positions, i).applyMatrix4(record.sceneNode.matrixWorld);
				clip.set(point.x, point.y, point.z, 1).applyMatrix4(viewProjection);
				if(clip.w <= 0 || Math.abs(clip.x) > 0.8 * clip.w || Math.abs(clip.y) > 0.8 * clip.w || Math.abs(clip.z) > clip.w) continue;
				depths.push(-point.applyMatrix4(camera.matrixWorldInverse).z);
			}
			index += record.drawCount;
		}
	}
	const span = bounds.getSize(point).length();
	if(!depths.length || !span) return 0;
	depths.sort((a, b) => a - b);
	const median = depths[Math.floor((depths.length - 1) / 2)];
	return smoothstep((0.53 - median / span) / 0.39) * smoothstep(depths.length / Math.min(96, Math.ceil(count / stride)));
}

export class FixedXray{
	constructor(viewer){
		this.viewer = viewer;
		this.states = new Map();
		this.fps = new XrayFrameRate();
		this.keep = 100;
		this.exposure = 0;
		this.nextExposure = 0;
		this.lastMeasure = -Infinity;
		this.supported = false;
		this.failedClouds = new WeakSet();
	}

	pause(){
		// A resumed iframe must establish new FPS windows before resizing its point set.
		this.fps.reset();
		this.lastExposureFrame = undefined;
	}

	release(state){
		state.abort.abort();
		state.cloud.removeEventListener("dispose", state.dispose);
		if(state.preview) state.preview.geometry.dispose();
		disposeRecords(state.records);
		disposeRecords(state.initial?.records ?? []);
		if(state.detail && !state.detail.started) disposeRecords(state.detail.records);
		this.states.delete(state.cloud);
		this.membersChanged = true;
	}

	clear(){
		for(const state of this.states.values()) this.release(state);
		this.supported = false;
		this.keep = 100;
		this.exposure = this.nextExposure = 0;
		this.lastMeasure = -Infinity;
		this.pause();
	}

	updateMembership(){
		const clouds = this.viewer.scene.pointclouds.filter(cloud => cloud.visible && !isPointCloudRuntimeHidden(cloud) &&
			getPointcloudEffectState(cloud).xrayEnabled);
		const available = clouds.length > 0 && this.viewer.isXraySplatPipelineSupported() && clouds.every(cloud =>
			cloud.pcoGeometry?.root && cloud.pcoGeometry.loader?.loadFixedHierarchy &&
			cloud.pcoGeometry.loader?.loadFixedGeometry &&
			Math.floor(cloud.pcoGeometry.loader.metadata?.points) > 0 && !getPointCloudLabelAppearance(cloud));
		if(!available || clouds.some(cloud => this.failedClouds.has(cloud))){
			if(!clouds.length) this.failedClouds = new WeakSet();
			if(this.states.size) this.clear();
			return false;
		}
		this.supported = true;
		for(const state of this.states.values()){
			if(!clouds.includes(state.cloud)) this.release(state);
		}
		for(const cloud of clouds){
			if(this.states.has(cloud)) continue;
			const state = {cloud, abort: new AbortController(), records: [], ready: false, level: -1, revision: 0};
			state.dispose = () => this.release(state);
			cloud.addEventListener("dispose", state.dispose);
			this.states.set(cloud, state);
			this.membersChanged = true;
		}
		if(this.membersChanged){
			const totals = clouds.map(cloud => cloud.pcoGeometry.loader.metadata.points);
			const targets = shareXrayBudget(totals, INITIAL_POINTS);
			const ceilings = shareXrayBudget(totals, MAX_POINTS);
			clouds.forEach((cloud, index) => {
				const state = this.states.get(cloud);
				if(state.target === targets[index] && state.ceiling === ceilings[index]) return;
				state.target = targets[index];
				state.ceiling = ceilings[index];
				if(state.initial) disposeRecords(state.initial.records);
				if(state.detail && !state.detail.started) disposeRecords(state.detail.records);
				state.initial = state.detail = null;
				state.needsPlan = true;
				state.detailBlocked = false;
				state.revision++;
			});
			this.membersChanged = false;
			this.lastMeasure = -Infinity;
			this.pause();
		}
		return true;
	}

	prepare(state){
		if(!state.needsPlan) return;
		const root = state.cloud.pcoGeometry.root;
		if(!state.ready && !state.preview && root.geometry && root.numPoints && state.ceiling){
			state.preview = copyRecord(root, Math.min(root.numPoints, Math.max(1, state.target), state.ceiling));
			state.revision++;
		}
		if(!state.levels) return;
		const cut = chooseXrayCut(state.levels, state.target, state.ceiling);
		if(!cut) throw new Error("No drawable XRay level");
		state.needsPlan = false;
		// Read complete source nodes, then sample each region to the initial draw budget.
		const limit = Math.min(cut.points, state.target, state.ceiling);
		if(state.ready && state.cut?.level === cut.level && state.cut.strategy === cut.strategy &&
			state.cutLimit === limit && recordCount(state.records) <= state.ceiling) return;
		const selected = cut.strategy === "single" ? state.levels[cut.level] : state.levels.slice(0, cut.level + 1).flat();
		state.initial = createBatch(selected, limit);
		state.initial.cut = cut;
		state.initial.limit = limit;
	}

	failInitial(state, error){
		this.failedClouds.add(state.cloud);
		console.warn("Fixed XRay is using the native renderer:", error);
		this.clear();
	}

	startCatalog(state){
		this.catalogState = state;
		const {loader, root} = state.cloud.pcoGeometry;
		loader.loadFixedHierarchy(root, state.abort.signal).then(levels => {
			if(!state.abort.signal.aborted) state.levels = levels;
		}).catch(error => {
			if(!state.abort.signal.aborted) this.failInitial(state, error);
		}).finally(() => {
			this.catalogState = null;
		});
	}

	nextTask(states){
		// Round-robin across clouds so a slow source cannot hold back the other first frames.
		for(const key of ["initial", "detail"]){
			for(let attempt = 0; attempt < states.length; attempt++){
				const state = states[(this.nextCloud ?? 0) % states.length];
				this.nextCloud = ((this.nextCloud ?? 0) + 1) % states.length;
				const batch = state[key];
				if(batch && batch.next < batch.tasks.length) return {state, key, batch, task: batch.tasks[batch.next++]};
			}
		}
		return null;
	}

	async loadTask({state, key, batch, task}){
		const {node} = task;
		const {loader, root} = state.cloud.pcoGeometry;
		activeXrayRequests++;
		let ownedGeometry;
		try{
			const resident = findResidentGeometry(root, node);
			if(!resident) ownedGeometry = await loader.loadFixedGeometry(node, state.abort.signal);
			if(state.abort.signal.aborted || state[key] !== batch) return;
			task.record = copyRecord(node, task.count, resident ?? ownedGeometry);
			batch.records.push(task.record);
			batch.complete++;
			if(key === "initial" && !state.ready) state.revision++;
		}catch(error){
			if(state.abort.signal.aborted || state[key] !== batch) return;
			if(key === "initial") this.failInitial(state, error);
			else{
				disposeRecords(batch.records);
				state.detail = null;
				state.detailBlocked = true;
				console.warn("Fixed XRay kept the current points after a detail load failed:", error);
			}
		}finally{
			// Only the compact sample survives a successful private decode.
			ownedGeometry?.dispose();
			activeXrayRequests--;
		}
	}

	publishInitial(state){
		const batch = state.initial;
		if(!batch || batch.complete !== batch.tasks.length) return;
		disposeRecords(state.records);
		state.records = batch.tasks.map(task => task.record);
		if(state.preview) state.preview.geometry.dispose();
		state.preview = null;
		state.ready = true;
		state.cut = batch.cut;
		state.cutLimit = batch.limit;
		state.level = batch.cut.level;
		state.initial = null;
		state.revision++;
		this.lastMeasure = -Infinity;
		this.pause();
	}

	refine(states, timestamp){
		const current = states.reduce((sum, state) => sum + recordCount(state.records), 0);
		const remaining = Math.min(MAX_POINTS - current, Math.floor(current * 0.2));
		if(remaining <= 0) return;
		const available = states.map(state => {
			const room = state.ceiling - recordCount(state.records);
			if(room <= 0 || state.detailBlocked) return 0;
			if(state.detail) return state.detail.complete === state.detail.tasks.length ? state.detail.capacity - state.detail.published : 0;
			while(++state.level < state.levels.length){
				const nodes = state.levels[state.level];
				if(!nodes.length) continue;
				if(Math.min(room, Math.floor(current * 0.2)) < nodes.length){
					state.detailBlocked = true;
					return 0;
				}
				const batch = createBatch(nodes, room);
				batch.capacity = batch.tasks.reduce((sum, task) => sum + task.count, 0);
				batch.published = 0;
				batch.started = false;
				state.detail = batch;
				return 0;
			}
			state.detailBlocked = true;
			return 0;
		});
		// Publish a shared increment only when all participating clouds have prepared their samples.
		if(states.some(state => state.detail && state.detail.complete !== state.detail.tasks.length)) return;
		const shares = shareXrayBudget(available, remaining);
		let changed = false;
		states.forEach((state, index) => {
			const share = shares[index];
			const batch = state.detail;
			if(!share || !batch) return;
			// A level enters the image only when each node can contribute to the same increment.
			if(!batch.started && share < batch.tasks.length) return;
			batch.published += share;
			const records = batch.tasks.map(task => task.record);
			const counts = spreadXrayPoints(records.map(record => record.capacity), batch.published);
			records.forEach((record, number) => { record.count = counts[number]; });
			if(!batch.started) state.records.push(...records);
			batch.started = true;
			if(batch.published === batch.capacity) state.detail = null;
			state.revision++;
			changed = true;
		});
		if(changed){
			this.fps.changed(timestamp);
			this.lastMeasure = -Infinity;
		}
	}

	update(timestamp){
		if(typeof document !== "undefined" && document.hidden){
			this.pause();
			return;
		}
		if(!this.updateMembership()) return;
		const states = [...this.states.values()];
		try{
			for(const state of states){
				this.prepare(state);
				this.publishInitial(state);
			}
		}catch(error){
			this.failInitial(states.find(state => state.needsPlan) ?? states[0], error);
			return;
		}
		const catalog = states.find(state => !state.levels);
		if(catalog && !this.catalogState) this.startCatalog(catalog);
		const ready = states.every(state => state.ready && !state.initial);
		if(ready){
			if(this.fps.low >= 2 && this.keep > 20){
				this.keep -= 20;
				this.fps.changed(timestamp, true);
			}else if(this.fps.high >= 2){
				if(this.keep < 100){
					this.keep += 20;
					this.fps.changed(timestamp);
				}else this.refine(states, timestamp);
			}
		}
		// The native queue continues to manage all of its slots independently.
		// Limit per-frame work even when every node can be copied from resident geometry.
		for(let scheduled = 0; scheduled < MAX_XRAY_REQUESTS && activeXrayRequests < MAX_XRAY_REQUESTS; scheduled++){
			const next = this.nextTask(states);
			if(!next) break;
			void this.loadTask(next);
		}
	}

	recordFrame(timestamp){
		if(this.supported && this.states.size && [...this.states.values()].every(state => state.ready && !state.initial) &&
			(typeof document === "undefined" || !document.hidden)) this.fps.record(timestamp);
	}

	frame(pointclouds, camera, offscreen){
		if(!this.supported || !pointclouds.length || pointclouds.some(cloud => !this.states.has(cloud))) return;
		const states = pointclouds.map(cloud => this.states.get(cloud));
		const nodes = new Map();
		let count = 0, reference = 0;
		for(const state of states){
			// Keep the selected prefixes stable across frames and rebuild them only when points change.
			if(state.snapshot?.revision !== state.revision || state.snapshot.keep !== this.keep){
				const records = state.ready ? state.records : state.initial?.tasks.map(task => task.record).filter(Boolean) ?? [];
				const preview = state.preview && !records.some(record => record.source === state.preview.source) ? [state.preview] : [];
				const active = [...preview, ...records].filter(record => record.count > 0);
				const total = Math.min(recordCount(active), state.ceiling);
				const retained = Math.min(total, Math.max(1, Math.floor(total * this.keep / 100)));
				const counts = spreadXrayPoints(active.map(record => record.count), retained);
				const drawable = active.filter((record, index) => {
					record.drawCount = counts[index];
					return record.drawCount > 0;
				});
				state.snapshot = {revision: state.revision, keep: this.keep, total, retained, drawable};
			}
			const {total, retained, drawable} = state.snapshot;
			reference += total;
			count += retained;
			const world = state.cloud.matrixWorld;
			const changed = !state.world?.equals(world);
			if(changed) state.world = world.clone();
			for(const record of drawable){
				if(!record.cloudWorld?.equals(world)){
					const min = record.source.boundingBox.min;
					record.sceneNode.matrixWorld.makeTranslation(min.x, min.y, min.z).premultiply(world);
					record.cloudWorld = state.world;
				}
			}
			nodes.set(state.cloud, drawable);
		}
		const now = performance.now();
		if(!offscreen && now - this.lastMeasure >= 100){
			this.nextExposure = viewWeight(states, nodes, count, camera);
			this.lastMeasure = now;
		}
		if(!offscreen){
			const delta = Math.min(120, now - (this.lastExposureFrame ?? now));
			this.lastExposureFrame = now;
			this.exposure += (this.nextExposure - this.exposure) * (1 - Math.exp(-delta / 240));
		}
		const gain = Math.min(1.6, Math.cbrt(reference / Math.max(1, count))) || 1;
		return {nodes, settings: {
			...BASE_EXPOSURE,
			densityScale: Math.min(7, (BASE_EXPOSURE.densityScale + 3.6 * this.exposure) * gain),
			maxOpacity: BASE_EXPOSURE.maxOpacity + 0.08 * this.exposure,
			colorGamma: BASE_EXPOSURE.colorGamma - 0.17 * this.exposure - 0.06 * (gain - 1),
		}};
	}
}
