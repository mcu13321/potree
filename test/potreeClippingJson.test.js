import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Object3D, Vector3, Matrix4 } from '../libs/three.js/build/three.module.js'
import { exportPotreeClippingJson, parsePotreeClippingJson, applyPotreeClippingJson } from '../src/utils/box-clipping/potreeClippingJson.js'

// Geometry is loader-local, while the display has been translated far from source coordinates.
function fixture() {
  const cloud = new Object3D()
  cloud.pcoGeometry = { offset: new Vector3(510000, 3200000, 100), projection: 'EPSG:32650' }
  cloud.baseUrl = 'resource/a'
  cloud.position.set(-10, -20, -30)
  cloud.updateMatrixWorld(true)
  const volume = new Object3D()
  volume.position.set(2, 3, 4)
  volume.scale.set(12, 8, 3)
  volume.rotation.set(.2, .3, .4)
  volume.updateMatrixWorld(true)
  return { targetCloud: cloud, volume, keepOutside: false, setKeepOutside(value) { this.keepOutside = value } }
}
function equalMatrix(a, b, epsilon = 1e-8) {
  a.elements.forEach((v, i) => assert.ok(Math.abs(v - b.elements[i]) < epsilon, `element ${i}: ${v} / ${b.elements[i]}`))
}

test('JSON round trip preserves rotated box and both clipping directions', () => {
  for (const outside of [false, true]) {
    const session = fixture()
    session.keepOutside = outside
    const expected = session.volume.matrixWorld.clone()
    const data = exportPotreeClippingJson(session)
    const pose = parsePotreeClippingJson(JSON.stringify(data), session.targetCloud)
    session.volume.position.set(100, 200, 300)
    session.volume.scale.set(1, 1, 1)
    applyPotreeClippingJson(session, pose)
    equalMatrix(session.volume.matrixWorld, expected)
    assert.equal(session.keepOutside, outside)
    assert.equal(data.target.resource, 'resource/a')
  }
})

test('source transform reproduces point classification without Potree', () => {
  const session = fixture()
  const data = exportPotreeClippingJson(session)
  const toSource = new Matrix4().fromArray(data.clipping.boxToSource)
  const sourceCenter = new Vector3().applyMatrix4(toSource)
  assert.deepEqual(sourceCenter.toArray(), [510012, 3200023, 134])
  const sourceToBox = toSource.clone().invert()
  for (const local of [new Vector3(.2, -.3, .1), new Vector3(.7, .2, 0)]) {
    const point = local.clone().applyMatrix4(toSource)
    const q = point.applyMatrix4(sourceToBox)
    assert.equal(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z)) <= .5, Math.abs(local.x) <= .5)
  }
})

test('import follows a different scene origin instead of restoring a stale display position', () => {
  const session = fixture()
  const json = JSON.stringify(exportPotreeClippingJson(session))
  session.targetCloud.position.add(new Vector3(600, -200, 80))
  const pose = parsePotreeClippingJson(json, session.targetCloud)
  assert.ok(pose.position.distanceTo(new Vector3(602, -197, 84)) < 1e-8)
})

test('cloud rotation and nonuniform scale cancel correctly on reimport', () => {
  const session = fixture()
  session.targetCloud.rotation.set(.1, .25, .5)
  session.targetCloud.scale.set(2, 3, 4)
  const expected = session.volume.matrixWorld.clone()
  const json = JSON.stringify(exportPotreeClippingJson(session))
  applyPotreeClippingJson(session, parsePotreeClippingJson(json, session.targetCloud))
  equalMatrix(session.volume.matrixWorld, expected)
})

test('invalid documents cannot mutate the active box', () => {
  const session = fixture()
  const original = session.volume.matrixWorld.clone()
  const good = exportPotreeClippingJson(session)
  const edits = [
    data => { data.version = 2 },
    data => { data.clipping.keep = 'unknown' },
    data => { data.clipping.boxToSource[0] = null },
    data => { data.clipping.boxToSource = Array(16).fill(0) },
    data => { data.clipping.boxToSource[3] = 1 },
    data => { data.coordinateSystem.crs = 'EPSG:4326' },
    data => { data.coordinateSystem.unit = 'feet' },
    data => { data.clipping.boxToSource[4] += 10 },
  ]
  for (const edit of edits) {
    const data = structuredClone(good); edit(data)
    assert.throws(() => parsePotreeClippingJson(JSON.stringify(data), session.targetCloud))
    equalMatrix(session.volume.matrixWorld, original)
  }
  assert.throws(() => parsePotreeClippingJson('{', session.targetCloud))
})

test('loader offset is required, and UTF-8 BOM files remain importable', () => {
  const session = fixture()
  const json = JSON.stringify(exportPotreeClippingJson(session))
  assert.ok(parsePotreeClippingJson('\uFEFF' + json, session.targetCloud))
  delete session.targetCloud.pcoGeometry.offset
  assert.throws(() => exportPotreeClippingJson(session), /MissingCoordinates/)
})
