import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {
	DEFAULT_XRAY_RENDER_SETTINGS,
	normalizeXrayRenderSettings,
} from "../src/viewer/XrayRenderSettings.js";

let Viewer;

function createViewerSettingsHarness(){
	const viewer = Object.create(Viewer.prototype);
	viewer._xrayRenderSettings = Object.freeze({...DEFAULT_XRAY_RENDER_SETTINGS});
	viewer.dispatchEvent = vi.fn();
	return viewer;
}

describe("X-ray render settings", () => {
	beforeAll(async () => {
		// Viewer imports the map module, which expects the host to provide proj4 globally.
		vi.stubGlobal("proj4", {defs: vi.fn()});
		({Viewer} = await import("../src/viewer/viewer.js"));
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	it("normalizes partial values and preserves invalid fields", () => {
		const settings = normalizeXrayRenderSettings({
			densityScale: -2,
			maxOpacity: 2,
			frontDetailStrength: -1,
			colorGamma: Number.NaN,
		});

		expect(settings).toEqual({
			densityScale: 0,
			maxOpacity: 1,
			frontDetailStrength: 0,
			colorGamma: 0.55,
		});
	});

	it("updates the configuration through the object API and emits one event", () => {
		const viewer = createViewerSettingsHarness();

		viewer.setXrayRenderSettings({densityScale: 3, colorGamma: 0.4});

		expect(viewer.getXrayRenderSettings()).toEqual({
			densityScale: 3,
			maxOpacity: 0.85,
			frontDetailStrength: 0.35,
			colorGamma: 0.4,
		});
		expect(viewer.dispatchEvent).toHaveBeenCalledTimes(1);
		expect(viewer.dispatchEvent.mock.calls[0][0].type).toBe("xray_render_settings_changed");
	});

	it("keeps legacy scalar properties as validated aliases", () => {
		const viewer = createViewerSettingsHarness();

		viewer.xrayDensityScale = 4;
		viewer.xrayMaxOpacity = 4;
		viewer.xrayFrontDetailStrength = 0.25;
		viewer.xrayColorGamma = 0;

		expect(viewer.xrayDensityScale).toBe(4);
		expect(viewer.xrayMaxOpacity).toBe(1);
		expect(viewer.xrayFrontDetailStrength).toBe(0.25);
		expect(viewer.xrayColorGamma).toBe(0.1);
	});

	it("returns copies so callers cannot mutate the active settings silently", () => {
		const viewer = createViewerSettingsHarness();
		const settings = viewer.xrayRenderSettings;

		settings.densityScale = 99;

		expect(viewer.xrayDensityScale).toBe(2);
		expect(viewer.dispatchEvent).not.toHaveBeenCalled();
	});

	it("falls back to direct rendering once when offscreen X-ray is unsupported", () => {
		const viewer = Object.create(Viewer.prototype);
		const directRenderer = {name: "direct"};
		viewer.scene = {
			pointclouds: [{visible: true, userData: {xrayEnabled: true}}],
		};
		viewer.isEDLSupported = vi.fn(() => true);
		viewer.isXraySplatPipelineSupported = vi.fn(() => false);
		viewer.useHQ = true;
		viewer.hqRenderer = {name: "hq"};
		viewer.edlRenderer = {name: "edl"};
		viewer.potreeRenderer = directRenderer;
		viewer._didWarnXrayPipelineFallback = false;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(viewer.getPRenderer()).toBe(directRenderer);
		expect(viewer.getPRenderer()).toBe(directRenderer);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("routes supported X-ray rendering through the HQ renderer", () => {
		const viewer = Object.create(Viewer.prototype);
		const hqRenderer = {name: "hq"};
		viewer.scene = {
			pointclouds: [{visible: true, userData: {xrayEnabled: true}}],
		};
		viewer.isEDLSupported = vi.fn(() => true);
		viewer.isXraySplatPipelineSupported = vi.fn(() => true);
		viewer.useHQ = false;
		viewer.hqRenderer = hqRenderer;
		viewer.edlRenderer = {name: "edl"};
		viewer.potreeRenderer = {name: "direct"};
		viewer._didWarnXrayPipelineFallback = false;

		expect(viewer.getPRenderer()).toBe(hqRenderer);
	});
});
