import * as THREE from '../../libs/three.js/build/three.module.js'

const RENDER_SIZE = 192
const MAGNIFIER_DIAMETER_PX = 144
const MAGNIFICATION = 2
const POINTER_OFFSET_PX = 22
const EDGE_MARGIN_PX = 8
const DEFAULT_FOV = 24
const DEFAULT_CAMERA_ZOOM = 1
const MAGNIFIER_CIRCLE_SEGMENTS = 128

const RING_OUTER_RADIUS = 1.07
const RING_INNER_RADIUS = 1 / RING_OUTER_RADIUS
const RING_EDGE_SOFTNESS = 0.018
const RING_OPACITY = 0.9

const RING_VERTEX_SHADER = `
	varying vec2 vUv;

	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`

const RING_FRAGMENT_SHADER = `
	uniform vec3 uColor;
	uniform float uEdgeSoftness;
	uniform float uInnerRadius;
	uniform float uOpacity;
	varying vec2 vUv;

	void main() {
		vec2 centered = vUv * 2.0 - 1.0;
		float radius = length(centered);
		float outerAlpha = 1.0 - smoothstep(1.0 - uEdgeSoftness, 1.0, radius);
		float innerAlpha = smoothstep(uInnerRadius - uEdgeSoftness, uInnerRadius + uEdgeSoftness, radius);
		float alpha = outerAlpha * innerAlpha * uOpacity;

		if (alpha <= 0.001) {
			discard;
		}

		gl_FragColor = vec4(uColor, alpha);
	}
`

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value))
}

