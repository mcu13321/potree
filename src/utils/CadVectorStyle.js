// Split CAD dash patterns in source units before batching by resolved color.
export function buildStyledSegments(paths, visibleLayerNames = null) {
	// Normalize names consistently for styled lines and source annotations.
	const visible = visibleLayerNames == null ? null : new Set(visibleLayerNames.map(name => name.trim().toUpperCase()));
	const batches = new Map();
	for (const path of paths) {
		if (visible && !visible.has(String(path.layer ?? "").trim().toUpperCase())) continue;
		const color = path.style?.color ?? "#ffffff";
		if (!batches.has(color)) batches.set(color, []);
		const segments = batches.get(color);
		const points = path.points.map(point => point.position ?? point);
		if (path.closed && points.length > 2 && points[0].distanceToSquared(points.at(-1)) > Number.EPSILON) points.push(points[0]);
		const rawPattern = path.style?.pattern ?? [];
		const period = rawPattern.reduce((sum, value) => sum + Math.abs(value), 0);
		const pattern = period > 0 ? rawPattern.map(value => value === 0 ? period * 0.001 : value) : [];
		let patternIndex = 0;
		let remaining = Math.abs(pattern[0] ?? 0);
		for (let index = 1; index < points.length; index++) {
			const start = points[index - 1], end = points[index];
			const length = start.distanceTo(end);
			if (!pattern.length) {
				segments.push(...start.toArray(), ...end.toArray());
				continue;
			}
			let distance = 0;
			while (distance < length - 1e-10) {
				const step = Math.min(remaining, length - distance);
				if (pattern[patternIndex] >= 0) {
					segments.push(...start.clone().lerp(end, distance / length).toArray(), ...start.clone().lerp(end, (distance + step) / length).toArray());
				}
				distance += step;
				remaining -= step;
				if (remaining <= 1e-10) {
					patternIndex = (patternIndex + 1) % pattern.length;
					remaining = Math.abs(pattern[patternIndex]);
				}
			}
		}
	}
	return batches;
}
