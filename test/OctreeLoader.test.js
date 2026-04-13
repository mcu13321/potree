import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OctreeLoader } from "../src/modules/loader/2.0/OctreeLoader.js";

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
		fetch
			.mockResolvedValueOnce(createJsonResponse(createMetadata()))
			.mockResolvedValueOnce(createBufferResponse(createHierarchyBuffer()))
			.mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: "Service Unavailable",
				arrayBuffer: vi.fn(),
			});

		await expect(OctreeLoader.load("/pc/metadata.json")).rejects.toThrow("octree.bin");
		expect(globalThis.Potree.numNodesLoading).toBe(0);
		expect(worker.postMessage).not.toHaveBeenCalled();
	});
});
