import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Object3D, PerspectiveCamera, OrthographicCamera, Vector3 } from '../libs/three.js/build/three.module.js'
import { CLIPPING_FACES, getClippingFace, projectClippingFace, beginClippingFaceDrag, applyClippingFaceDrag, cancelClippingFaceDrag } from '../src/utils/box-clipping/potreeClippingFaces.js'

// Exercise geometry with real Three transforms, including non-uniform box dimensions.
function fixture(orthographic = false) {
  const volume = new Object3D()
  volume.position.set(3, -2, 1)
  volume.scale.set(8, 6, 4)
  volume.rotation.set(.2, .4, -.3)
  volume.updateMatrixWorld(true)
  const camera = orthographic ? new OrthographicCamera(-15, 15, 10, -10, .1, 1000) : new PerspectiveCamera(60, 1.5, .1, 1000)
  camera.position.set(20, -25, 30)
  camera.lookAt(volume.position)
  camera.updateMatrixWorld(true)
  return { volume, camera }
}
function close(a, b) { assert.ok(a.distanceTo(b) < 1e-8, `${a.toArray()} != ${b.toArray()}`) }

for (const orthographic of [false, true]) {
  test(`all six rotated faces keep their opposite face fixed (${orthographic ? 'ortho' : 'perspective'})`, () => {
    for (const face of CLIPPING_FACES) {
      const { volume, camera } = fixture(orthographic)
      const opposite = { ...face, sign: -face.sign }
      const fixed = getClippingFace(volume, opposite).center
      const start = beginClippingFaceDrag(volume, face, 'move', camera, 900, 600)
      const oldScale = volume.scale.clone()
      applyClippingFaceDrag(volume, start, 37, -19)
      close(getClippingFace(volume, opposite).center, fixed)
      for (const axis of ['x', 'y', 'z'].filter(axis => axis !== face.axis)) assert.equal(volume.scale[axis], oldScale[axis])
      const result = volume.position.clone()
      applyClippingFaceDrag(volume, start, 37, -19)
      close(volume.position, result)
      cancelClippingFaceDrag(volume, start)
      close(volume.position, start.position)
      close(volume.scale, oldScale)
      assert.ok(volume.quaternion.angleTo(start.quaternion) < 1e-7)
    }
  })
}

test('rotation fixes both face centers, box center and dimensions on every local axis', () => {
  for (const face of CLIPPING_FACES) {
    const { volume, camera } = fixture()
    const a = getClippingFace(volume, face).center
    const opposite = { ...face, sign: -face.sign }
    const b = getClippingFace(volume, opposite).center
    const start = beginClippingFaceDrag(volume, face, 'rotate', camera, 900, 600)
    assert.equal(applyClippingFaceDrag(volume, start, 180, 45), 90)
    close(volume.position, start.position)
    close(volume.scale, start.scale)
    close(getClippingFace(volume, face).center, a)
    close(getClippingFace(volume, opposite).center, b)
    assert.ok(volume.quaternion.angleTo(start.quaternion) > 1)
    cancelClippingFaceDrag(volume, start)
    assert.ok(volume.quaternion.angleTo(start.quaternion) < 1e-7)
  }
})

test('front-on normal uses vertical fallback and prevents crossing the opposite face', () => {
  const { volume, camera } = fixture()
  volume.rotation.set(0, 0, 0)
  camera.position.copy(volume.position).add(new Vector3(0, 0, 20))
  camera.lookAt(volume.position)
  camera.updateMatrixWorld(true)
  const face = CLIPPING_FACES.find(face => face.id === 'z+')
  const fixed = getClippingFace(volume, { ...face, sign: -1 }).center
  const start = beginClippingFaceDrag(volume, face, 'move', camera, 900, 600)
  assert.equal(start.screenAxis, null)
  applyClippingFaceDrag(volume, start, 0, -20)
  assert.ok(volume.scale.z > start.scale.z)
  applyClippingFaceDrag(volume, start, 0, 1e9)
  assert.equal(volume.scale.z, 1e-6)
  close(getClippingFace(volume, { ...face, sign: -1 }).center, fixed)
})

test('overlapping front and back centers have identical pixels and ordered camera depths', () => {
  const { volume, camera } = fixture(true)
  volume.rotation.set(0, 0, 0)
  camera.position.copy(volume.position).add(new Vector3(0, 0, 20))
  camera.lookAt(volume.position)
  camera.updateMatrixWorld(true)
  const front = projectClippingFace(volume, CLIPPING_FACES.find(f => f.id === 'z+'), camera, 900, 600)
  const back = projectClippingFace(volume, CLIPPING_FACES.find(f => f.id === 'z-'), camera, 900, 600)
  assert.equal(front.x, back.x)
  assert.equal(front.y, back.y)
  assert.ok(front.visible && back.visible)
  assert.ok(front.depth < back.depth)
})


// Potree uses a symmetric depth range for orthographic views, including negative depths.
test('orthographic faces remain visible behind and on the camera plane inside the clip range', () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, -10000, 10000)
  camera.updateMatrixWorld(true)
  const volume = new Object3D()
  const face = CLIPPING_FACES.find(f => f.id === 'z+')
  for (const z of [-3, 0, 3]) {
    volume.position.z = z - .5
    const projected = projectClippingFace(volume, face, camera, 900, 600)
    assert.equal(projected.visible, true)
    assert.equal(projected.depth, -z)
    assert.equal(projected.x, 450)
    assert.equal(projected.y, 300)
  }
})

// Removing the positive-depth gate must not admit faces outside any frustum plane.
test('orthographic faces outside lateral and depth clipping planes stay hidden', () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, -10000, 10000)
  camera.updateMatrixWorld(true)
  const volume = new Object3D()
  const face = CLIPPING_FACES.find(f => f.id === 'z+')
  for (const [x, y, z] of [[11, 0, 3], [-11, 0, 3], [0, 11, 3], [0, -11, 3], [0, 0, 10001], [0, 0, -10001]]) {
    volume.position.set(x, y, z - .5)
    assert.equal(projectClippingFace(volume, face, camera, 900, 600).visible, false)
  }
  // Positive near planes still reject faces behind the camera.
  camera.near = .1
  camera.updateProjectionMatrix()
  volume.position.set(0, 0, 2.5)
  assert.equal(projectClippingFace(volume, face, camera, 900, 600).visible, false)
})

// Perspective projection must retain its original positive-depth and near/far constraints.
test('perspective face visibility continues to reject behind-camera and out-of-range centers', () => {
  const camera = new PerspectiveCamera(60, 1.5, .1, 100)
  camera.updateMatrixWorld(true)
  const volume = new Object3D()
  const face = CLIPPING_FACES.find(f => f.id === 'z+')
  for (const [z, visible] of [[-3, true], [3, false], [0, false], [-.05, false], [-101, false]]) {
    volume.position.z = z - .5
    assert.equal(projectClippingFace(volume, face, camera, 900, 600).visible, visible)
  }
})
