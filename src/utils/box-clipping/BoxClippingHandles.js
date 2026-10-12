import * as THREE from '../../../libs/three.js/build/three.module.js'
import { CLIPPING_FACES, getClippingFace, projectClippingFace } from './potreeClippingFaces.js'

const COLORS = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 }
// Extend the original 270-degree arc to 300 degrees without changing its arrow-head layout.
const ROTATION_ARC = Math.PI * 5 / 3
const Z_AXIS = new THREE.Vector3(0, 0, 1)

/** Build lit face handles in CSS-pixel units; invisible meshes widen only the hit areas. */
export function createBoxClippingHandles() {
  const scene = new THREE.Scene()
  scene.name = 'box-clipping-handles'
  scene.add(new THREE.AmbientLight(0xffffff, 0.65))
  const light = new THREE.DirectionalLight(0xffffff, 0.8)
  scene.add(light, light.target)
  const picks = []
  const geometries = new Set()
  const materials = new Set()
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  materials.add(pickMaterial)

  // Keep each mode's material separate so hovering does not highlight its sibling.
  const faces = CLIPPING_FACES.map(face => {
    const group = new THREE.Group()
    group.name = `clipping-face-${face.id}`
    group.userData.face = face
    const normal = new THREE.Vector3()
    normal[face.axis] = face.sign
    group.userData.orientation = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, normal)
    for (const mode of ['move', 'rotate']) {
      const node = new THREE.Group()
      node.name = mode
      node.userData = { face, mode }
      const material = new THREE.MeshPhongMaterial({ color: COLORS[face.axis], shininess: 45 })
      materials.add(material)
      const add = (geometry, position, pickGeometry) => {
        geometries.add(geometry)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.copy(position)
        node.add(mesh)
        geometries.add(pickGeometry)
        const pick = new THREE.Mesh(pickGeometry, pickMaterial)
        pick.position.copy(position)
        pick.userData.handle = node
        node.add(pick)
        picks.push(pick)
      }
      if (mode === 'move') {
        add(new THREE.CylinderGeometry(2.5, 2.5, 28, 12).rotateX(Math.PI / 2),
          new THREE.Vector3(0, 0, 14),
          new THREE.CylinderGeometry(5, 5, 28, 8).rotateX(Math.PI / 2))
        add(new THREE.ConeGeometry(5.5, 12, 16).rotateX(Math.PI / 2),
          new THREE.Vector3(0, 0, 34),
          new THREE.ConeGeometry(7, 14, 12).rotateX(Math.PI / 2))
      } else {
        add(new THREE.TorusGeometry(16, 2.5, 8, 48, ROTATION_ARC),
          new THREE.Vector3(0, 0, 12),
          new THREE.TorusGeometry(16, 5, 8, 48, ROTATION_ARC))
        // Keep the original head base at the arc endpoint and extend it along the tangent.
        const end = new THREE.Vector3(16 * Math.cos(ROTATION_ARC), 16 * Math.sin(ROTATION_ARC), 12)
        const tangent = new THREE.Vector3(-Math.sin(ROTATION_ARC), Math.cos(ROTATION_ARC), 0)
        const headCenter = end.addScaledVector(tangent, 6)
        add(new THREE.ConeGeometry(5, 12, 16).rotateZ(ROTATION_ARC),
          headCenter,
          new THREE.ConeGeometry(7, 14, 12).rotateZ(ROTATION_ARC))
      }
      group.add(node)
    }
    scene.add(group)
    return group
  })
  const raycaster = new THREE.Raycaster()

  /** Keep world orientation and compensate both perspective distance and orthographic zoom. */
  const update = (volume, camera, width, height) => {
    for (const group of faces) {
      const face = group.userData.face
      const { center } = getClippingFace(volume, face)
      const projected = projectClippingFace(volume, face, camera, width, height)
      const ndc = center.clone().project(camera)
      const adjacent = ndc.clone()
      adjacent.x += 2 / width
      const scale = adjacent.unproject(camera).distanceTo(center)
      group.visible = width > 0 && height > 0 && projected.visible && Number.isFinite(scale) && scale > 0
      group.position.copy(center)
      group.quaternion.copy(volume.quaternion).multiply(group.userData.orientation)
      group.scale.setScalar(scale)
    }
    // A camera-relative key light makes thickness readable without relying on host scene lights.
    light.target.position.copy(volume.position)
    light.position.copy(volume.position).add(new THREE.Vector3(-1, 2, 3).applyQuaternion(camera.quaternion))
    scene.updateMatrixWorld(true)
  }

  /** Start the ray at the near plane, including Potree's negative orthographic near range. */
  const pick = (camera, x, y) => {
    const near = new THREE.Vector3(x, y, -1).unproject(camera)
    const far = new THREE.Vector3(x, y, 1).unproject(camera)
    raycaster.set(near, far.clone().sub(near).normalize())
    raycaster.near = 0
    raycaster.far = near.distanceTo(far)
    const hits = raycaster.intersectObjects(picks.filter(mesh => mesh.parent.parent.visible), false)
    return hits[0]?.object.userData.handle ?? null
  }

  /** Highlight only the hovered or captured handle, preserving the axis color. */
  const highlight = handle => {
    for (const face of faces) {
      for (const node of face.children) {
        node.children[0].material.emissive.setHex(node === handle ? 0x555555 : 0x000000)
      }
    }
  }

  // Shared geometry and material sets guarantee exactly one disposal per owned GPU resource.
  const dispose = () => {
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    scene.clear()
  }
  return { scene, faces, update, pick, highlight, dispose }
}
