import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { Box3, Color, EventDispatcher, Object3D, Vector3, Matrix4 } from '../libs/three.js/build/three.module.js'
import { startBoxClippingSession } from '../src/utils/box-clipping/startBoxClippingSession.js'
vi.mock('../src/utils/Volume.js', async () => {
  const { Object3D, Color } = await import('../libs/three.js/build/three.module.js');
  return { BoxVolume: class extends Object3D { constructor() { super(); this.frame = {material:{color:new Color(),depthTest:true,depthWrite:true}} } } };
});
// This adapter models the host's first-resource policy, not a Potree default.
function startPotreeClipping(viewer, _Potree, onClose) {
 const targetCloud = viewer.scene.pointclouds[0];
 return startBoxClippingSession(viewer, {targetCloud, matchesTarget: cloud => Boolean(targetCloud?.baseUrl) && cloud.baseUrl === targetCloud.baseUrl}, onClose);
}

// Native volumes expose the same transform API as Object3D.
class BoxVolume extends Object3D {
  constructor() {
    super()
    // Include the native frame material to verify outline visibility and color.
    this.frame = { material: { color: new Color(), depthTest: true, depthWrite: true } }
  }
}
const Potree = { BoxVolume, ClipMethod: { INSIDE_ANY: 0, INSIDE_ALL: 1 }, ClipTask: { NONE: 0, HIGHLIGHT: 1, SHOW_INSIDE: 2, SHOW_OUTSIDE: 3 } }

// Each cloud owns its clipping uniforms, as in the native Potree runtime.
function createCloud() {
  return {
    visible: true,
    // Include a translated resource instead of assuming bounds start at the origin.
    getBoundingBoxWorld: () => new Box3(new Vector3(10, -20, 3), new Vector3(18, -8, 9)),
    material: {
      clipBoxes: [],
      clipPolygons: [],
      clipTask: Potree.ClipTask.NONE,
      setClipBoxes(boxes) { this.clipBoxes = boxes },
      setClipPolygons(polygons) { this.clipPolygons = polygons },
    },
  }
}

// Model the native insertion/drop events, including cancellation listener cleanup.
function createViewer() {
  const viewer = new EventDispatcher()
  const scene = new EventDispatcher()
  const existingVolume = { clip: true }
  scene.pointclouds = [createCloud(), createCloud()]
  // Model the scene API separately from the cloud's padded octree bounds.
  scene.getBoundingBox4One = (cloud) => cloud.getBoundingBoxWorld()
  scene.volumes = [existingVolume]
  scene.addVolume = (volume) => { scene.volumes.push(volume) }
  scene.removeVolume = (volume) => {
    scene.volumes = scene.volumes.filter((item) => item !== volume)
    scene.dispatchEvent({ type: 'volume_removed', volume })
  }
  viewer.scene = scene
  viewer.clipTask = Potree.ClipTask.NONE
  viewer.setClipTask = (task) => { viewer.clipTask = task }
  viewer.inputHandler = {
    drag: null,
    blacklist: new Set(),
    selection: [],
    deselectAll() { this.selection = [] },
    toggleSelection(volume) {
      this.selection = this.selection.includes(volume)
        ? this.selection.filter((item) => item !== volume)
        : [...this.selection, volume]
    },
  }
  return { viewer, existingVolume }
}

test('initial box matches world bounds and excludes native transform handles', () => {
  const { viewer, existingVolume } = createViewer()
  let closed = 0
  const session = startPotreeClipping(viewer, Potree, () => { closed++ })
  const volume = viewer.scene.volumes[1]
  // No mouse placement is needed and the first frame contains the whole target.
  assert.deepEqual(volume.position.toArray(), [14, -14, 6])
  assert.deepEqual(volume.scale.toArray(), [8, 12, 6])
  assert.equal(volume.clip, true)
  assert.equal(volume.frame.material.color.getHex(), 0xffff00)
  assert.equal(volume.frame.material.depthTest, false)
  assert.equal(viewer.inputHandler.drag, null)
  assert.equal(viewer.clipTask, Potree.ClipTask.NONE)
  // The new face controls own this box; native selection must never expose handles.
  assert.deepEqual(viewer.inputHandler.selection, [])
  assert.equal(session.volume, volume)
  assert.equal(viewer.inputHandler.blacklist.has(volume), true)
  // Starting another native tool must not delete an already placed box.
  viewer.dispatchEvent({ type: 'cancel_insertions' })
  assert.equal(closed, 0)
  session.dispose()
  session.dispose()
  assert.equal(closed, 1)
  assert.deepEqual(viewer.scene.volumes, [existingVolume])
  assert.deepEqual(viewer.inputHandler.selection, [])
  assert.equal(viewer.clipTask, Potree.ClipTask.NONE)
  assert.equal(viewer.inputHandler.blacklist.has(volume), false)
})

