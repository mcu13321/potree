import { describe, expect, it, vi } from 'vitest'
import * as THREE from '../libs/three.js/build/three.module.js'
import { MeasureMagnifier } from '../src/utils/MeasureMagnifier.js'

function createViewer() {
	const domListeners = new Map()
	const viewerListeners = new Map()

	return {
		addEventListener(type, listener) {
			viewerListeners.set(type, listener)
		},
		inputHandler: {
			getMousePointCloudIntersection: () => null,
			mouse: new THREE.Vector2(),
		},
		measuringTool: {
			scene: new THREE.Scene(),
		},
		removeEventListener(type) {
			viewerListeners.delete(type)
		},
		renderer: {
			domElement: {
				addEventListener(type, listener) {
					domListeners.set(type, listener)
				},
				removeEventListener(type) {
					domListeners.delete(type)
				},
			},
		},
		_domListeners: domListeners,
		_viewerListeners: viewerListeners,
	}
}

describe('MeasureMagnifier', () => {
	it('uses a transparent circular image and shader-based ring', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)

		expect(magnifier._circleMesh.geometry.type).toBe('CircleGeometry')
		expect(magnifier._circleMaterial.transparent).toBe(true)
		expect(magnifier._ringMaterial.type).toBe('ShaderMaterial')
		expect(magnifier._ringMaterial.transparent).toBe(true)

		magnifier.destroy()
	})

	it('matches the R3F screen layout and flips below the pointer near the top edge', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)
		magnifier._latestClientX = 200
		magnifier._latestClientY = 20

		const layout = magnifier._resolveLayout({left: 0, top: 0, width: 800, height: 600})

		expect(layout.diameter).toBe(144)
		expect(layout.placement).toBe('bottom')
		expect(layout.top).toBe(42)

		magnifier.destroy()
	})

	it('configures perspective and orthographic magnifier cameras', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)
		const target = new THREE.Vector3(0, 0, 0)
		const layout = {diameter: 144}
		const hostRect = {height: 900}
		const perspective = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000)
		perspective.position.set(0, 0, 10)
		perspective.lookAt(target)
		perspective.updateMatrixWorld()

		const perspectiveLens = magnifier._configureCamera(
			perspective,
			target,
			layout,
			hostRect
		)

		expect(perspectiveLens.isPerspectiveCamera).toBe(true)
		expect(perspectiveLens.fov).toBeLessThan(perspective.fov)
		expect(perspectiveLens.position.equals(perspective.position)).toBe(true)

		const orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
		orthographic.position.set(0, 0, 10)
		orthographic.zoom = 2
		orthographic.lookAt(target)
		orthographic.updateMatrixWorld()

		const orthographicLens = magnifier._configureCamera(
			orthographic,
			target,
			layout,
			hostRect
		)

		expect(orthographicLens.isOrthographicCamera).toBe(true)
		expect(orthographicLens.top - orthographicLens.bottom).toBeCloseTo(0.8)
		expect(orthographicLens.position.equals(orthographic.position)).toBe(true)

		magnifier.destroy()
	})

	it('clears stale content when the pointer no longer hits a point cloud', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)
		magnifier.active = true
		magnifier._latestPoint = new THREE.Vector3(1, 2, 3)

		magnifier._onMouseMove({clientX: 50, clientY: 60})

		expect(magnifier._latestPoint).toBeNull()
		magnifier.active = false
		magnifier.destroy()
	})

	it('renders the measurement overlay while excluding the lens meshes from its target', () => {
		const viewer = createViewer()
		const previousTarget = {name: 'main-target'}
		let overlayAutoClear = null
		let overlayVisibility = null
		let magnifier

		viewer.scene = {
			scenePointCloud: new THREE.Scene(),
			volumes: [],
		}
		viewer.pRenderer = {render: vi.fn()}
		Object.assign(viewer.renderer, {
			autoClear: false,
			clear: vi.fn(),
			clearDepth: vi.fn(),
			getRenderTarget: vi.fn(() => previousTarget),
			render: vi.fn((scene) => {
				if (scene === viewer.measuringTool.scene) {
					overlayAutoClear = viewer.renderer.autoClear
					overlayVisibility = [magnifier._circleMesh.visible, magnifier._ringMesh.visible]
				}
			}),
			setRenderTarget: vi.fn(),
		})

		magnifier = new MeasureMagnifier(viewer)
		magnifier._circleMesh.visible = true
		magnifier._ringMesh.visible = true
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

		magnifier._renderToTarget(camera)

		expect(viewer.pRenderer.render).toHaveBeenCalledWith(
			viewer.scene.scenePointCloud,
			camera,
			magnifier._renderTarget,
			expect.any(Object)
		)
		expect(viewer.renderer.clearDepth).toHaveBeenCalledOnce()
		expect(viewer.renderer.render).toHaveBeenCalledWith(viewer.measuringTool.scene, camera)
		expect(overlayAutoClear).toBe(false)
		expect(overlayVisibility).toEqual([false, false])
		expect(magnifier._circleMesh.visible).toBe(true)
		expect(magnifier._ringMesh.visible).toBe(true)
		expect(viewer.renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget)
		expect(viewer.renderer.autoClear).toBe(false)

		magnifier.destroy()
	})

	it('registers and removes pointer and render listeners with its lifecycle', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)

		magnifier.start()
		expect(viewer._domListeners.has('mousemove')).toBe(true)
		expect(viewer._viewerListeners.has('render.pass.end')).toBe(true)

		magnifier.stop()
		expect(viewer._domListeners.has('mousemove')).toBe(false)
		expect(viewer._viewerListeners.has('render.pass.end')).toBe(false)

		magnifier.destroy()
	})
})
