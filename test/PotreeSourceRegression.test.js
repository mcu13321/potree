import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Potree source regression", () => {
	it("metadata 分支里应只保留一次 OctreeLoader.load 调用", () => {
		const source = readFileSync("src/Potree.js", "utf8");
		const metadataBranchStart = source.indexOf("} else if (path.endsWith('metadata.json')) {");
		const metadataBranchEnd = source.indexOf("} else if (path.indexOf('.vpc') > 0) {");
		// 直接截取 metadata 分支源码，防止后续回归时再次把 loader 调两遍。
		const metadataBranch = source.slice(metadataBranchStart, metadataBranchEnd);
		const loaderCalls = metadataBranch.match(/OctreeLoader\.load\(path, getUrl\)/g) ?? [];

		expect(loaderCalls).toHaveLength(1);
	});

	it("模块出口应只对外暴露 FJDCameraControls，不导出 Potree 适配器", () => {
		const source = readFileSync("src/Potree.js", "utf8");

		expect(source).toContain('export {FJDCameraControls} from "./FJDCameraControlsHost.js";');
		expect(source).not.toContain('export {FJDPotreeControlsAdapter} from "./viewer/FJDPotreeControlsAdapter.js";');
	});

	it("Potree 源码树里不应再保留 FJD controls 的旧副本", () => {
		// 独立包已经同步到 libs，下列旧源码路径应当彻底移除。
		expect(existsSync("src/navigation/FJDCameraControls.js")).toBe(false);
		expect(existsSync("src/navigation/FJDCameraControlsMath.js")).toBe(false);
		expect(existsSync("src/navigation/FJDCameraControlsTHREE.js")).toBe(false);
		expect(existsSync("src/modules/fjd-camera-controls-core")).toBe(false);
	});
});
