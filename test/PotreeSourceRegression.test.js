import { readFileSync } from "node:fs";
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
});
