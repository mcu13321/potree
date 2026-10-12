import {
  getClippingFace, beginClippingFaceDrag, applyClippingFaceDrag, cancelClippingFaceDrag,
} from './potreeClippingFaces.js'
import { createBoxClippingHandles } from './BoxClippingHandles.js'

/** Mount native 3D handles and an angle readout in the viewer canvas document. */
export function mountBoxClippingControls(viewer, volume, onChange) {
  const canvasElement = viewer.renderer.domElement
  const host = canvasElement.parentElement
  const doc = canvasElement.ownerDocument
  const win = doc.defaultView
  const root = doc.createElement('div')
  root.dataset.potreeBoxClipping = ''
  root.className = 'potree-box-clipping-controls'
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10'
  const angle = doc.createElement('output')
  angle.hidden = true
  angle.style.cssText = 'position:absolute;transform:translateX(-50%);background:#000b;color:white;font:12px sans-serif;padding:2px 6px;border-radius:4px'
  root.append(angle)
  // Only the angle readout needs a DOM overlay; all interactive shapes live in Three.js.
  const oldPosition = host.style.position
  const positioned = !win.getComputedStyle(host).position || win.getComputedStyle(host).position === 'static'
  if (positioned) host.style.position = 'relative'
  host.append(root)
  const handles = createBoxClippingHandles()
  const oldCursor = canvasElement.style.cursor
  let drag = null
  let hovered = null
  let suppressMouse = false
  let disposed = false
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation() }

  // Update at the render boundary and before picking so camera and box transforms cannot go stale.
  const update = () => {
    const camera = viewer.scene.getActiveCamera()
    const canvas = canvasElement.getBoundingClientRect()
    handles.update(volume, camera, canvas.width, canvas.height)
    if (drag) {
      const center = getClippingFace(volume, drag.start.face).center.project(camera)
      const parent = host.getBoundingClientRect()
      angle.style.left = `${canvas.left - parent.left + (center.x + 1) * canvas.width / 2}px`
      angle.style.top = `${canvas.top - parent.top + (1 - center.y) * canvas.height / 2 + 24}px`
    }
  }
  const render = () => {
    if (disposed) return
    update()
    const renderer = viewer.renderer
    const autoClear = renderer.autoClear
    try {
      // A fresh overlay depth buffer keeps handles in front of points but preserves mutual occlusion.
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(handles.scene, viewer.scene.getActiveCamera())
    } finally {
      renderer.autoClear = autoClear
    }
  }
  const pick = event => {
    update()
    const rect = canvasElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const x = (event.clientX - rect.left) / rect.width * 2 - 1
    const y = 1 - (event.clientY - rect.top) / rect.height * 2
    if (Math.abs(x) > 1 || Math.abs(y) > 1) return null
    return handles.pick(viewer.scene.getActiveCamera(), x, y)
  }
  const highlight = handle => {
    hovered = handle
    handles.highlight(drag?.handle ?? hovered)
    canvasElement.style.cursor = drag ? 'grabbing' : hovered ? 'grab' : oldCursor
  }
  const finish = cancel => {
    if (!drag) return
    const current = drag
    drag = null
    if (cancel) cancelClippingFaceDrag(volume, current.start)
    if (canvasElement.hasPointerCapture(current.pointerId)) canvasElement.releasePointerCapture(current.pointerId)
    angle.hidden = true
    highlight(null)
    onChange()
  }
  const down = event => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || drag) return
    // Clear cancellation's compatibility-event guard before the next independent gesture.
    suppressMouse = false
    const handle = pick(event)
    if (!handle) return
    stop(event)
    const rect = canvasElement.getBoundingClientRect()
    drag = {
      start: beginClippingFaceDrag(volume, handle.userData.face, handle.userData.mode,
        viewer.scene.getActiveCamera(), rect.width, rect.height),
      x: event.clientX, y: event.clientY, pointerId: event.pointerId, handle,
    }
    suppressMouse = true
    canvasElement.setPointerCapture(event.pointerId)
    highlight(handle)
    if (handle.userData.mode === 'rotate') { angle.hidden = false; angle.textContent = '0°' }
  }
  const move = event => {
    if (!drag) {
      if (event.pointerType === 'mouse') highlight(pick(event))
      return
    }
    if (event.pointerId !== drag.pointerId) return
    stop(event)
    const degrees = applyClippingFaceDrag(volume, drag.start, event.clientX - drag.x, event.clientY - drag.y)
    angle.textContent = `${degrees.toFixed(1)}°`
    onChange()
  }
  const up = event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    move(event)
    finish(false)
  }
  const cancel = event => {
    if (event?.pointerId !== undefined && drag?.pointerId !== event.pointerId) return
    finish(true)
  }
  const escape = event => {
    if (event.key === 'Escape' && drag) { stop(event); finish(true) }
  }
  const leave = () => { if (!drag) highlight(null) }
  const mouse = event => {
    // InputHandler uses mouse events: block compatibility events even after pointerup releases capture.
    if (suppressMouse || (event.type === 'dblclick' && pick(event))) stop(event)
  }
  const pointerEvents = { pointerdown: down, pointermove: move, pointerup: up,
    pointercancel: cancel, lostpointercapture: cancel, pointerleave: leave }
  Object.entries(pointerEvents).forEach(([type, listener]) => canvasElement.addEventListener(type, listener, true))
  const mouseEvents = ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick']
  mouseEvents.forEach(type => canvasElement.addEventListener(type, mouse, true))
  win.addEventListener('keydown', escape, true)
  win.addEventListener('blur', cancel)
  viewer.addEventListener('render.pass.end', render)
  update()
  return () => {
    disposed = true
    finish(true)
    viewer.removeEventListener('render.pass.end', render)
    Object.entries(pointerEvents).forEach(([type, listener]) => canvasElement.removeEventListener(type, listener, true))
    mouseEvents.forEach(type => canvasElement.removeEventListener(type, mouse, true))
    win.removeEventListener('keydown', escape, true)
    win.removeEventListener('blur', cancel)
    canvasElement.style.cursor = oldCursor
    handles.dispose()
    root.remove()
    if (positioned && host.style.position === 'relative') host.style.position = oldPosition
  }
}