export class MeasureMagnifier {
	constructor(viewer) {
		this.viewer = viewer
		this.active = false
		this._latestPoint = null
		this._latestClientX = 0
		this._latestClientY = 0
		this._renderTarget = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
			depthBuffer: true,
			samples: 0,
			stencilBuffer: false,
		})
		this._renderTarget.texture.generateMipmaps = false
		// Match Potree's linear renderer output so CSS background colors are not decoded twice.
		this._renderTarget.texture.encoding = THREE.LinearEncoding

		this._magnifierCameras = {
			orthographic: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
			perspective: new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1000),
		}

		const circleGeo = new THREE.CircleGeometry(1, MAGNIFIER_CIRCLE_SEGMENTS)
		this._circleMaterial = new THREE.MeshBasicMaterial({
			map: this._renderTarget.texture,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			toneMapped: false,
		})
		this._circleMesh = new THREE.Mesh(circleGeo, this._circleMaterial)
		this._circleMesh.visible = false
		this._circleMesh.renderOrder = 100000
		this._circleMesh.frustumCulled = false

		const ringGeo = new THREE.PlaneGeometry(RING_OUTER_RADIUS * 2, RING_OUTER_RADIUS * 2)
		this._ringMaterial = new THREE.ShaderMaterial({
			depthTest: false,
			depthWrite: false,
			fragmentShader: RING_FRAGMENT_SHADER,
			transparent: true,
			uniforms: {
				uColor: {value: new THREE.Color('#ffffff')},
				uEdgeSoftness: {value: RING_EDGE_SOFTNESS},
				uInnerRadius: {value: RING_INNER_RADIUS},
				uOpacity: {value: RING_OPACITY},
			},
			vertexShader: RING_VERTEX_SHADER,
			toneMapped: false,
		})
		this._ringMesh = new THREE.Mesh(ringGeo, this._ringMaterial)
		this._ringMesh.visible = false
		this._ringMesh.renderOrder = 100001
		this._ringMesh.frustumCulled = false

		viewer.measuringTool.scene.add(this._circleMesh)
		viewer.measuringTool.scene.add(this._ringMesh)

		this._onMouseMove = this._onMouseMove.bind(this)
		this._onRenderOverlay = this._onRenderOverlay.bind(this)
	}

	start() {
		if (this.active) return
		this.active = true
		const el = this.viewer.renderer.domElement
		el.addEventListener('mousemove', this._onMouseMove)
		this.viewer.addEventListener('render.pass.end', this._onRenderOverlay)
	}

	stop() {
		if (!this.active) return
		this.active = false

		const el = this.viewer.renderer.domElement
		el.removeEventListener('mousemove', this._onMouseMove)
		this.viewer.removeEventListener('render.pass.end', this._onRenderOverlay)
		this._circleMesh.visible = false
		this._ringMesh.visible = false
		this._latestPoint = null
	}

	destroy() {
		this.stop()
		this.viewer.measuringTool.scene.remove(this._circleMesh)
		this.viewer.measuringTool.scene.remove(this._ringMesh)
		this._circleMaterial.dispose()
		this._ringMaterial.dispose()
		this._circleMesh.geometry.dispose()
		this._ringMesh.geometry.dispose()
		this._renderTarget.dispose()
	}

	_onMouseMove(event) {
		if (!this.active) return

		this._latestClientX = event.clientX
		this._latestClientY = event.clientY

		const intersection = this.viewer.inputHandler.getMousePointCloudIntersection(
			this.viewer.inputHandler.mouse
		)

		this._latestPoint = intersection?.location ? intersection.location.clone() : null
	}

	_onRenderOverlay() {
		if (!this.active) return

		const camera = this.viewer.scene.getActiveCamera()
		const renderer = this.viewer.renderer
		const hostRect = renderer.domElement.getBoundingClientRect()

		const layout = this._resolveLayout(hostRect)
		if (!layout || !this._latestPoint) {
			this._circleMesh.visible = false
			this._ringMesh.visible = false
			return
		}

		const targetPoint = this._latestPoint

		const magnifierCamera = this._configureCamera(camera, targetPoint, layout, hostRect)
		if (!magnifierCamera) {
			this._circleMesh.visible = false
			this._ringMesh.visible = false
			return
		}
		this._renderToTarget(magnifierCamera)

		const transform = this._resolveOverlayTransform(camera, layout, hostRect)
		if (!transform) {
			this._circleMesh.visible = false
			this._ringMesh.visible = false
			return
		}

		const center = transform.center
		const radius = transform.radius

		this._circleMesh.position.copy(center)
		this._circleMesh.scale.setScalar(radius)
		this._circleMesh.quaternion.copy(camera.quaternion)
		this._circleMesh.visible = true

		this._ringMesh.position.copy(center)
		this._ringMesh.scale.setScalar(radius)
		this._ringMesh.quaternion.copy(camera.quaternion)
		this._ringMesh.visible = true
	}

	_resolveLayout(hostRect) {
		const clientX = this._latestClientX
		const clientY = this._latestClientY

		if (!hostRect || hostRect.width <= EDGE_MARGIN_PX * 2 || hostRect.height <= EDGE_MARGIN_PX * 2) {
			return null
		}

		const localX = clientX - hostRect.left
		const localY = clientY - hostRect.top
		const diameter = clamp(
			MAGNIFIER_DIAMETER_PX,
			24,
			Math.min(hostRect.width - EDGE_MARGIN_PX * 2, hostRect.height - EDGE_MARGIN_PX * 2)
		)
		const topCandidate = localY - POINTER_OFFSET_PX - diameter
		const bottomCandidate = localY + POINTER_OFFSET_PX
		const preferredTop = topCandidate >= EDGE_MARGIN_PX
		const unclampedTop = preferredTop ? topCandidate : bottomCandidate
		const left = clamp(
			localX - diameter / 2,
			EDGE_MARGIN_PX,
			hostRect.width - diameter - EDGE_MARGIN_PX
		)
		const top = clamp(
			unclampedTop,
			EDGE_MARGIN_PX,
			hostRect.height - diameter - EDGE_MARGIN_PX
		)

		return {
			diameter,
			left,
			top,
			centerX: left + diameter / 2,
			centerY: top + diameter / 2,
			placement: preferredTop ? 'top' : 'bottom',
		}
	}

	_configureCamera(sourceCamera, targetPoint, layout, hostRect) {
		const target = targetPoint.clone()
		const viewportHeight = hostRect.height || 1
		const safeDiameter = layout.diameter || MAGNIFIER_DIAMETER_PX
		const ratio = safeDiameter / viewportHeight / MAGNIFICATION
		const zoom = sourceCamera.zoom && sourceCamera.zoom > 0
			? sourceCamera.zoom
			: DEFAULT_CAMERA_ZOOM

		// Match the R3F orthographic lens by narrowing the visible world-space span.
		if (sourceCamera.isOrthographicCamera) {
			const sourceSpan = (sourceCamera.top - sourceCamera.bottom) / zoom
			const span = sourceSpan * ratio
			if (!Number.isFinite(span) || span <= 0) return null
			const halfSpan = span / 2
			const camera = this._magnifierCameras.orthographic
			camera.left = -halfSpan
			camera.right = halfSpan
			camera.top = halfSpan
			camera.bottom = -halfSpan
			camera.near = sourceCamera.near
			camera.far = sourceCamera.far
			camera.position.copy(sourceCamera.position)
			camera.up.copy(sourceCamera.up)
			camera.lookAt(target)
			camera.updateProjectionMatrix()
			camera.updateMatrixWorld()
			return camera
		}

		const sourceDistance = Math.max(sourceCamera.position.distanceTo(target), 1)
		const effectiveFov = typeof sourceCamera.getEffectiveFOV === 'function'
			? sourceCamera.getEffectiveFOV()
			: THREE.MathUtils.radToDeg(2 * Math.atan(
				Math.tan(THREE.MathUtils.degToRad(sourceCamera.fov || DEFAULT_FOV) / 2) / zoom
			))
		if (!Number.isFinite(effectiveFov) || effectiveFov <= 0) return null
		const sourceViewHeight = 2 * Math.tan(
			THREE.MathUtils.degToRad(effectiveFov) / 2
		) * sourceDistance
		const targetViewHeight = sourceViewHeight * ratio
		const targetFov = THREE.MathUtils.radToDeg(
			2 * Math.atan(targetViewHeight / 2 / sourceDistance)
		)
		if (!Number.isFinite(targetFov) || targetFov <= 0) return null

		const camera = this._magnifierCameras.perspective
		camera.aspect = 1
		camera.far = sourceCamera.far
		camera.fov = targetFov
		camera.near = sourceCamera.near
		camera.position.copy(sourceCamera.position)
		camera.up.copy(sourceCamera.up)
		// Source zoom is already represented by the effective FOV above.
		camera.zoom = DEFAULT_CAMERA_ZOOM
		camera.lookAt(target)
		camera.updateProjectionMatrix()
		camera.updateMatrixWorld()
		return camera
	}

	_renderToTarget(magnifierCamera) {
		const renderer = this.viewer.renderer
		const scene = this.viewer.scene

		const previousTarget = renderer.getRenderTarget()
		const previousAutoClear = renderer.autoClear
		const previousClearColor = renderer.getClearColor(new THREE.Color())
		const previousClearAlpha = renderer.getClearAlpha()
		const previousCircleVisible = this._circleMesh.visible
		const previousRingVisible = this._ringMesh.visible
		const savedSphereScales = []
		const skyboxCamera = this.viewer.background === 'skybox'
			? this.viewer.skybox?.camera
			: null
		const savedSkyboxState = skyboxCamera
			? {
				aspect: skyboxCamera.aspect,
				fov: skyboxCamera.fov,
				rotation: skyboxCamera.rotation.clone(),
			}
			: null

		// Compensate fixed-size measurement markers for the 2x magnified scene.
		for (const measurement of scene.measurements || []) {
			for (const sphere of measurement?.spheres || []) {
				if (!sphere?.scale) continue
				const {x, y, z} = sphere.scale
				savedSphereScales.push({sphere, x, y, z})
				sphere.scale.multiplyScalar(1 / MAGNIFICATION)
			}
		}

		// Exclude the lens meshes while rendering their shared measurement scene.
		this._circleMesh.visible = false
		this._ringMesh.visible = false

		// Always restore renderer and overlay state after the off-screen pass.
		try {
			renderer.setRenderTarget(this._renderTarget)
			renderer.autoClear = false
			this._renderBackground(magnifierCamera, previousClearColor)

			// Reuse the active effect renderer so EDL and XRAY keep their main-view compositing.
			const effectRenderer = this.viewer.getPRenderer?.()
			if (effectRenderer?.render) {
				effectRenderer.render({
					camera: magnifierCamera,
					offscreen: true,
					skipBackground: true,
					target: this._renderTarget,
				})
			} else {
				// Keep compatibility with older viewers that do not expose effect renderers.
				this.viewer.pRenderer.render(scene.scenePointCloud, magnifierCamera, this._renderTarget, {
					clipSpheres: scene.volumes.filter(
						(v) => v.constructor?.name === 'SphereVolume'
					),
				})
			}

			// Match Potree's overlay pass so the active measurement point stays visible in the lens.
			renderer.clearDepth()
			renderer.render(this.viewer.measuringTool.scene, magnifierCamera)
		} finally {
			// Restore the exact marker scales after the off-screen pass.
			for (const {sphere, x, y, z} of savedSphereScales) {
				sphere.scale.set(x, y, z)
			}
			if (skyboxCamera && savedSkyboxState) {
				// Keep the shared skybox camera unchanged for later render-pass listeners.
				skyboxCamera.aspect = savedSkyboxState.aspect
				skyboxCamera.fov = savedSkyboxState.fov
				skyboxCamera.rotation.copy(savedSkyboxState.rotation)
				skyboxCamera.updateProjectionMatrix()
				skyboxCamera.updateMatrixWorld()
			}
			renderer.setRenderTarget(previousTarget)
			renderer.setClearColor(previousClearColor, previousClearAlpha)
			renderer.autoClear = previousAutoClear
			this._circleMesh.visible = previousCircleVisible
			this._ringMesh.visible = previousRingVisible
		}
	}

	_renderBackground(magnifierCamera, fallbackColor) {
		const renderer = this.viewer.renderer
		const scene = this.viewer.scene
		const backgroundColor = fallbackColor.clone()
		const canvasBackground = renderer.domElement?.style?.backgroundColor

		// CSS-backed Potree backgrounds must be copied into the off-screen render target.
		if (this.viewer.background === 'black') {
			backgroundColor.setHex(0x000000)
		} else if (this.viewer.background === 'white') {
			backgroundColor.setHex(0xffffff)
		} else if (this.viewer.background === 'skybox' || this.viewer.background === 'gradient') {
			backgroundColor.setHex(0x000000)
		} else if (canvasBackground) {
			backgroundColor.setStyle(canvasBackground)
		}

		renderer.setClearColor(backgroundColor, 1)
		renderer.clear(true, true, true)

		if (this.viewer.background === 'skybox') {
			this.viewer.skybox.camera.rotation.copy(magnifierCamera.rotation)
			if (magnifierCamera.isPerspectiveCamera) {
				this.viewer.skybox.camera.fov = magnifierCamera.fov
			}
			this.viewer.skybox.camera.aspect = 1
			this.viewer.skybox.camera.updateProjectionMatrix()
			renderer.render(this.viewer.skybox.scene, this.viewer.skybox.camera)
		} else if (this.viewer.background === 'gradient') {
			renderer.render(scene.sceneBG, scene.cameraBG)
		}
	}

	_resolveOverlayTransform(camera, layout, hostRect) {
		if (!camera || !layout || !hostRect?.width || !hostRect?.height) return null

		const ndcX = (layout.centerX / hostRect.width) * 2 - 1
		const ndcY = -(layout.centerY / hostRect.height) * 2 + 1
		const forward = new THREE.Vector3()
		camera.getWorldDirection(forward)
		if (forward.lengthSq() === 0) return null
		forward.normalize()

		const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize()
		const distance = Math.max(camera.near + 0.05, 0.2)

		let visibleHeight
		let visibleWidth
		if (camera.isOrthographicCamera) {
			visibleHeight = (camera.top - camera.bottom) / camera.zoom
			visibleWidth = (camera.right - camera.left) / camera.zoom
		} else {
			// Use the effective FOV so the overlay keeps its pixel size when camera zoom changes.
			const effectiveFov = typeof camera.getEffectiveFOV === 'function'
				? camera.getEffectiveFOV()
				: THREE.MathUtils.radToDeg(2 * Math.atan(
					Math.tan(THREE.MathUtils.degToRad(camera.fov || DEFAULT_FOV) / 2) /
					(camera.zoom || DEFAULT_CAMERA_ZOOM)
				))
			if (!Number.isFinite(effectiveFov) || effectiveFov <= 0) return null
			visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(effectiveFov) / 2) * distance
			visibleWidth = visibleHeight * camera.aspect
		}

		const center = camera.position
			.clone()
			.add(forward.clone().multiplyScalar(distance))
			.add(right.clone().multiplyScalar((ndcX * visibleWidth) / 2))
			.add(up.clone().multiplyScalar((ndcY * visibleHeight) / 2))

		return {
			center,
			radius: ((layout.diameter / hostRect.height) * visibleHeight) / 2,
		}
	}
}
