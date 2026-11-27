/** Share a budget evenly, redistributing any capacity that small clouds cannot use. */
export function shareXrayBudget(pointTotals, budget){
	const shares = pointTotals.map(() => 0);
	const order = pointTotals.map((total, index) => ({total, index})).sort((a, b) => a.total - b.total);
	for(const [index, {total, index: originalIndex}] of order.entries()){
		const share = Math.min(total, Math.floor(budget / (order.length - index)));
		shares[originalIndex] = share;
		budget -= share;
	}
	return shares;
}

// Allow a small point deficit and account for the fixed cost of requesting and decoding a node.
const MIN_INITIAL_POINT_FRACTION = 0.8;
const NODE_COST_BYTES = 128 * 1024;

/** Prefer broad coverage and low load cost among cuts close enough to the initial point target. */
export function chooseXrayCut(levels, target, ceiling){
	const minimum = Math.min(target, ceiling) * MIN_INITIAL_POINT_FRACTION;
	let cumulativePoints = 0;
	let cumulativeNodes = 0;
	let cumulativeBytes = 0;
	let coverageCells;
	let preferred;
	let closest;
	let smallest;
	for(const [level, nodes] of levels.entries()){
		if(!nodes.length) continue;
		let singlePoints = 0;
		let singleBytes = 0;
		for(const node of nodes){
			singlePoints += node.numPoints;
			singleBytes += Number(node.byteSize);
		}
		cumulativePoints += singlePoints;
		cumulativeNodes += nodes.length;
		cumulativeBytes += singleBytes;
		// Use the first sufficiently populated depth as the coverage reference for this cloud.
		if(!coverageCells && cumulativePoints >= minimum) coverageCells = new Set(nodes.map(node => node.name));
		for(const [strategy, points, count, bytes] of [
			["cumulative", cumulativePoints, cumulativeNodes, cumulativeBytes],
			["single", singlePoints, nodes.length, singleBytes],
		]){
			if(!points) continue;
			const cut = {level, strategy, points, error: Math.abs(points - target)};
			if(!smallest || points < smallest.points) smallest = cut;
			if(points > ceiling) continue;
			if(!closest || cut.error < closest.error || (cut.error === closest.error && points < closest.points)) closest = cut;
			if(points < minimum) continue;
			// Project fine nodes onto the reference depth so a dense patch cannot count as full coverage.
			const coverage = strategy === "cumulative" ? coverageCells.size : countCoveredCells(nodes, coverageCells);
			const cost = bytes + count * NODE_COST_BYTES;
			if(!preferred || coverage > preferred.coverage || (coverage === preferred.coverage && cost < preferred.cost)){
				preferred = {cut, coverage, cost};
			}
		}
	}
	// Keep all source points when the complete cloud already fits the initial budget.
	if(cumulativePoints <= Math.min(target, ceiling)) return closest;
	return preferred?.cut ?? closest ?? smallest;
}

/** Count unique reference cells represented by a single layer. */
function countCoveredCells(nodes, coverageCells){
	const width = coverageCells.values().next().value.length;
	const covered = new Set();
	for(const node of nodes){
		const cell = node.name.slice(0, width);
		if(coverageCells.has(cell)) covered.add(cell);
	}
	return covered.size;
}

/** Allocate a deterministic prefix across all rows, reserving a sample per row when possible. */
export function spreadXrayPoints(sizes, limit){
	const total = sizes.reduce((sum, size) => sum + size, 0);
	if(limit >= total) return sizes.slice();
	const minimum = limit >= sizes.length ? 1 : 0;
	const capacity = total - minimum * sizes.length;
	const extra = limit - minimum * sizes.length;
	let scanned = 0;
	let assigned = 0;
	return sizes.map(size => {
		scanned += size - minimum;
		const next = Math.floor(scanned / capacity * extra + 1e-8);
		const count = minimum + next - assigned;
		assigned = next;
		return count;
	});
}

function hash(value){
	value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
	value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
	return (value ^ (value >>> 16)) >>> 0;
}

/** Interleave uniform bands so every shorter prefix keeps samples throughout the node. */
export function xrayPointOrder(sourceCount, count, seed){
	const bands = Array.from({length: 20}, () => []);
	for(let index = 0; index < count; index++){
		const begin = Math.floor(index * sourceCount / count);
		const end = Math.floor((index + 1) * sourceCount / count);
		const block = Math.floor(index / bands.length);
		const band = (index + hash(seed + block)) % bands.length;
		bands[band].push(begin + hash(seed + index) % (end - begin));
	}
	return Uint32Array.from(bands.flat());
}

/** Use only completed render frames and ignore long gaps when the browser is suspended. */
export class XrayFrameRate{
	reset(timestamp){
		this.start = this.last = timestamp;
		this.frames = this.low = this.high = 0;
	}

	record(timestamp){
		if(this.last === undefined || timestamp - this.last >= 1000){
			this.reset(timestamp);
			return;
		}
		if(timestamp <= this.last) return;
		this.last = timestamp;
		if(timestamp < this.start) return;
		this.frames++;
		const elapsed = timestamp - this.start;
		if(elapsed < 1000) return;
		const fps = 1000 * this.frames / elapsed;
		this.low = fps < 25 ? this.low + 1 : 0;
		this.high = fps > 35 ? Math.min(2, this.high + 1) : 0;
		this.start = timestamp;
		this.frames = 0;
	}

	changed(timestamp, downshift = false){
		this.reset(timestamp);
		if(downshift) this.start += 1000;
	}
}
