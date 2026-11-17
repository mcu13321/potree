import {afterEach, describe, expect, it, vi} from "vitest";
import {DeviceOrientationControls} from "../src/navigation/DeviceOrientationControls.js";

const controls = [];

/** Isolate global event ownership while exercising the real control implementation. */
function fixture(eventType) {
	const target = Object.assign(new EventTarget(), {orientation: 0});
	if (eventType) target[`on${eventType}`] = null;
	vi.stubGlobal("window", target);
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const create = () => {
		const control = new DeviceOrientationControls({renderer: {}});
		controls.push(control);
		return control;
	};
	return {target, create};
}

afterEach(() => {
	controls.splice(0).forEach(control => control.dispose());
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("device orientation listener ownership", () => {
	// Construction keeps the legacy automatic registration, including unsupported sensors.
	it.each(["deviceorientationabsolute", "deviceorientation", null])("detaches only the disposed control with sensor %s", eventType => {
		const {target, create} = fixture(eventType);
		const first = create(), second = create();
		const firstEvent = eventType ? new Event(eventType) : null;
		if (firstEvent) target.dispatchEvent(firstEvent);
		first.dispose();
		first.dispose();
		target.orientation = 90;
		target.dispatchEvent(new Event("orientationchange"));
		expect(first.screenOrientation).toBe(0);
		expect(second.screenOrientation).toBe(90);
		expect(first.disposed).toBe(true);
		expect(first.enabled).toBe(false);
		if (eventType) {
			const nextEvent = new Event(eventType);
			target.dispatchEvent(nextEvent);
			expect(first.deviceOrientation).toBe(firstEvent);
			expect(second.deviceOrientation).toBe(nextEvent);
		}
		second.dispose();
		target.orientation = 180;
		target.dispatchEvent(new Event("orientationchange"));
		expect(second.screenOrientation).toBe(90);
	});

	// Absolute orientation must keep precedence when both browser APIs exist.
	it("preserves absolute-event selection and unrelated host listeners", () => {
		const {target, create} = fixture("deviceorientationabsolute");
		target.ondeviceorientation = null;
		const hostListener = vi.fn();
		target.addEventListener("orientationchange", hostListener);
		const control = create();
		target.dispatchEvent(new Event("deviceorientation"));
		expect(control.deviceOrientation).toBeUndefined();
		const event = new Event("deviceorientationabsolute");
		target.dispatchEvent(event);
		expect(control.deviceOrientation).toBe(event);
		control.dispose();
		target.dispatchEvent(new Event("orientationchange"));
		expect(hostListener).toHaveBeenCalledOnce();
	});
});
