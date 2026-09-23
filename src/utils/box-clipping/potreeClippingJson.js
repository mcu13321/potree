import { Matrix4, Quaternion, Vector3 } from '../../../libs/three.js/build/three.module.js'

const FORMAT = 'point-cloud-clip-box'
const fail = (code = 'InvalidJson') => { throw new Error(code) }
const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite)

/** Geometry positions are source coordinates minus the loader's geometry offset. */
function sourceToScene(cloud) {
  cloud.updateMatrixWorld(true)
  const offset = cloud.pcoGeometry?.offset
  if (!offset || ![offset.x, offset.y, offset.z].every(Number.isFinite)) fail('MissingCoordinates')
  const matrix = new Matrix4().fromArray(cloud.matrixWorld.elements)
    .multiply(new Matrix4().makeTranslation(-offset.x, -offset.y, -offset.z))
  if (!matrix.elements.every(Number.isFinite) || matrix.determinant() === 0) fail('MissingCoordinates')
  return matrix
}

/** Export one normalized cube transform; its source frame survives scene origin rebasing. */
export function exportPotreeClippingJson(session) {
  const cloud = session.targetCloud
  session.volume.updateMatrixWorld(true)
  const boxToSource = sourceToScene(cloud).invert()
    .multiply(new Matrix4().fromArray(session.volume.matrixWorld.elements))
  if (!boxToSource.elements.every(Number.isFinite)) fail('MissingCoordinates')
  // Affine inversion may round the final homogeneous element away from exactly one.
  boxToSource.elements[3] = boxToSource.elements[7] = boxToSource.elements[11] = 0
  boxToSource.elements[15] = 1
  return {
    format: FORMAT,
    version: 1,
    coordinateSystem: {
      space: 'point-cloud-source', axes: 'xyz', handedness: 'right', upAxis: 'z',
      unit: 'source-unit', crs: cloud.projection || cloud.pcoGeometry?.projection || null,
    },
    target: { resource: cloud.baseUrl || null },
    clipping: {
      keep: session.keepOutside ? 'outside' : 'inside',
      boundary: 'inside-inclusive',
      // Column vectors: sourcePoint = boxToSource * [localX, localY, localZ, 1].
      matrixLayout: 'column-major',
      localBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      boxToSource: boxToSource.toArray(),
    },
  }
}

/** Validate fully before touching an existing session, then resolve its current scene pose. */
export function parsePotreeClippingJson(text, cloud) {
  let data
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { fail() }
  if (data?.format !== FORMAT || data.version !== 1) fail('UnsupportedJson')
  const frame = data.coordinateSystem
  const clip = data.clipping
  if (frame?.space !== 'point-cloud-source' || frame.axes !== 'xyz' || frame.handedness !== 'right' ||
      frame.upAxis !== 'z' || frame.unit !== 'source-unit' ||
      (frame.crs !== null && typeof frame.crs !== 'string')) fail('UnsupportedCoordinates')
  const crs = cloud.projection || cloud.pcoGeometry?.projection || null
  if (crs && frame.crs && crs !== frame.crs) fail('UnsupportedCoordinates')
  if (!clip || !['inside', 'outside'].includes(clip.keep) || clip.boundary !== 'inside-inclusive' ||
      clip.matrixLayout !== 'column-major' || !finiteArray(clip.boxToSource, 16) ||
      !finiteArray(clip.localBounds?.min, 3) || !finiteArray(clip.localBounds?.max, 3) ||
      !clip.localBounds.min.every(v => v === -0.5) || !clip.localBounds.max.every(v => v === 0.5)) fail()
  // Never normalize the caller's document in place.
  const values = clip.boxToSource.slice()
  if ([3, 7, 11].some(i => Math.abs(values[i]) > 1e-10) || Math.abs(values[15] - 1) > 1e-10) fail()
  values[3] = values[7] = values[11] = 0
  values[15] = 1
  const matrix = sourceToScene(cloud).multiply(new Matrix4().fromArray(values))
  if (!matrix.elements.every(Number.isFinite) || matrix.determinant() <= 0) fail()
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(Number.isFinite) ||
      scale.toArray().some(v => v <= 0)) fail()
  // A BoxVolume cannot reproduce shear. Reject it instead of silently changing the shape.
  const reconstructed = new Matrix4().compose(position, quaternion, scale)
  if (matrix.elements.some((v, i) => Math.abs(v - reconstructed.elements[i]) > 1e-8 * Math.max(1, Math.abs(v)))) fail('UnsupportedCoordinates')
  return { position, quaternion, scale, keepOutside: clip.keep === 'outside' }
}

/** Apply an already validated pose without replacing the box or any business clipping state. */
export function applyPotreeClippingJson(session, pose) {
  session.volume.position.copy(pose.position)
  session.volume.quaternion.copy(pose.quaternion)
  session.volume.scale.copy(pose.scale)
  session.volume.updateMatrixWorld(true)
  session.setKeepOutside(pose.keepOutside)
}
