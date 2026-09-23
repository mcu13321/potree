import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Box3, Object3D, Vector3 } from '../libs/three.js/build/three.module.js'
import { buildOutsideClipBoxes } from '../src/utils/box-clipping/potreeOutsideClipBoxes.js'

// Match Potree's normalized box containment before the SHOW_OUTSIDE inversion.
const inside = (point, entry) => {
  const p = point.clone().applyMatrix4(entry.inverse)
  return Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) <= .5
}
const entry = (box) => { box.updateMatrixWorld(true); return { box, inverse: box.matrixWorld.clone().invert() } }

test('outside clipping keeps only points inside a height slab and outside the rotated owned box', () => {
  const cloud = { getBoundingBoxWorld: () => new Box3(new Vector3(-8, -8, -8), new Vector3(8, 8, 8)) }
  const volume = new Object3D();volume.scale.set(5, 3, 6);volume.rotation.z=.6
  const height = new Object3D();height.scale.set(20, 20, 4)
  for (const z of [-2, 1, 3]) {
    height.position.z=z
    const own=entry(volume), slab=entry(height)
    const boxes=buildOutsideClipBoxes(cloud,volume,[own,slab])
    for(let x=-7.7;x<8;x+=1.1)for(let y=-7.7;y<8;y+=1.1)for(let h=-7.7;h<8;h+=1.1){
      const point=new Vector3(x,y,h)
      assert.equal(!boxes.some(b=>inside(point,b)), !inside(point,own)&&inside(point,slab))
    }
  }
})

test('without business clipping only the owned exclusion remains', () => {
  const volume=new Object3D()
  const own=entry(volume)
  const cloud={getBoundingBoxWorld:()=>new Box3(new Vector3(-3,-3,-3),new Vector3(3,3,3))}
  assert.deepEqual(buildOutsideClipBoxes(cloud,volume,[own]),[own])
})
