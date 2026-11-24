import * as THREE from '../../libs/three.js/build/three.module.js';
import { CameraMode } from '../defines.js';
import { ControlPointCropOverlay } from './control-point-crop/ControlPointCropOverlay.js';
import { createControlPointCropVolume, setControlPointCropVolume } from './control-point-crop/controlPointCropVolume.js';

/** Owns a transient preview and a confirmed, in-memory clip in one viewer scene. */
export class ControlPointCropTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.preview = null;
    this.confirmed = null;
    this.overlay = null;
    this.onCloudAdded = ({ pointcloud }) => this.apply(pointcloud);
    this.onCloudRemoved = ({ pointcloud }) => setControlPointCropVolume(pointcloud, null);
    this.onSceneChanged = () => viewer.clearControlPointCrop();
    this.scene.addEventListener('pointcloud_added', this.onCloudAdded);
    this.scene.addEventListener('pointcloud_removed', this.onCloudRemoved);
    viewer.addEventListener('scene_changed', this.onSceneChanged);
  }

  setPreview({ points, selectedIds, zMin, zMax, onPointToggle, viewport }) {
    const selected = new Set(selectedIds);
    const visiblePoints = points.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
    const perimeter = visiblePoints.filter(({ id }) => selected.has(id));
    this.preview = { volume: createControlPointCropVolume(perimeter, zMin, zMax) };
    if (!this.overlay) {
      const { viewer } = this;
      const controls = viewer.fjdCameraControls;
      const bounds = new THREE.Box3();
      if (Number.isFinite(zMin) && Number.isFinite(zMax)) {
        for (const { x, y } of visiblePoints) {
          bounds.expandByPoint(new THREE.Vector3(x, y, zMin));
          bounds.expandByPoint(new THREE.Vector3(x, y, zMax));
        }
      }
      const pose = bounds.isEmpty() ? controls.getRigidPose(false) : null;
      // Switch projection once, when the editor opens.
      viewer.setViewMode('3d', { animate: false });
      viewer.setControls(controls);
      viewer.setCameraMode(CameraMode.ORTHOGRAPHIC);
      // Full-canvas embeds use the same fit without a sidebar exclusion.
      if (pose) {
        controls.setRigidPose(pose, false);
      } else {
        controls.fitToTopViewBox(bounds, false, { viewport, viewportOccupancy: 0.76 });
      }
      this.overlay = new ControlPointCropOverlay(this.viewer);
    }
    this.overlay.update({ points: visiblePoints, perimeter, selected, zMin, zMax, onPointToggle });
    this.apply();
  }

  apply(cloud) {
    // An incomplete draft shows the full cloud rather than the previous result.
    const volume = this.preview ? this.preview.volume : this.confirmed;
    for (const pointcloud of cloud ? [cloud] : this.scene.pointclouds) {
      setControlPointCropVolume(pointcloud, volume);
    }
  }

  cancel() {
    this.overlay?.dispose();
    this.overlay = null;
    this.preview = null;
    this.apply();
  }

  confirm() {
    if (!this.preview?.volume || !this.scene.pointclouds.some(cloud => cloud.visible)) return false;
    this.confirmed = this.preview.volume;
    this.cancel();
    return true;
  }

  dispose() {
    this.confirmed = null;
    this.cancel();
    this.scene.removeEventListener('pointcloud_added', this.onCloudAdded);
    this.scene.removeEventListener('pointcloud_removed', this.onCloudRemoved);
    this.viewer.removeEventListener('scene_changed', this.onSceneChanged);
  }
}