test('resource cleanup releases the placed box and update listeners', () => {
    const { viewer, existingVolume } = createViewer()
    let closed = 0
    const session = startPotreeClipping(viewer, Potree, () => { closed++ })
    // The initialized box never owns native insertion listeners.
    session.dispose()
    assert.equal(viewer.inputHandler.drag, null)
    assert.deepEqual(viewer.scene.volumes, [existingVolume])
    assert.equal(viewer.clipTask, Potree.ClipTask.NONE)
    assert.equal(viewer._listeners.update.length, 0)
    assert.equal(closed, 1)
})

test('native delete restores the previous mode and resets the button state', () => {
  const { viewer } = createViewer()
  viewer.clipTask = Potree.ClipTask.HIGHLIGHT
  let closed = 0
  startPotreeClipping(viewer, Potree, () => { closed++ })
  const volume = viewer.scene.volumes[1]
  viewer.scene.removeVolume(volume)
  assert.equal(closed, 1)
  assert.equal(viewer.clipTask, Potree.ClipTask.HIGHLIGHT)
  assert.deepEqual(viewer.inputHandler.selection, [])
})

test('does not create a clip box before a visible point cloud is available', () => {
  const { viewer } = createViewer()
  viewer.scene.pointclouds.forEach((cloud) => { cloud.visible = false })
  assert.equal(startPotreeClipping(viewer, Potree, () => {}), null)
  assert.equal(viewer.scene.volumes.length, 1)
})

