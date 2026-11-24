import { describe, expect, it, vi } from 'vitest';
import * as THREE from '../libs/three.js/build/three.module.js';
import { CameraMode } from '../src/defines.js';
import { EventDispatcher } from '../src/EventDispatcher.js';
import { ControlPointCropTool } from '../src/utils/ControlPointCropTool.js';
import { createControlPointCropVolume, getControlPointCropVolume } from '../src/utils/control-point-crop/controlPointCropVolume.js';

const points = [
  { id: 1, x: -2, y: -2, z: 0.2 },
  { id: 2, x: 2, y: -2, z: 0.3 },
  { id: 3, x: 2, y: 2, z: 0.4 },
  { id: 4, x: -2, y: 2, z: 0.5 },
];

function fixture() {
  const renderArea = document.createElement('div');
  Object.defineProperties(renderArea, { clientWidth: { value: 600 }, clientHeight: { value: 500 } });
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
  camera.up.set(0, 0, 1);
  camera.position.set(14, -18, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cloud = { visible: true };
  const perspective = new THREE.PerspectiveCamera();
  const scene = Object.assign(new EventDispatcher(), {
    pointclouds: [cloud],
    cameraMode: CameraMode.PERSPECTIVE,
    getActiveCamera: () => scene.cameraMode === CameraMode.ORTHOGRAPHIC ? camera : perspective,
  });
  const viewer = Object.assign(new EventDispatcher(), {
    scene,
    renderArea,
    controls: {},
    fjdCameraControls: { fitToTopViewBox: vi.fn(), setRigidPose: vi.fn(), getRigidPose: () => ({}) },
    setViewMode() {},
    setControls(controls) { this.controls = controls; },
    setCameraMode(mode) { scene.cameraMode = mode; },
  });
  const tool = new ControlPointCropTool(viewer);
  viewer.clearControlPointCrop = () => tool.dispose();
  return { camera, cloud, renderArea, scene, tool, viewer };
}

describe('ControlPointCropTool', () => {
  it('switches only on entry and leaves manual projection changes in place', () => {
    const { tool, scene, camera, viewer } = fixture();
    const draft = { points, selectedIds: [1, 2, 3], zMin: 3.16, zMax: 5.75 };
    viewer.fjdCameraControls.fitToTopViewBox.mockImplementation(() => {
      // The fit must see the orthographic camera even without a host viewport.
      expect(scene.getActiveCamera()).toBe(camera);
      expect(viewer.controls).toBe(viewer.fjdCameraControls);
    });
    tool.setPreview(draft);
    expect(scene.cameraMode).toBe(CameraMode.ORTHOGRAPHIC);
    // Editing the draft must not replace a camera the user selected during the preview.
    viewer.setCameraMode(CameraMode.PERSPECTIVE);
    tool.setPreview({ ...draft, selectedIds: [1, 2] });
    expect(scene.cameraMode).toBe(CameraMode.PERSPECTIVE);
    expect(viewer.fjdCameraControls.fitToTopViewBox).toHaveBeenCalledTimes(1);
    tool.cancel();
    expect(scene.cameraMode).toBe(CameraMode.PERSPECTIVE);
    tool.setPreview(draft);
    tool.cancel();
    expect(scene.cameraMode).toBe(CameraMode.ORTHOGRAPHIC);
    tool.dispose();
  });

  it('packs a closed perimeter and rejects unsupported or degenerate drafts', () => {
    // Input z values do not participate in the volume.
    const result = createControlPointCropVolume(points, 3.16, 5.75);
    expect(result.range).toEqual([3.16, 5.75]);
    expect([...result.vertices]).toEqual([-2, -2, 2, -2, 2, 2, -2, 2, -2, -2]);
    expect(createControlPointCropVolume(points.slice(0, 2), 3.16, 5.75)).toBeNull();
    expect(createControlPointCropVolume(points, 5, 5)).toBeNull();
    expect(createControlPointCropVolume(points.map(point => ({ ...point, y: 0 })), 0, 1)).toBeNull();
  });

  it('projects lower labels from zMin and uses the first selected point for both heights', () => {
    const { tool, renderArea, cloud, camera } = fixture();
    const toggled = [];
    tool.setPreview({ points, selectedIds: [2, 3, 4], zMin: 3.16, zMax: 5.75, onPointToggle: id => toggled.push(id) });
    const labels = [...renderArea.querySelectorAll('button')];
    expect(labels.map(node => node.textContent)).toEqual(['1', '2', '3', '4']);
    expect(labels[0].getAttribute('aria-pressed')).toBe('false');
    const low = new THREE.Vector3(2, -2, 3.16).project(camera);
    expect(parseFloat(labels[1].style.top)).toBeCloseTo((1 - low.y) * 250);
    const heights = [...renderArea.querySelectorAll('.potree-control-point-crop-height')];
    expect(heights.map(node => node.textContent)).toEqual(['Z 3.16 m', 'Z 5.75 m']);
    expect(parseFloat(heights[0].style.left)).toBeCloseTo((low.x + 1) * 300 + 22);
    expect(renderArea.querySelector('path[stroke-dasharray]').getAttribute('stroke-dasharray')).toBe('6 5');
    labels[0].click();
    expect(toggled).toEqual([1]);
    expect(getControlPointCropVolume(cloud).count).toBe(3);
    tool.dispose();
  });

  it('styles crop geometry when the host skips the Potree GUI stylesheet', () => {
    const { tool, renderArea } = fixture();
    document.body.append(renderArea);
    try {
      // Match the app iframe, which loads Potree JS without the standalone GUI CSS.
      tool.setPreview({ points, selectedIds: [1, 2, 3, 4], zMin: 3.16, zMax: 5.75 });
      const overlay = renderArea.querySelector('.potree-control-point-crop');
      const button = overlay.querySelector('button');
      expect(getComputedStyle(overlay).position).toBe('absolute');
      expect(getComputedStyle(overlay).pointerEvents).toBe('none');
      expect(getComputedStyle(button).position).toBe('absolute');
      expect(getComputedStyle(button).width).toBe('30px');
      expect(overlay.querySelectorAll('style')).toHaveLength(1);
      tool.setPreview({ points, selectedIds: [1, 2, 3], zMin: 3.16, zMax: 5.75 });
      expect(overlay.querySelectorAll('style')).toHaveLength(1);
      tool.cancel();
      expect(renderArea.querySelector('style')).toBeNull();
    } finally {
      tool.dispose();
      renderArea.remove();
    }
  });

  it('keeps numbered labels and hides prism geometry below three selected points', () => {
    const { tool, renderArea, cloud } = fixture();
    const draft = { points, selectedIds: [1, 2, 3], zMin: 3.16, zMax: 5.75 };
    try {
      // Begin with a complete prism to catch stale paths and labels after deselecting.
      tool.setPreview(draft);
      const paths = [...renderArea.querySelectorAll('path')];
      const heights = [...renderArea.querySelectorAll('.potree-control-point-crop-height')];
      const labels = [...renderArea.querySelectorAll('button')];
      expect(labels).toHaveLength(4);
      expect(paths.every(path => path.getAttribute('d').length > 0)).toBe(true);
      expect(heights.every(label => !label.hidden)).toBe(true);
      for (const selectedIds of [[1, 2], [1], []]) {
        tool.setPreview({ ...draft, selectedIds });
        expect(paths.map(path => path.getAttribute('d'))).toEqual(['', '', '']);
        expect(heights.every(label => label.hidden)).toBe(true);
        expect(labels.every(label => !label.hidden)).toBe(true);
        expect(getControlPointCropVolume(cloud)).toBeUndefined();
      }
      tool.setPreview(draft);
      expect(paths.every(path => path.getAttribute('d').length > 0)).toBe(true);
      expect(heights.every(label => !label.hidden)).toBe(true);
    } finally {
      tool.dispose();
    }
  });

  it('keeps confirmed clips, restores them after cancellation and clears scene ownership', () => {
    const { tool, renderArea, cloud, scene, viewer } = fixture();
    const draft = { points, selectedIds: [1, 2, 3, 4], zMin: 3.16, zMax: 5.75 };
    expect(getControlPointCropVolume(cloud)).toBeUndefined();
    tool.setPreview(draft);
    expect(tool.confirm()).toBe(true);
    // Confirm keeps both the volume and the current projection.
    expect(scene.cameraMode).toBe(CameraMode.ORTHOGRAPHIC);
    expect(renderArea.children).toHaveLength(0);
    expect(getControlPointCropVolume(cloud).range).toEqual([3.16, 5.75]);
    tool.setPreview({ ...draft, selectedIds: [1, 2] });
    expect(getControlPointCropVolume(cloud)).toBeUndefined();
    expect(tool.confirm()).toBe(false);
    tool.cancel();
    expect(getControlPointCropVolume(cloud).range).toEqual([3.16, 5.75]);
    const incoming = { visible: true };
    scene.pointclouds.push(incoming);
    scene.dispatchEvent({ type: 'pointcloud_added', pointcloud: incoming });
    expect(getControlPointCropVolume(incoming).range).toEqual([3.16, 5.75]);
    scene.pointclouds.pop();
    scene.dispatchEvent({ type: 'pointcloud_removed', pointcloud: incoming });
    expect(getControlPointCropVolume(incoming)).toBeUndefined();
    viewer.dispatchEvent({ type: 'scene_changed' });
    expect(getControlPointCropVolume(cloud)).toBeUndefined();
  });
});
