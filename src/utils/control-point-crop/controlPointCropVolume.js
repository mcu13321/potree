const cropsByCloud = new WeakMap();

export function getControlPointCropVolume(cloud) {
  return cropsByCloud.get(cloud);
}

export function setControlPointCropVolume(cloud, volume) {
  if (volume) cropsByCloud.set(cloud, volume);
  else cropsByCloud.delete(cloud);
}

/** Pack a closed XY perimeter for the vertex shader. Heights come only from the crop range. */
export function createControlPointCropVolume(points, zMin, zMax) {
  if (points.length < 3 || points.length > 64 || !Number.isFinite(zMin)
    || !Number.isFinite(zMax) || zMin >= zMax) return null;

  const origin = points[0];
  let area = 0;
  const vertices = new Float32Array((points.length + 1) * 2);
  for (let index = 0; index < points.length; index++) {
    const { x, y } = points[index];
    const next = points[(index + 1) % points.length];
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === next.x && y === next.y)) return null;
    area += (x - origin.x) * (next.y - origin.y) - (y - origin.y) * (next.x - origin.x);
    vertices.set([x, y], index * 2);
  }
  if (Math.abs(area) < 1e-6) return null;
  vertices.set([origin.x, origin.y], points.length * 2);
  return { vertices, count: points.length, range: [zMin, zMax] };
}