test('only the first cloud clips after every global update, including later additions', () => {
  const { viewer } = createViewer()
  const [first, second] = viewer.scene.pointclouds
  const session = startPotreeClipping(viewer, Potree, () => {})
  const volume = viewer.scene.volumes[1]
  const later = createCloud()
  viewer.scene.pointclouds.push(later)
  for (let frame = 0; frame < 3; frame++) {
    // Simulate the native update: CPU visibility first, then shared clip assignment.
    viewer.dispatchEvent({ type: 'update_start' })
    for (const cloud of [second, later]) {
      assert.equal(cloud.material.clipTask, Potree.ClipTask.NONE)
    }
    for (const cloud of viewer.scene.pointclouds) {
      cloud.material.setClipBoxes([{ box: volume }])
      cloud.material.setClipPolygons([{ id: 'polygon' }])
      cloud.material.clipTask = viewer.clipTask
    }
    viewer.dispatchEvent({ type: 'update' })
    assert.equal(first.material.clipBoxes[0].box, volume)
    assert.equal(first.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
    for (const cloud of [second, later]) {
      assert.equal(cloud.material.clipTask, Potree.ClipTask.NONE)
      // Other resources retain only their business clipping volumes.
      assert.deepEqual(cloud.material.clipBoxes, [])
    }
    first.visible = false
  }
  session.dispose()
  assert.equal(viewer._listeners.update.length, 0)
  assert.equal(viewer._listeners.update_start.length, 0)
})

test('closing restores pre-existing clipping even on hidden non-target clouds', () => {
  const { viewer } = createViewer()
  const second = viewer.scene.pointclouds[1]
  const boxes = [{ id: 'existing-box' }]
  const polygons = [{ id: 'existing-polygon' }]
  second.visible = false
  Object.assign(second.material, {
    clipBoxes: boxes, clipPolygons: polygons, clipTask: Potree.ClipTask.SHOW_INSIDE,
  })
  const session = startPotreeClipping(viewer, Potree, () => {})
  assert.equal(second.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
  session.dispose()
  assert.equal(second.material.clipBoxes, boxes)
  assert.equal(second.material.clipPolygons, polygons)
  assert.equal(second.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
})

test('removing the target closes clipping instead of retargeting the next cloud', () => {
  const { viewer, existingVolume } = createViewer()
  let closed = 0
  startPotreeClipping(viewer, Potree, () => { closed++ })
  const pointcloud = viewer.scene.pointclouds.shift()
  viewer.scene.dispatchEvent({ type: 'pointcloud_removed', pointcloud })
  assert.equal(closed, 1)
  assert.deepEqual(viewer.scene.volumes, [existingVolume])
  assert.equal(viewer._listeners.update.length, 0)
  assert.equal(viewer.scene._listeners.pointcloud_removed.length, 0)
})

test('a hidden first cloud does not fall back to the second visible cloud', () => {
  const { viewer } = createViewer()
  viewer.scene.pointclouds[0].visible = false
  assert.equal(startPotreeClipping(viewer, Potree, () => {}), null)
  assert.equal(viewer.scene.volumes.length, 1)
})

test('changing the scene releases clipping listeners and restores materials', () => {
  const { viewer, existingVolume } = createViewer()
  let closed = 0
  startPotreeClipping(viewer, Potree, () => { closed++ })
  viewer.dispatchEvent({ type: 'scene_changed' })
  assert.equal(closed, 1)
  assert.deepEqual(viewer.scene.volumes, [existingVolume])
  assert.equal(viewer._listeners.update_start.length, 0)
  assert.equal(viewer._listeners.scene_changed.length, 0)
})

test('clips every instance of the first resource when two resources create four octrees', () => {
  const { viewer } = createViewer()
  // Match the reported runtime: three A instances surrounding one B instance.
  viewer.scene.pointclouds = ['a', 'a', 'b', 'a'].map((baseUrl) => ({
    ...createCloud(), baseUrl,
  }))
  const session = startPotreeClipping(viewer, Potree, () => {})
  const volume = viewer.scene.volumes[1]
  for (let frame = 0; frame < 3; frame++) {
    for (const cloud of viewer.scene.pointclouds) {
      cloud.material.setClipBoxes([{ box: volume }])
      cloud.material.clipTask = viewer.clipTask
    }
    viewer.dispatchEvent({ type: 'update' })
    for (const cloud of viewer.scene.pointclouds) {
      assert.equal(cloud.material.clipTask,
        cloud.baseUrl === 'a' ? Potree.ClipTask.SHOW_INSIDE : Potree.ClipTask.NONE)
    }
  }
  // Late instances of the same resource share its clipping scope as well.
  const lateTarget = { ...createCloud(), baseUrl: 'a' }
  viewer.scene.pointclouds.push(lateTarget)
  viewer.dispatchEvent({ type: 'update_start' })
  assert.equal(lateTarget.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
  session.dispose()
  assert.ok(viewer.scene.pointclouds.every((cloud) => cloud.material.clipTask === Potree.ClipTask.NONE))
})

test('retains the resource target until its last instance is removed', () => {
  const { viewer } = createViewer()
  viewer.scene.pointclouds = ['a', 'b', 'a'].map((baseUrl) => ({
    ...createCloud(), baseUrl,
  }))
  let closed = 0
  const session = startPotreeClipping(viewer, Potree, () => { closed++ })
  const first = viewer.scene.pointclouds.shift()
  viewer.scene.dispatchEvent({ type: 'pointcloud_removed', pointcloud: first })
  assert.equal(closed, 0)
  // JSON IO follows the surviving instance of the same resource, never resource B.
  assert.equal(session.targetCloud, viewer.scene.pointclouds[1])
  const lastTarget = viewer.scene.pointclouds.pop()
  viewer.scene.dispatchEvent({ type: 'pointcloud_removed', pointcloud: lastTarget })
  assert.equal(closed, 1)
})

test('scan_potree height clipping intersects the target box and remains live after closing', () => {
  const { viewer, existingVolume: heightVolume } = createViewer()
  // Mirror scan_potree's hidden height volume and SHOW_INSIDE mode.
  heightVolume.uuid = 'potree-clip-height-tool'
  heightVolume.visible = false
  viewer.clipTask = Potree.ClipTask.SHOW_INSIDE
  viewer.clipMethod = Potree.ClipMethod.INSIDE_ANY
  const [first, second] = viewer.scene.pointclouds
  const session = startPotreeClipping(viewer, Potree, () => {})
  const box = viewer.scene.volumes[1]
  for (const height of [2, 5, 1]) {
    // Native updates rebuild inverses when business height controls move the slab.
    heightVolume.height = height
    for (const cloud of viewer.scene.pointclouds) {
      cloud.material.setClipBoxes([{ box: heightVolume, height }, { box }])
      cloud.material.clipTask = viewer.clipTask
      cloud.material.clipMethod = viewer.clipMethod
    }
    viewer.dispatchEvent({ type: 'update' })
    assert.deepEqual(first.material.clipBoxes.map((entry) => entry.box), [heightVolume, box])
    assert.equal(first.material.clipMethod, Potree.ClipMethod.INSIDE_ALL)
    assert.deepEqual(second.material.clipBoxes.map((entry) => entry.box), [heightVolume])
    assert.equal(second.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
    assert.equal(viewer.clipTask, Potree.ClipTask.SHOW_INSIDE)
    assert.equal(viewer.clipMethod, Potree.ClipMethod.INSIDE_ANY)
  }
  session.dispose()
  for (const cloud of viewer.scene.pointclouds) {
    assert.deepEqual(cloud.material.clipBoxes, [{ box: heightVolume, height: 1 }])
  }
  assert.deepEqual(viewer.scene.volumes, [heightVolume])
  assert.equal(heightVolume.visible, false)
  assert.equal(viewer.clipTask, Potree.ClipTask.SHOW_INSIDE)
})

test('rejects invalid bounds and keeps planar bounds invertible', () => {
  const { viewer } = createViewer()
  const cloud = viewer.scene.pointclouds[0]
  // Invalid metadata must not create an unusable volume or change clipping state.
  cloud.getBoundingBoxWorld = () => new Box3()
  assert.equal(startPotreeClipping(viewer, Potree, () => {}), null)
  cloud.getBoundingBoxWorld = () => new Box3(new Vector3(1, 2, 3), new Vector3(9, 10, 3))
  const session = startPotreeClipping(viewer, Potree, () => {})
  const volume = viewer.scene.volumes[1]
  assert.deepEqual(volume.position.toArray(), [5, 6, 3])
  assert.ok(volume.matrixWorld.determinant() > 0)
  session.dispose()
})

test('initializes from the existing tight scene bounds instead of padded octree height', () => {
  const { viewer } = createViewer()
  const target = viewer.scene.pointclouds[0]
  // A flat cloud may occupy only a small fraction of its cubic octree bounds.
  target.getBoundingBoxWorld = () => { throw new Error('Padded octree bounds must not be used') }
  const tightWorldBounds = new Box3(new Vector3(10, -20, 3), new Vector3(18, -8, 4))
  viewer.scene.getBoundingBox4One = (cloud) => {
    assert.equal(cloud, target)
    return tightWorldBounds.clone()
  }
  const session = startPotreeClipping(viewer, Potree, () => {})
  const volume = viewer.scene.volumes[1]
  assert.deepEqual(volume.position.toArray(), [14, -14, 3.5])
  assert.deepEqual(volume.scale.toArray(), [8, 12, 1])
  session.dispose()
})

// Direction changes must keep the box pose and restore the latest business source boxes.
test('direction toggles only target instances and preserves height clipping on close', () => {
  const { viewer, existingVolume: height } = createViewer()
  viewer.clipTask = Potree.ClipTask.SHOW_INSIDE
  const [first, second] = viewer.scene.pointclouds
  const session = startPotreeClipping(viewer, Potree, () => {})
  const box = session.volume
  const position = box.position.clone()
  const heightEntry = { box: height, inverse: new Matrix4().makeScale(.01, .01, .25) }
  const own = { box, inverse: box.matrixWorld.clone().invert() }
  for (const cloud of viewer.scene.pointclouds) {
    cloud.material.setClipBoxes([heightEntry, own])
    cloud.material.clipTask = viewer.clipTask
  }
  viewer.dispatchEvent({ type: 'update' })
  session.setKeepOutside(true)
  assert.equal(first.material.clipTask, Potree.ClipTask.SHOW_OUTSIDE)
  assert.equal(first.material.clipMethod, Potree.ClipMethod.INSIDE_ANY)
  assert.equal(second.material.clipTask, Potree.ClipTask.SHOW_INSIDE)
  assert.deepEqual(second.material.clipBoxes, [heightEntry])
  assert.equal(viewer.clipTask, Potree.ClipTask.SHOW_INSIDE)
  assert.deepEqual(box.position, position)
  // Moving the business height box while outside mode is active must replace stale inverses.
  const updatedHeight = { box: height, inverse: new Matrix4().makeScale(.01, .01, .5) }
  first.material.setClipBoxes([updatedHeight, own])
  viewer.dispatchEvent({ type: 'update' })
  assert.equal(first.material.clipTask, Potree.ClipTask.SHOW_OUTSIDE)
  session.setKeepOutside(false)
  assert.deepEqual(first.material.clipBoxes, [updatedHeight, own])
  session.setKeepOutside(true)
  session.dispose()
  assert.deepEqual(first.material.clipBoxes, [updatedHeight])
})
