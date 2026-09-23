import { BoxVolume } from '../Volume.js'
import { ClipTask, ClipMethod } from '../../defines.js'
import { buildOutsideClipBoxes } from './potreeOutsideClipBoxes.js'

/** Scope an explicitly selected cloud and any host-defined matching instances. */
export function startBoxClippingSession(viewer, { targetCloud, matchesTarget }, onClose) {
  // The host owns resource selection; the default scope is object identity.
  if (!targetCloud?.visible || !viewer.scene.pointclouds.includes(targetCloud)) return null
  // Reuse Potree's tight world bounds; octree bounds include empty padding above the cloud.
  const bounds = viewer.scene.getBoundingBox4One(targetCloud)
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    return null
  }
  const isTargetCloud = (cloud) => cloud === targetCloud || Boolean(matchesTarget?.(cloud))

  const scene = viewer.scene
  const previousTask = viewer.clipTask
  // Create a placed box directly; insertion would overwrite its bounds on mouse movement.
  const volume = new BoxVolume()
  volume.clip = true
  bounds.getCenter(volume.position)
  bounds.getSize(volume.scale)
  // Keep planar clouds invertible for Potree's clipping matrix.
  volume.scale.set(
    Math.max(volume.scale.x, 1e-6),
    Math.max(volume.scale.y, 1e-6),
    Math.max(volume.scale.z, 1e-6)
  )
  volume.updateMatrixWorld(true)
  // Keep all twelve edges visible without enabling the native transformation tool.
  if (volume.frame) {
    volume.frame.material.depthTest = false
    volume.frame.material.depthWrite = false
    // Yellow distinguishes the box outline from the three axis handle colors.
    volume.frame.material.color.set(0xffff00)
    volume.frame.renderOrder = 1
  }
  scene.addVolume(volume)
  const originalMaterials = new Map()
  let disposed = false
  let keepOutside = false

  // Keep the viewer's business clipping mode untouched; scope the box on materials only.
  viewer.inputHandler.deselectAll()
  viewer.inputHandler.blacklist.add(volume)

  const scopeClipping = () => {
    if (!scene.pointclouds.some(isTargetCloud)) {
      dispose()
      return
    }
    for (const cloud of scene.pointclouds) {
      const material = cloud.material
      if (!originalMaterials.has(material)) {
        originalMaterials.set(material, {
          task: material.clipTask,
          method: material.clipMethod,
          target: isTargetCloud(cloud),
          sourceBoxes: material.clipBoxes,
          appliedBoxes: null,
        })
      }
      if (isTargetCloud(cloud)) {
        const original = originalMaterials.get(material)
        // Native updates provide fresh business inverses; repeated scoping reuses that baseline.
        if (material.clipBoxes !== original.appliedBoxes) original.sourceBoxes = material.clipBoxes
        const boxes = keepOutside
          ? buildOutsideClipBoxes(cloud, volume, original.sourceBoxes)
          : original.sourceBoxes
        if (boxes !== material.clipBoxes) material.setClipBoxes(boxes)
        original.appliedBoxes = material.clipBoxes
        material.clipTask = keepOutside ? ClipTask.SHOW_OUTSIDE : ClipTask.SHOW_INSIDE
        // Existing keep-inside volumes (such as height slabs) must intersect the new box.
        material.clipMethod = keepOutside ? ClipMethod.INSIDE_ANY : ClipMethod.INSIDE_ALL
      } else {
        // Remove only our box; retain the live business clipping volumes and mode.
        const boxes = material.clipBoxes.filter((entry) => entry.box !== volume)
        if (boxes.length !== material.clipBoxes.length) material.setClipBoxes(boxes)
      }
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    scene.removeEventListener('volume_removed', onRemoved)
    scene.removeEventListener('pointcloud_removed', onCloudRemoved)
    viewer.removeEventListener('scene_changed', dispose)
    viewer.removeEventListener('update_start', scopeClipping)
    viewer.removeEventListener('update', scopeClipping)
    if (viewer.inputHandler.drag?.object === volume) {
      // A synthetic drop releases the native insertion listeners before removal.
      volume.dispatchEvent({ type: 'drop' })
      viewer.inputHandler.drag = null
    }
    if (viewer.inputHandler.selection.includes(volume)) {
      viewer.inputHandler.toggleSelection(volume)
    }
    scene.removeVolume(volume)
    viewer.inputHandler.blacklist.delete(volume)
    // Remove only owned state; never restore stale business bounds changed while open.
    for (const [material, original] of originalMaterials) {
      const source = original.target && material.clipBoxes === original.appliedBoxes
        ? original.sourceBoxes : material.clipBoxes
      const boxes = source.filter((entry) => entry.box !== volume)
      if (source !== material.clipBoxes || boxes.length !== material.clipBoxes.length) material.setClipBoxes(boxes)
      if (original.target) {
        material.clipTask = viewer.clipTask === previousTask ? original.task : viewer.clipTask
        material.clipMethod = original.method
      }
    }
    originalMaterials.clear()
    onClose()
  }
  const onRemoved = (event) => {
    if (event.volume === volume) dispose()
  }
  const onCloudRemoved = (event) => {
    // Removing one duplicate must not cancel clipping on the remaining target instances.
    if (isTargetCloud(event.pointcloud) && !scene.pointclouds.some(isTargetCloud)) dispose()
  }

  scene.addEventListener('volume_removed', onRemoved)
  scene.addEventListener('pointcloud_removed', onCloudRemoved)
  viewer.addEventListener('scene_changed', dispose)
  viewer.addEventListener('update_start', scopeClipping)
  viewer.addEventListener('update', scopeClipping)
  scopeClipping()
  // Expose the owned box to the independent face controls, keeping cleanup centralized.
  return {
    dispose, volume,
    // A retained duplicate may outlive the first octree; serialize a live resource transform.
    get targetCloud() { return scene.pointclouds.find(isTargetCloud) },
    // Serialization reads the session's actual direction, not a separate UI copy.
    get keepOutside() { return keepOutside },
    // Change only this resource's clipping direction without rebuilding the interactive box.
    setKeepOutside(value) {
      if (disposed) return
      keepOutside = Boolean(value)
      scopeClipping()
    },
  }
}
