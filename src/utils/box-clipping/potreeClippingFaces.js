// Stable local face identities survive every box rotation.
export const CLIPPING_FACES = ['x', 'y', 'z'].flatMap((axis) =>
  [-1, 1].map((sign) => ({ id: `${axis}${sign > 0 ? '+' : '-'}`, axis, sign }))
)

/** Resolve a face in world space without using the box's non-uniform scale as a normal. */
export function getClippingFace(volume, face) {
  const normal = volume.position.clone().set(0, 0, 0)
  normal[face.axis] = face.sign
  normal.applyQuaternion(volume.quaternion)
  return { normal, center: volume.position.clone().addScaledVector(normal, volume.scale[face.axis] / 2) }
}

/** Project using CSS pixels so the controls are independent of device pixel ratio. */
export function projectClippingFace(volume, face, camera, width, height) {
  const { center } = getClippingFace(volume, face)
  const depth = -center.clone().applyMatrix4(camera.matrixWorldInverse).z
  const ndc = center.clone().project(camera)
  return {
    x: (ndc.x + 1) * width / 2,
    y: (1 - ndc.y) * height / 2,
    depth,
    // Orthographic negative near planes can include faces behind the camera plane.
    visible: (camera.isOrthographicCamera || depth > 0) && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1,
  }
}

/** Capture all geometry and projection values once to prevent cumulative drag drift. */
export function beginClippingFaceDrag(volume, face, mode, camera, width, height) {
  const { center, normal } = getClippingFace(volume, face)
  const projected = center.clone().project(camera)
  const shifted = projected.clone()
  shifted.x += 2 / width
  const worldPerPixel = shifted.unproject(camera).distanceTo(center)
  const tip = center.clone().addScaledVector(normal, worldPerPixel).project(camera)
  const x = (tip.x - projected.x) * width / 2
  const y = -(tip.y - projected.y) * height / 2
  const length = Math.hypot(x, y)
  return {
    face, mode, normal, worldPerPixel,
    screenAxis: length < 0.1 ? null : { x, y, length },
    position: volume.position.clone(), scale: volume.scale.clone(), quaternion: volume.quaternion.clone(),
  }
}

/** Move only one face, or rotate the complete box around its outward face normal. */
export function applyClippingFaceDrag(volume, start, dx, dy) {
  volume.position.copy(start.position)
  volume.scale.copy(start.scale)
  volume.quaternion.copy(start.quaternion)
  let degrees = 0
  if (start.mode === 'rotate') {
    degrees = dx * 0.5
    const rotation = start.quaternion.clone().setFromAxisAngle(start.normal, degrees * Math.PI / 180)
    volume.quaternion.premultiply(rotation)
  } else {
    const axis = start.screenAxis
    const distance = axis
      ? (dx * axis.x + dy * axis.y) / (axis.length * axis.length) * start.worldPerPixel
      : -dy * start.worldPerPixel
    const oldSize = start.scale[start.face.axis]
    const nextSize = Math.max(1e-6, oldSize + distance)
    volume.scale[start.face.axis] = nextSize
    volume.position.addScaledVector(start.normal, (nextSize - oldSize) / 2)
  }
  volume.updateMatrixWorld(true)
  return degrees
}

/** Cancellation restores the exact starting pose, including a previously rotated box. */
export function cancelClippingFaceDrag(volume, start) {
  volume.position.copy(start.position)
  volume.scale.copy(start.scale)
  volume.quaternion.copy(start.quaternion)
  volume.updateMatrixWorld(true)
}
