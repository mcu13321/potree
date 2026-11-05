import {vi} from "vitest";

// Deterministic font metrics exercise geometry without requiring a native canvas dependency.
export function mockCadTextCanvas() {
	const context = {font: "", fillStyle: "", textBaseline: "", fillText: vi.fn(),
		measureText: value => ({width: value.length * 64, actualBoundingBoxAscent: 96,
			actualBoundingBoxDescent: 16, actualBoundingBoxLeft: 0})};
	return {context, getContext: vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context)};
}
