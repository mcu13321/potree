import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

let Viewer;
const viewers = [];

/** Exercise real body subscriptions without creating a renderer or loading point clouds. */
function createViewer() {
	const viewer = Object.create(Viewer.prototype);
	viewers.push(viewer);
	viewer.initDragAndDrop();
	return viewer;
}

/** Supply the browser drag payload used by the existing default handlers. */
function dragEvent(type) {
	return Object.assign(new Event(type, {cancelable: true}), {
		dataTransfer: {items: [], dropEffect: "none"},
	});
}

beforeAll(async () => {
	vi.stubGlobal("proj4", {defs: vi.fn()});
	({Viewer} = await import("../src/viewer/viewer.js"));
});

beforeEach(() => {
	vi.stubGlobal("$", () => [document.body]);
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	viewers.splice(0).forEach(viewer => viewer.disposeDragAndDrop());
	vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

describe("Viewer drag-and-drop listener ownership", () => {
	// Existing drag behavior is unchanged until a host explicitly disposes the instance.
	it("releases every body subscription and supports repeated cleanup", () => {
		const viewer = createViewer();
		for (const type of ["dragenter", "dragover"]) {
			const event = dragEvent(type);
			document.body.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
			expect(event.dataTransfer.dropEffect).toBe("copy");
		}
		viewer.disposeDragAndDrop();
		viewer.disposeDragAndDrop();
		for (const type of ["dragenter", "dragover", "drop"]) {
			const event = dragEvent(type);
			document.body.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(console.log).not.toHaveBeenCalled();
	});

	// Replacing one Viewer cannot detach another Viewer or listeners owned by the embedding host.
	it("keeps the replacement and host listeners active after disposing the old Viewer", () => {
		const oldViewer = createViewer(), replacement = createViewer();
		const hostListener = vi.fn();
		document.body.addEventListener("drop", hostListener);
		try {
			oldViewer.disposeDragAndDrop();
			const event = dragEvent("drop");
			document.body.dispatchEvent(event);
			expect(console.log).toHaveBeenCalledOnce();
			expect(event.defaultPrevented).toBe(true);
			expect(hostListener).toHaveBeenCalledOnce();
			replacement.disposeDragAndDrop();
			const next = dragEvent("drop");
			document.body.dispatchEvent(next);
			expect(console.log).toHaveBeenCalledOnce();
			expect(next.defaultPrevented).toBe(false);
			expect(hostListener).toHaveBeenCalledTimes(2);
		} finally {
			document.body.removeEventListener("drop", hostListener);
		}
	});

	// Reinitialization must not accumulate callbacks that a later disposal cannot reach.
	it("replaces prior subscriptions on reinitialization", () => {
		const viewer = createViewer();
		viewer.initDragAndDrop();
		document.body.dispatchEvent(dragEvent("drop"));
		expect(console.log).toHaveBeenCalledOnce();
		viewer.disposeDragAndDrop();
		document.body.dispatchEvent(dragEvent("drop"));
		expect(console.log).toHaveBeenCalledOnce();
	});
});
