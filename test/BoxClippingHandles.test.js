import { expect, test, vi } from 'vitest'
import { Object3D, PerspectiveCamera, OrthographicCamera, Vector3 } from '../libs/three.js/build/three.module.js'
import { createBoxClippingHandles } from '../src/utils/box-clipping/BoxClippingHandles.js'
import { getClippingFace } from '../src/utils/box-clipping/potreeClippingFaces.js'

// Real Three geometry verifies shape orientation and picking without a WebGL renderer.
function fixture(orthographic = false) {
  const handles = createBoxClippingHandles()
  const volume = new Object3D()
  volume.scale.set(8, 6, 4)
  const camera = orthographic ? new OrthographicCamera(-15,15,10,-10,-100,100)
    : new PerspectiveCamera(60,1.5,.1,1000)
  camera.position.set(0,0,20)
  camera.lookAt(0,0,0)
  camera.updateMatrixWorld(true)
  handles.update(volume,camera,900,600)
  return { handles, volume, camera }
}

// Non-uniform dimensions must never distort either the arrow or the enclosing arc.
test.each([false,true])('six outward handles retain world orientation and CSS size (ortho=%s)', ortho => {
  const {handles,volume,camera} = fixture(ortho)
  volume.rotation.set(.2,.4,-.3)
  handles.update(volume,camera,900,600)
  expect(handles.faces).toHaveLength(6)
  for(const group of handles.faces) {
    const face=getClippingFace(volume,group.userData.face)
    expect(group.position.distanceTo(face.center)).toBeLessThan(1e-9)
    expect(new Vector3(0,0,1).applyQuaternion(group.quaternion).distanceTo(face.normal)).toBeLessThan(1e-9)
    expect(group.scale.x).toBe(group.scale.y)
    expect(group.scale.x).toBe(group.scale.z)
    expect(group.children.map(node=>node.name)).toEqual(['move','rotate'])
    const ndc=group.position.clone().project(camera)
    const next=ndc.clone(); next.x+=2/900
    expect(next.unproject(camera).distanceTo(group.position)).toBeCloseTo(group.scale.x)
  }
  const before=handles.faces[0].scale.x
  if(ortho) { camera.zoom=2; camera.updateProjectionMatrix() }
  else { camera.position.z=40; camera.updateMatrixWorld(true) }
  handles.update(volume,camera,900,600)
  if(ortho) expect(handles.faces[0].scale.x).toBeCloseTo(before/2)
  else expect(handles.faces[0].scale.x).toBeGreaterThan(before)
  handles.dispose()
})

// Near-plane rays must include negative camera depths used by Potree orthographic views.
test.each([false,true])('real entity hits choose the closer face and preserve mode (ortho=%s)', ortho => {
  const {handles,volume,camera}=fixture(ortho)
  if(ortho) { camera.position.set(0,0,0); camera.updateMatrixWorld(true) }
  handles.update(volume,camera,900,600)
  const front=handles.scene.getObjectByName('clipping-face-z+')
  for(const [point,mode] of [[new Vector3(0,0,34),'move'],[new Vector3(16,0,12),'rotate']]) {
    const ndc=front.localToWorld(point).project(camera)
    const hit=handles.pick(camera,ndc.x,ndc.y)
    expect(hit.userData.face.id).toBe('z+')
    expect(hit.userData.mode).toBe(mode)
  }
  expect(handles.pick(camera,.98,.98)).toBeNull()
  volume.position.x=10000
  handles.update(volume,camera,900,600)
  expect(handles.faces.every(face=>!face.visible)).toBe(true)
  expect(handles.pick(camera,0,0)).toBeNull()
  handles.dispose()
})

// Each mode owns its highlight; disposal frees every mesh resource exactly once.
test('highlight is isolated and every owned geometry/material is disposed', () => {
  const {handles}=fixture()
  const group=handles.faces[0], [move,rotate]=group.children
  expect(move.children[0].material.color.getHex()).toBe(0xef4444)
  handles.highlight(rotate)
  expect(rotate.children[0].material.emissive.getHex()).toBe(0x555555)
  expect(move.children[0].material.emissive.getHex()).toBe(0)
  const resources=new Set()
  handles.scene.traverse(node=>{if(node.isMesh){resources.add(node.geometry);resources.add(node.material)}})
  const spies=[...resources].map(resource=>vi.spyOn(resource,'dispose'))
  handles.dispose()
  spies.forEach(spy=>expect(spy).toHaveBeenCalledOnce())
  expect(handles.scene.children).toHaveLength(0)
})

// Preserve the original arrow connection while extending the visible and pickable arc to 300 degrees.
test('rotation uses a 300-degree arc with the original head base at its endpoint', () => {
  const {handles}=fixture()
  const sweep=Math.PI*5/3
  for(const face of handles.faces) {
    const [arc,pickArc,head,pickHead]=face.getObjectByName('rotate').children
    expect(arc.geometry.parameters.arc).toBeCloseTo(sweep)
    expect(pickArc.geometry.parameters.arc).toBeCloseTo(sweep)
    const end=new Vector3(16*Math.cos(sweep),16*Math.sin(sweep),12)
    const tangent=new Vector3(-Math.sin(sweep),Math.cos(sweep),0)
    expect(head.position.clone().addScaledVector(tangent,-6).distanceTo(end)).toBeLessThan(1e-9)
    expect(pickHead.position.equals(head.position)).toBe(true)
  }
  handles.dispose()
})
