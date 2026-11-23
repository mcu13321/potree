import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, Vector3 } from "../libs/three.js/build/three.module.js";
import { NodeLoader, OctreeLoader } from "../src/modules/loader/2.0/OctreeLoader.js";

function createMetadata() {
	return {
		attributes: [{
			name: "position",
			description: "",
			size: 12,
			numElements: 3,
			elementSize: 4,
			type: "int32",
			min: [0, 0, 0],
			max: [1, 1, 1],
		}],
		scale: [1, 1, 1],
		offset: [0, 0, 0],
		spacing: 1,
		projection: "",
		boundingBox: {
			min: [0, 0, 0],
			max: [1, 1, 1],
		},
		hierarchy: {
			firstChunkSize: 22,
		},
		encoding: "DEFAULT",
	};
}

function createHierarchyBuffer(numPoints = 1, byteSize = 12n) {
	const buffer = new ArrayBuffer(22);
	const view = new DataView(buffer);

	view.setUint8(0, 0);
	view.setUint8(1, 0);
	view.setUint32(2, numPoints, true);
	view.setBigInt64(6, 0n, true);
	view.setBigInt64(14, byteSize, true);

	return buffer;
}

function createWorkerMessage() {
	return {
		data: {
			density: 1,
			attributeBuffers: {
				position: {
					buffer: new Float32Array([0, 0, 0]).buffer,
					attribute: {
						range: [[0, 0, 0], [1, 1, 1]],
					},
				},
			},
		},
	};
}

function createJsonResponse(data) {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		json: vi.fn(async () => data),
	};
}

function createBufferResponse(buffer) {
	return {
		ok: true,
		status: 206,
		statusText: "Partial Content",
		arrayBuffer: vi.fn(async () => buffer),
	};
}

