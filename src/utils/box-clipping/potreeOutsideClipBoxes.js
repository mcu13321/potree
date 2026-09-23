/** Express (outside owned box AND inside business boxes) using Potree's outside-any mode. */
export function buildOutsideClipBoxes(cloud, volume, boxes) {
  const result = boxes.filter((entry) => entry.box === volume)
  const worldBounds = cloud.getBoundingBoxWorld()
  for (const entry of boxes.filter((item) => item.box !== volume)) {
    // Bound the complement by this cloud's full octree extent, never by the moved clip box.
    const localBounds = worldBounds.clone().applyMatrix4(entry.inverse)
    for (const axis of ['x', 'y', 'z']) {
      for (const sign of [-1, 1]) {
        const slab = localBounds.clone()
        // Keep the business box boundary inclusive despite floating-point round-off.
        if (sign < 0) slab.max[axis] = Math.min(slab.max[axis], -0.5 - 1e-7)
        else slab.min[axis] = Math.max(slab.min[axis], 0.5 + 1e-7)
        const size = slab.getSize(volume.position.clone())
        if (slab.isEmpty() || size.x <= 0 || size.y <= 0 || size.z <= 0) continue
        const center = slab.getCenter(volume.position.clone())
        const matrix = entry.inverse.clone().invert()
        const local = matrix.clone().makeScale(size.x, size.y, size.z).setPosition(center)
        matrix.multiply(local)
        // Tag generated exclusions with our box so they cannot survive session cleanup.
        result.push({ box: volume, inverse: matrix.clone().invert(), position: center.setFromMatrixPosition(matrix) })
      }
    }
  }
  return result
}
