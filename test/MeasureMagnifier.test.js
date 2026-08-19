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
		scene: {
			pointclouds: [],
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
	it('uses an opaque circular image and transparent shader-based ring', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)

		expect(magnifier._circleMesh.geometry.type).toBe('CircleGeometry')
		expect(magnifier._circleMaterial.transparent).toBe(false)
		// Potree's main renderer outputs linear values, so the lens target must not decode again.
		expect(magnifier._renderTarget.texture.encoding).toBe(THREE.LinearEncoding)
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
		perspective.zoom = 2.5
		perspective.position.set(0, 0, 10)
		perspective.lookAt(target)
		perspective.updateProjectionMatrix()
		perspective.updateMatrixWorld()

		const perspectiveLens = magnifier._configureCamera(
			perspective,
			target,
			layout,
			hostRect
		)

		expect(perspectiveLens.isPerspectiveCamera).toBe(true)
		expect(perspectiveLens.fov).toBeLessThan(perspective.fov)
		expect(perspectiveLens.zoom).toBe(1)
		expect(perspectiveLens.position.equals(perspective.position)).toBe(true)
		const sourceViewHeight = 2 * Math.tan(
			THREE.MathUtils.degToRad(perspective.getEffectiveFOV()) / 2
		) * 10
		const lensViewHeight = 2 * Math.tan(
			THREE.MathUtils.degToRad(perspectiveLens.getEffectiveFOV()) / 2
		) * 10
		expect(lensViewHeight).toBeCloseTo(sourceViewHeight * 144 / 900 / 2)

		const orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
		orthographic.position.set(0, 0, 10)
		orthographic.zoom = 1000
		orthographic.lookAt(target)
		orthographic.updateProjectionMatrix()
		orthographic.updateMatrixWorld()

		const orthographicLens = magnifier._configureCamera(
			orthographic,
			target,
			layout,
			hostRect
		)

		expect(orthographicLens.isOrthographicCamera).toBe(true)
		expect(orthographicLens.top - orthographicLens.bottom).toBeCloseTo(0.0016)
		expect(orthographicLens.top - orthographicLens.bottom).toBeLessThan(0.6)
		expect(orthographicLens.position.equals(orthographic.position)).toBe(true)

		magnifier.destroy()
	})

	it('keeps the overlay diameter stable for a zoomed perspective camera', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)
		const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000)
		camera.zoom = 2.5
		camera.position.set(0, 0, 10)
		camera.lookAt(0, 0, 0)
		camera.updateProjectionMatrix()
		camera.updateMatrixWorld()
		const hostRect = {width: 800, height: 600}
		const layout = {centerX: 400, centerY: 300, diameter: 144}

		// Project the world-space lens edges to verify the fixed screen-space diameter.
		const transform = magnifier._resolveOverlayTransform(camera, layout, hostRect)
		const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
		const leftNdc = transform.center.clone().addScaledVector(right, -transform.radius).project(camera)
		const rightNdc = transform.center.clone().addScaledVector(right, transform.radius).project(camera)
		const projectedDiameter = (rightNdc.x - leftNdc.x) * hostRect.width / 2

		expect(projectedDiameter).toBeCloseTo(layout.diameter)
		magnifier.destroy()
	})

	it('rejects an invalid perspective projection', () => {
		const viewer = createViewer()
		const magnifier = new MeasureMagnifier(viewer)
		const camera = new THREE.PerspectiveCamera(0, 1, 0.1, 1000)
		camera.position.set(0, 0, 10)
		camera.lookAt(0, 0, 0)
		camera.updateProjectionMatrix()
		camera.updateMatrixWorld()

		const result = magnifier._configureCamera(
			camera,
			new THREE.Vector3(0, 0, 0),
			{diameter: 144},
			{height: 900}
		)

		expect(result).toBeNull()
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
		const previousClearColor = new THREE.Color('#123456')
		let currentClearColor = previousClearColor.clone()
		let currentClearAlpha = 0.25
		let currentTarget = previousTarget
		let magnifierClearColor = null
		let magnifierClearAlpha = null
		let overlayAutoClear = null
		let overlayVisibility = null
		let overlayMarkerScale = null
		let magnifier
		// Use a non-uniform source scale to prove exact restoration after rendering.
		const marker = new THREE.Sprite()
		marker.scale.set(2, 3, 1)

		viewer.scene = {
			measurements: [{spheres: [marker]}],
			scenePointCloud: new THREE.Scene(),
			volumes: [],
		}
		viewer.renderer.domElement.style = {backgroundColor: '#494946'}
		const effectRenderer = {render: vi.fn()}
		viewer.getPRenderer = vi.fn(() => effectRenderer)
		Object.assign(viewer.renderer, {
			autoClear: false,
			clear: vi.fn(() => {
				if (currentTarget === magnifier?._renderTarget) {
					magnifierClearColor = currentClearColor.getHexString()
					magnifierClearAlpha = currentClearAlpha
				}
			}),
			clearDepth: vi.fn(),
			getClearAlpha: vi.fn(() => currentClearAlpha),
			getClearColor: vi.fn((target) => target.copy(currentClearColor)),
			getRenderTarget: vi.fn(() => previousTarget),
			render: vi.fn((scene) => {
				if (scene === viewer.measuringTool.scene) {
					overlayAutoClear = viewer.renderer.autoClear
					overlayVisibility = [magnifier._circleMesh.visible, magnifier._ringMesh.visible]
					overlayMarkerScale = marker.scale.toArray()
				}
			}),
			setClearColor: vi.fn((color, alpha) => {
				currentClearColor = new THREE.Color(color)
				currentClearAlpha = alpha
			}),
			setRenderTarget: vi.fn((target) => {
				currentTarget = target
			}),
		})

		magnifier = new MeasureMagnifier(viewer)
		magnifier._circleMesh.visible = true
		magnifier._ringMesh.visible = true
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

		magnifier._renderToTarget(camera)

		expect(viewer.getPRenderer).toHaveBeenCalledOnce()
		expect(effectRenderer.render).toHaveBeenCalledWith({
			camera,
			offscreen: true,
			skipBackground: true,
			target: magnifier._renderTarget,
		})
		expect(viewer.renderer.clearDepth).toHaveBeenCalledOnce()
		expect(viewer.renderer.render).toHaveBeenCalledWith(viewer.measuringTool.scene, camera)
		expect(overlayAutoClear).toBe(false)
		expect(overlayVisibility).toEqual([false, false])
		expect(overlayMarkerScale).toEqual([1, 1.5, 0.5])
		expect(magnifierClearColor).toBe('494946')
		expect(magnifierClearAlpha).toBe(1)
		expect(marker.scale.toArray()).toEqual([2, 3, 1])
		expect(magnifier._circleMesh.visible).toBe(true)
		expect(magnifier._ringMesh.visible).toBe(true)
		expect(viewer.renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget)
		expect(viewer.renderer.autoClear).toBe(false)
		expect(currentClearColor.getHexString()).toBe(previousClearColor.getHexString())
		expect(currentClearAlpha).toBe(0.25)

		magnifier.destroy()
	})

	it('restores the shared skybox camera after the off-screen render', () => {
		const viewer = createViewer()
		const skyboxCamera = new THREE.PerspectiveCamera(70, 1.5, 0.1, 1000)
		skyboxCamera.rotation.set(0.1, 0.2, 0.3)
		const originalSkyboxRotation = skyboxCamera.rotation.clone()
		viewer.background = 'skybox'
		viewer.skybox = {camera: skyboxCamera, scene: new THREE.Scene()}
		viewer.scene = {
			measurements: [],
			scenePointCloud: new THREE.Scene(),
			volumes: [],
		}
		viewer.pRenderer = {render: vi.fn()}
		Object.assign(viewer.renderer, {
			autoClear: false,
			clear: vi.fn(),
			clearDepth: vi.fn(),
			getClearAlpha: vi.fn(() => 0.25),
			getClearColor: vi.fn((target) => target.setHex(0x123456)),
			getRenderTarget: vi.fn(() => null),
			render: vi.fn(),
			setClearColor: vi.fn(),
			setRenderTarget: vi.fn(),
		})
		const magnifier = new MeasureMagnifier(viewer)
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

		magnifier._renderToTarget(camera)

		// The shared skybox camera must remain unchanged for later render-pass listeners.
		expect(skyboxCamera.fov).toBe(70)
		expect(skyboxCamera.aspect).toBe(1.5)
		expect(skyboxCamera.rotation.equals(originalSkyboxRotation)).toBe(true)

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

	it('does not mutate shared point-cloud material point-size modes', () => {
		const viewer = createViewer()
		const adaptiveMaterial = {pointSizeType: 2}
		const fixedMaterial = {pointSizeType: 0}
		viewer.scene.pointclouds.push(
			{material: adaptiveMaterial},
			{material: fixedMaterial},
		)
		const magnifier = new MeasureMagnifier(viewer)

		magnifier.start()

		magnifier.stop()

		expect(adaptiveMaterial.pointSizeType).toBe(2)
		expect(fixedMaterial.pointSizeType).toBe(0)

		magnifier.destroy()
	})
})