describe("OctreeLoader", () => {
	let worker;
	let getWorker;
	let returnWorker;

	beforeEach(() => {
		worker = {
			postMessage: vi.fn(),
			terminate: vi.fn(),
			onmessage: null,
			onerror: null,
			onmessageerror: null,
		};
		getWorker = vi.fn(() => worker);
		returnWorker = vi.fn();

		// 为 loader 提供最小的 Potree 运行时依赖。
		globalThis.Potree = {
			numNodesLoading: 0,
			scriptPath: "/potree",
			workerPool: {
				getWorker,
				returnWorker,
			},
		};
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		delete globalThis.Potree;
		delete globalThis.fetch;
		vi.restoreAllMocks();
	});

	it("hydrates XRay proxies without altering the native hierarchy", async () => {
		const loader = new NodeLoader("/pc/metadata.json");
		loader.metadata = {...createMetadata(), points: 4, hierarchy: {firstChunkSize: 44}};
		const bounds = new Box3(new Vector3(), new Vector3(1, 1, 1));
		const root = {name: "r", level: 0, spacing: 1, nodeType: 2, children: {}, boundingBox: bounds,
			octreeGeometry: {}, hierarchyByteOffset: 0n, hierarchyByteSize: 44n};
		const hierarchy = new Uint8Array(66);
		hierarchy.set(new Uint8Array(createHierarchyBuffer(1)), 0);
		hierarchy.set(new Uint8Array(createHierarchyBuffer(3)), 44);
		// The root references a proxy in a second hierarchy page.
		hierarchy[1] = 1;
		hierarchy[22] = 2;
		const view = new DataView(hierarchy.buffer);
		view.setBigInt64(28, 44n, true);
		view.setBigInt64(36, 22n, true);
		fetch.mockResolvedValueOnce(createBufferResponse(hierarchy.buffer))
			.mockResolvedValueOnce(createBufferResponse(hierarchy.buffer.slice(0, 44)));
		const levels = await loader.loadFixedHierarchy(root, new AbortController().signal);
		expect(levels[1][0]).toMatchObject({name: "r0", nodeType: 0, numPoints: 3});
		expect(root).toMatchObject({nodeType: 2, children: {}});
		expect(Object.keys(root.children)).toHaveLength(0);
		await loader.loadHierarchy(root);
		expect(root.children[0].nodeType).toBe(2);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("rejects a whole-file XRay response without changing a concurrent native request", async () => {
		const loader = new NodeLoader("/pc/metadata.json");
		loader.metadata = createMetadata();
		const node = {name: "r0", nodeType: 0, byteOffset: 12n, byteSize: 12n, numPoints: 1,
			boundingBox: new Box3(new Vector3(), new Vector3(1, 1, 1)),
			octreeGeometry: {offset: new Vector3(), loader}};
		const cancel = vi.fn(async () => {});
		const arrayBuffer = vi.fn();
		const nativeResponse = {...createBufferResponse(new ArrayBuffer(12)), status: 200};
		fetch.mockResolvedValueOnce({ok: true, status: 200, body: {cancel}, arrayBuffer}).mockResolvedValueOnce(nativeResponse);
		const fixed = loader.loadFixedGeometry(node, new AbortController().signal);
		const rejectsWholeFile = expect(fixed).rejects.toThrow(/require HTTP byte ranges/);
		expect(node._loadPromise).toBeUndefined();
		expect(Potree.numNodesLoading).toBe(0);
		const native = loader.load(node);
		expect(Potree.numNodesLoading).toBe(1);
		await rejectsWholeFile;
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
		worker.onmessage(createWorkerMessage());
		expect(await native).toMatchObject({success: true});
		expect(node.loaded).toBe(true);
		expect(cancel).toHaveBeenCalledOnce();
		expect(arrayBuffer).not.toHaveBeenCalled();
		expect(nativeResponse.arrayBuffer).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(Potree.numNodesLoading).toBe(0);
	});

	it("cancels an active XRay decoder without publishing native geometry", async () => {
		const loader = new NodeLoader("/pc/metadata.json");
		loader.metadata = createMetadata();
		const node = {name: "r0", nodeType: 0, byteOffset: 0n, byteSize: 12n, numPoints: 1,
			boundingBox: new Box3(new Vector3(), new Vector3(1, 1, 1)),
			octreeGeometry: {offset: new Vector3(), loader}};
		fetch.mockResolvedValueOnce(createBufferResponse(new ArrayBuffer(12)));
		const controller = new AbortController();
		const pending = loader.loadFixedGeometry(node, controller.signal);
		const cancelled = expect(pending).rejects.toMatchObject({name: "AbortError"});
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
		controller.abort();
		await cancelled;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(returnWorker).not.toHaveBeenCalled();
		expect(node.geometry).toBeUndefined();
		expect(node.loading).toBeUndefined();
		expect(Potree.numNodesLoading).toBe(0);
	});

	it("releases a cancelled XRay request during HTTP backoff", async () => {
		vi.useFakeTimers();
		try{
			const loader = new NodeLoader("/pc/metadata.json");
			const node = {name: "r0", byteOffset: 0n, byteSize: 12n};
			const controller = new AbortController();
			fetch.mockResolvedValue({ok: false, status: 503});
			const cancelled = expect(loader.loadFixedGeometry(node, controller.signal)).rejects.toMatchObject({name: "AbortError"});
			await vi.advanceTimersByTimeAsync(0);
			expect(vi.getTimerCount()).toBe(1);
			controller.abort();
			await cancelled;
			expect(fetch).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		}finally{
			vi.useRealTimers();
		}
	});

	it("应等待根节点首包解码完成后再返回 geometry", async () => {
		fetch
			.mockResolvedValueOnce(createJsonResponse(createMetadata()))
			.mockResolvedValueOnce(createBufferResponse(createHierarchyBuffer()))
			.mockResolvedValueOnce(createBufferResponse(new ArrayBuffer(12)));

		let settled = false;
		const loadPromise = OctreeLoader.load("/pc/metadata.json");
		loadPromise.finally(() => {
			settled = true;
		});

		await vi.waitFor(() => {
			expect(worker.postMessage).toHaveBeenCalledTimes(1);
		});

		expect(settled).toBe(false);

		// 手动触发 worker 回包，模拟根节点首包解码完成。
		worker.onmessage(createWorkerMessage());

		const result = await loadPromise;

		expect(result.geometry.root.loaded).toBe(true);
		expect(returnWorker).toHaveBeenCalledTimes(1);
		expect(globalThis.Potree.numNodesLoading).toBe(0);
	});

	it("根节点首包请求失败时应 reject", async () => {
		// Keep every retry at HTTP 503 and advance the loader's backoff without waiting in real time.
		vi.useFakeTimers();
		try {
			fetch
				.mockResolvedValueOnce(createJsonResponse(createMetadata()))
				.mockResolvedValueOnce(createBufferResponse(createHierarchyBuffer()))
				.mockResolvedValue({
					ok: false,
					status: 503,
					statusText: "Service Unavailable",
					arrayBuffer: vi.fn(),
				});

			const rejection = expect(OctreeLoader.load("/pc/metadata.json")).rejects.toThrow(/octree\.bin: 503/);
			await vi.runAllTimersAsync();
			await rejection;
			expect(fetch).toHaveBeenCalledTimes(6);
			expect(globalThis.Potree.numNodesLoading).toBe(0);
			expect(worker.postMessage).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
