import {
  CLIPPING_FACES, getClippingFace, projectClippingFace,
  beginClippingFaceDrag, applyClippingFaceDrag, cancelClippingFaceDrag,
} from './potreeClippingFaces.js'

/** Mount framework-independent face controls in the viewer canvas document. */
export function mountBoxClippingControls(viewer, volume, onChange) {
    const canvasElement = viewer.renderer.domElement
    const host = canvasElement.parentElement
    const doc = canvasElement.ownerDocument
    const root = doc.createElement('div')
    root.className = 'potree-box-clipping-controls'
    root.dataset.potreeBoxClipping = ''
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10'
    // Keep styles with the tool so consumers only need the normal Potree bundle.
    const style = doc.createElement('style')
    style.textContent = '.potree-box-clipping-controls button:hover{filter:brightness(1.15)}.potree-box-clipping-controls button[data-active]{outline:2px solid white;filter:brightness(1.25)}'
    root.append(style)
    const icons = {move:'<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',rotate:'<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>'}
    const colors = {x:'#ef4444',y:'#22c55e',z:'#3b82f6'}
    for (const face of CLIPPING_FACES) {
      const group = doc.createElement('div')
      group.dataset.face = face.id
      group.style.cssText = 'position:absolute;display:flex;gap:4px;transform:translate(-50%,-50%);visibility:hidden'
      for (const mode of ['move','rotate']) {
        const button = doc.createElement('button')
        button.type = 'button'
        button.dataset.mode = mode
        button.title = face.id.toUpperCase() + ': ' + (mode === 'move' ? 'Move face' : 'Rotate box')
        button.setAttribute('aria-label', button.title)
        button.style.cssText = 'pointer-events:auto;touch-action:none;cursor:grab;display:grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid #ffffff99;border-radius:4px;color:white;background:' + colors[face.axis]
        button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[mode] + '</svg>'
        group.append(button)
      }
      root.append(group)
    }
    const output = doc.createElement('output')
    output.hidden = true
    output.style.cssText = 'position:absolute;transform:translateX(-50%);background:#000b;color:white;font:12px sans-serif;padding:2px 6px;border-radius:4px;z-index:8'
    root.append(output)
    // Absolute overlays need the same positioning origin as the canvas.
    const oldPosition = host.style.position
    const positioned = doc.defaultView.getComputedStyle(host).position === 'static' || !doc.defaultView.getComputedStyle(host).position
    if (positioned) host.style.position = 'relative'
    host.append(root)
    const win = root.ownerDocument.defaultView
    let drag = null
    let frame = 0
    const groups = CLIPPING_FACES.map((face) => root.querySelector(`[data-face="${face.id}"]`))
    const angle = root.querySelector('output')
    const stop = (event) => { event.preventDefault(); event.stopPropagation() }
    const finish = (cancel) => {
      if (!drag) return
      const current = drag
      drag = null
      if (cancel) cancelClippingFaceDrag(volume, current.start)
      current.button.removeAttribute('data-active')
      if (current.button.hasPointerCapture(current.pointerId)) current.button.releasePointerCapture(current.pointerId)
      angle.hidden = true
      onChange()
    }
    const down = (event) => {
      const button = event.target.closest('button[data-mode]')
      if (!button || event.button !== 0 || event.pointerType !== 'mouse' || drag) return
      stop(event)
      const face = CLIPPING_FACES.find((item) => item.id === button.parentElement.dataset.face)
      const camera = viewer.scene.getActiveCamera()
      const canvas = viewer.renderer.domElement.getBoundingClientRect()
      drag = {
        start: beginClippingFaceDrag(volume, face, button.dataset.mode, camera, canvas.width, canvas.height),
        x: event.clientX, y: event.clientY, pointerId: event.pointerId, button,
      }
      button.setAttribute('data-active', 'true')
      button.setPointerCapture(event.pointerId)
      if (button.dataset.mode === 'rotate') { angle.hidden = false; angle.textContent = '0°' }
    }
    const move = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      stop(event)
      const degrees = applyClippingFaceDrag(volume, drag.start, event.clientX - drag.x, event.clientY - drag.y)
      angle.textContent = `${degrees.toFixed(1)}°`
      onChange()
    }
    const up = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      move(event)
      finish(false)
    }
    const cancel = () => finish(true)
    const escape = (event) => {
      if (event.key === 'Escape' && drag) { stop(event); cancel() }
    }
    const update = () => {
      const camera = viewer.scene.getActiveCamera()
      const canvas = viewer.renderer.domElement.getBoundingClientRect()
      const parent = host.getBoundingClientRect()
      const faces = CLIPPING_FACES.map((face, index) => ({
        ...projectClippingFace(volume, face, camera, canvas.width, canvas.height), index,
      })).sort((a, b) => b.depth - a.depth || a.index - b.index)
      faces.forEach((face, order) => {
        const group = groups[face.index]
        // Keep a captured button mounted even when dragging its face outside the viewport.
        group.style.visibility = face.visible || drag?.button.parentElement === group ? 'visible' : 'hidden'
        group.style.left = `${canvas.left - parent.left + face.x}px`
        group.style.top = `${canvas.top - parent.top + face.y}px`
        group.style.zIndex = String(order + 1)
      })
      if (drag) {
        const center = getClippingFace(volume, drag.start.face).center.project(camera)
        angle.style.left = `${canvas.left - parent.left + (center.x + 1) * canvas.width / 2}px`
        angle.style.top = `${canvas.top - parent.top + (1 - center.y) * canvas.height / 2 + 24}px`
      }
      frame = win.requestAnimationFrame(update)
    }
    root.addEventListener('pointerdown', down)
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerup', up)
    root.addEventListener('pointercancel', cancel)
    root.addEventListener('lostpointercapture', cancel)
    // Stop compatibility mouse events before they reach Potree's canvas controls.
    root.addEventListener('mousedown', stop)
    root.addEventListener('click', stop)
    win.addEventListener('keydown', escape, true)
    win.addEventListener('blur', cancel)
    update()
    return () => {
      cancel()
      win.cancelAnimationFrame(frame)
      root.removeEventListener('pointerdown', down)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerup', up)
      root.removeEventListener('pointercancel', cancel)
      root.removeEventListener('lostpointercapture', cancel)
      root.removeEventListener('mousedown', stop)
      root.removeEventListener('click', stop)
      win.removeEventListener('keydown', escape, true)
      win.removeEventListener('blur', cancel)
      root.remove()
      if (positioned && host.style.position === 'relative') host.style.position = oldPosition
    }
}
