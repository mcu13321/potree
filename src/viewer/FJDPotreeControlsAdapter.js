import * as THREE from "../../libs/three.js/build/three.module.js";
import {FJDCameraControls, ensureFJDCameraControlsInstalled} from "../FJDCameraControlsHost.js";
import {Utils} from "../utils.js";
import {SphereVolume} from "../utils/Volume.js";

// EDL 模式下 helper 合成使用的顶点着色器。
const HELPER_COMPOSITE_VERTEX_SHADER = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;
// EDL 模式下 helper 合成使用的片元着色器。
const HELPER_COMPOSITE_FRAGMENT_SHADER = `
	uniform sampler2D uHelperColor;
	uniform sampler2D uHelperDepth;
	uniform sampler2D uOcclusionDepth;
	uniform float uDepthBias;
	varying vec2 vUv;
	void main() {
		vec4 helperColor = texture2D(uHelperColor, vUv);
		float helperDepth = texture2D(uHelperDepth, vUv).r;
		float occlusionDepth = texture2D(uOcclusionDepth, vUv).r;
		bool hasHelper = helperDepth < 0.999999;
		if (!hasHelper || helperColor.a <= 0.0) {
			discard;
		}
		if (occlusionDepth < 0.999999 && occlusionDepth <= helperDepth - uDepthBias) {
			discard;
		}
		gl_FragColor = helperColor;
	}
`;

// 视口尺寸不可用时使用的默认球半径。
const DEFAULT_HELPER_SPHERE_RADIUS = 0.3;
// 视口尺寸不可用时使用的默认轴半长。
const DEFAULT_HELPER_AXIS_HALF_LENGTH = 20;
// helper 球体期望保持的屏幕半径，单位像素。
const HELPER_SPHERE_PIXEL_RADIUS = 8;
// helper 三轴期望保持的屏幕半长，单位像素。
const HELPER_AXIS_PIXEL_HALF_LENGTH = 256;

// Potree 适配层：负责把点云拾取、helper 和 EDL 渲染接到 controls core。
export class FJDPotreeControlsAdapter {
	// 初始化适配层，绑定 viewer 生命周期并注入 Potree 专属能力。
	// adapter 自己不作为公开入口，对外只暴露 controls 实例。
	constructor(viewer, externalControls = null) {
		// Potree adapter 使用内部 three，并在接线前确保 controls core 安装同一份 THREE。
		// adapter 允许被独立引入测试，因此在这里也做一次幂等安装兜底。
		ensureFJDCameraControlsInstalled();
		this.viewer = viewer;
		if (!this.viewer.fjdPotreeControlsAdapter) {
			this.viewer.fjdPotreeControlsAdapter = this;
		}
		this.enabled = false;
		this.previousControls = null;
		this.controls = externalControls || new FJDCameraControls(viewer.scene.getActiveCamera());
		if (!externalControls) {
			this.controls.enabled = false;
		}
		this.syncControlsCameraContext();
		this.controls.setOrbitPointResolver(this.resolveOrbitPoint.bind(this));
		this.controls.setFitReferenceBoundsResolver(this.resolveFitReferenceBounds.bind(this));
		this.helperGroup = this.createHelperGroup("fjd-camera-controls-orbit-center-helper");
		this.helperCompositeGroup = this.createHelperGroup(
			"fjd-camera-controls-orbit-center-helper-edl",
		);
		this.helperScene = new THREE.Scene();
		this.helperScene.name = "scene_fjd_orbit_center_helper";
		this.helperScene.add(this.helperCompositeGroup);
		this.helperVisible = false;
		this.helperRenderTarget = null;
		this.occlusionRenderTarget = null;
		this.compositeMaterial = this.createCompositeMaterial();
		this.renderSizeCache = new THREE.Vector2();
		this._onSceneChanged = this.onSceneChanged.bind(this);
		this._onControlStart = this.onControlStart.bind(this);
		this._onControl = this.onControl.bind(this);
		this._onControlEnd = this.onControlEnd.bind(this);
		this._onRenderPerspectiveOverlay = this.onRenderPerspectiveOverlay.bind(this);
		this.viewer.addEventListener("scene_changed", this._onSceneChanged);
		this.viewer.addEventListener(
			"render.pass.perspective_overlay",
			this._onRenderPerspectiveOverlay,
		);
		this.controls.addEventListener("controlstart", this._onControlStart);
		this.controls.addEventListener("control", this._onControl);
		this.controls.addEventListener("controlend", this._onControlEnd);
		this.registerViewerControlsReference();
		this.installControlsHostHooks();
		this.attachHelperToScene();
		this.syncHelperVisibility();
	}

	// 创建旋转中心 helper 组，普通渲染与 EDL 合成各维护一份。
	// 返回包含球体和三轴线段的 Group。
	createHelperGroup(name) {
		const group = new THREE.Group();
		group.name = name;
		group.visible = false;
		const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
		const sphereMaterial = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			depthTest: true,
			depthWrite: true,
			toneMapped: false,
		});
		const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
		sphere.name = `${name}-sphere`;
		sphere.frustumCulled = false;
		group.add(sphere);
		const axisGeometry = new THREE.BufferGeometry();
		axisGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
			-1, 0, 0, 1, 0, 0,
			0, -1, 0, 0, 1, 0,
			0, 0, -1, 0, 0, 1,
		], 3));
		axisGeometry.setAttribute("color", new THREE.Float32BufferAttribute([
			1, 0, 0, 1, 0, 0,
			0, 1, 0, 0, 1, 0,
			0, 0.5, 1, 0, 0.5, 1,
		], 3));
		const axisMaterial = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: true,
			depthWrite: true,
			toneMapped: false,
		});
		const axes = new THREE.LineSegments(axisGeometry, axisMaterial);
		axes.name = `${name}-axes`;
		axes.frustumCulled = false;
		group.add(axes);
		group.userData.fjdControlsHelperCleanup = () => {
			sphereGeometry.dispose();
			sphereMaterial.dispose();
			axisGeometry.dispose();
			axisMaterial.dispose();
		};
		group.userData.fjdControlsHelperSphere = sphere;
		group.userData.fjdControlsHelperAxes = axes;
		return group;
	}

	// 创建 EDL 模式下的屏幕合成材质。
	// 合成时会比较 helper 深度与场景遮挡深度。
	createCompositeMaterial() {
		return new THREE.ShaderMaterial({
			uniforms: {
				uHelperColor: {value: null},
				uHelperDepth: {value: null},
				uOcclusionDepth: {value: null},
				uDepthBias: {value: 1e-4},
			},
			vertexShader: HELPER_COMPOSITE_VERTEX_SHADER,
			fragmentShader: HELPER_COMPOSITE_FRAGMENT_SHADER,
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});
	}

	// 只把 controls 实例暴露给 viewer，adapter 自己退回内部接线层。
	// 外部统一通过 viewer.fjdCameraControls 访问控制器。
	registerViewerControlsReference() {
		if (!this.viewer.fjdCameraControls) {
			this.viewer.fjdCameraControls = this.controls;
		}
	}

	// 通过宿主钩子接入 viewer.setControls 的启停流程。
	// 这样 viewer 可以只按能力分发，而不再识别 FJD 身份。
	installControlsHostHooks() {
		this.controls.onHostControlsWillActivate = (_viewer, previousControls) => {
			this.previousControls =
				previousControls === this.controls ? this.previousControls : previousControls;
			this.enabled = true;
			this.syncControlsFromViewer();
			this.hideHelper();
		};
		this.controls.onHostControlsDidDeactivate = () => {
			this.hideHelper();
			this.enabled = false;
		};
	}

	// 查询当前是否真的由该 controls 处于激活状态。
	// 只有当前被 viewer.controls 采用时才算启用。
	isEnabled() {
		return this.enabled && this.viewer.controls === this.controls;
	}

	// 离屏渲染目标与 helper 场景维护。
	// 创建带深度纹理的离屏渲染目标。
	createRenderTarget(width, height) {
		return new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType),
		});
	}

	// 确保离屏目标存在且尺寸与当前渲染区域一致。
	ensureRenderTargets(width, height) {
		const safeWidth = Math.max(1, Math.floor(width));
		const safeHeight = Math.max(1, Math.floor(height));
		if (!this.helperRenderTarget) {
			this.helperRenderTarget = this.createRenderTarget(safeWidth, safeHeight);
		}
		if (!this.occlusionRenderTarget) {
			this.occlusionRenderTarget = this.createRenderTarget(safeWidth, safeHeight);
		}
		this.helperRenderTarget.setSize(safeWidth, safeHeight);
		this.occlusionRenderTarget.setSize(safeWidth, safeHeight);
	}

	// 清空指定的离屏渲染目标。
	clearRenderTarget(target) {
		this.viewer.renderer.setRenderTarget(target);
		this.viewer.renderer.clear(true, true, true);
	}

	// 把普通 helper 挂到当前主场景。
	attachHelperToScene() {
		const scene = this.viewer.scene?.scene;
		if (!scene || this.helperGroup.parent === scene) {
			return;
		}
		if (this.helperGroup.parent) {
			this.helperGroup.parent.remove(this.helperGroup);
		}
		scene.add(this.helperGroup);
	}

	// 用当前 controls 的目标点同步 helper 位置。
	syncHelperPosition() {
		const target = this.controls.getTarget(new THREE.Vector3());
		this.helperGroup.position.copy(target);
		this.helperCompositeGroup.position.copy(target);
	}

	// 根据相机和视口计算 helper 的世界空间尺寸。
	getHelperSizeFromScreen() {
		const camera = this.viewer.scene?.getActiveCamera?.();
		if (!camera) {
			return {
				sphereRadius: DEFAULT_HELPER_SPHERE_RADIUS,
				axisHalfLength: DEFAULT_HELPER_AXIS_HALF_LENGTH,
			};
		}
		this.viewer.renderer?.getSize?.(this.renderSizeCache);
		const viewportHeight = Math.max(this.renderSizeCache.y, 1);
		const target = this.controls.getTarget(new THREE.Vector3());
		let worldUnitsPerPixel = 1;
		if (camera.isPerspectiveCamera) {
			const distanceToTarget = Math.max(
				camera.position.distanceTo(target),
				Number.EPSILON,
			);
			const verticalFov = THREE.MathUtils.degToRad(
				camera.getEffectiveFOV ? camera.getEffectiveFOV() : camera.fov,
			);
			worldUnitsPerPixel =
				2 * distanceToTarget * Math.tan(verticalFov * 0.5) / viewportHeight;
		} else if (camera.isOrthographicCamera) {
			const viewHeight = Math.max(camera.top - camera.bottom, Number.EPSILON);
			worldUnitsPerPixel = viewHeight / Math.max(camera.zoom, Number.EPSILON) / viewportHeight;
		}
		if (!Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= Number.EPSILON) {
			return {
				sphereRadius: DEFAULT_HELPER_SPHERE_RADIUS,
				axisHalfLength: DEFAULT_HELPER_AXIS_HALF_LENGTH,
			};
		}
		return {
			sphereRadius: worldUnitsPerPixel * HELPER_SPHERE_PIXEL_RADIUS,
			axisHalfLength: worldUnitsPerPixel * HELPER_AXIS_PIXEL_HALF_LENGTH,
		};
	}

	// 把计算结果同时应用到普通 helper 和 EDL helper。
	updateHelperScale() {
		const {sphereRadius, axisHalfLength} = this.getHelperSizeFromScreen();
		for (const group of [this.helperGroup, this.helperCompositeGroup]) {
			const sphere = group.userData.fjdControlsHelperSphere;
			const axes = group.userData.fjdControlsHelperAxes;
			sphere?.scale.setScalar(sphereRadius);
			axes?.scale.setScalar(axisHalfLength);
		}
	}

	// 根据当前 renderer 选择普通 helper 还是 EDL 屏幕合成。
	// 仅在启用 EDL 且存在可见点云时返回 true。
	isEDLActive() {
		if (typeof this.viewer.hasVisibleEDLEffectPointclouds !== "function") {
			return false;
		}
		if (!this.viewer.hasVisibleEDLEffectPointclouds()) {
			return false;
		}
		return this.viewer.getPRenderer?.() === this.viewer.edlRenderer;
	}

	// 根据当前渲染路径同步 helper 可见性。
	syncHelperVisibility() {
		const shouldUseEDLComposite = this.helperVisible && this.isEDLActive();
		this.helperGroup.visible = this.helperVisible && !shouldUseEDLComposite;
		this.helperCompositeGroup.visible = shouldUseEDLComposite;
	}

	// 仅在旋转交互时显示 helper。
	showHelperForRotate() {
		if (!this.enabled || this.viewer.controls !== this.controls) {
			return;
		}
		this.helperVisible = this.controls.currentAction === FJDCameraControls.ACTION.ROTATE;
		this.updateHelperScale();
		this.syncHelperPosition();
		this.syncHelperVisibility();
	}

	// 隐藏所有 helper 表现。
	hideHelper() {
		this.helperVisible = false;
		this.syncHelperVisibility();
	}

	// viewer 和 controls 事件回调。
	// 场景切换后重挂 helper，并同步新的活动相机。
	onSceneChanged() {
		this.attachHelperToScene();
		this.syncControlsCameraContext();
		this.updateHelperScale();
		if (this.enabled) {
			this.syncControlsFromViewer();
			this.syncHelperPosition();
			this.syncHelperVisibility();
		}
	}

	// controlstart 时按需显示 helper。
	onControlStart() {
		if (this.controls.currentAction !== FJDCameraControls.ACTION.ROTATE) {
			return;
		}
		this.showHelperForRotate();
	}

	// control 过程中持续更新 helper。
	onControl() {
		if (this.controls.currentAction !== FJDCameraControls.ACTION.ROTATE) {
			return;
		}
		this.showHelperForRotate();
	}

	// controlend 时隐藏 helper。
	onControlEnd() {
		this.hideHelper();
	}

	// 在透视 overlay 阶段执行 EDL helper 合成。
	onRenderPerspectiveOverlay() {
		if (!this.enabled || this.viewer.controls !== this.controls || !this.helperVisible) {
			return;
		}
		this.syncHelperVisibility();
		if (!this.helperCompositeGroup.visible) {
			return;
		}
		const camera = this.viewer.scene?.getActiveCamera?.();
		if (!camera) {
			return;
		}
		this.viewer.renderer.getSize(this.renderSizeCache);
		this.ensureRenderTargets(this.renderSizeCache.x, this.renderSizeCache.y);
		const previousTarget = typeof this.viewer.renderer.getRenderTarget === "function"
			? this.viewer.renderer.getRenderTarget()
			: null;
		this.renderOcclusionTarget(camera);
		this.renderHelperTarget(camera);
		if (typeof this.viewer.renderer.setRenderTarget === "function") {
			this.viewer.renderer.setRenderTarget(previousTarget ?? null);
		}
		this.compositeMaterial.uniforms.uHelperColor.value = this.helperRenderTarget.texture;
		this.compositeMaterial.uniforms.uHelperDepth.value = this.helperRenderTarget.depthTexture;
		this.compositeMaterial.uniforms.uOcclusionDepth.value = this.occlusionRenderTarget.depthTexture;
		if (previousTarget) {
			Utils.screenPass.render(this.viewer.renderer, this.compositeMaterial, previousTarget);
			return;
		}
		Utils.screenPass.render(this.viewer.renderer, this.compositeMaterial);
	}

	// 渲染辅助工具：点云筛选、遮挡深度和 helper 离屏绘制。
	// 返回当前可见点云列表。
	getVisiblePointclouds() {
		return (this.viewer.scene?.pointclouds ?? []).filter((pointcloud) => pointcloud.visible !== false);
	}

	// 返回当前启用的球形裁剪体。
	getClipSpheres() {
		return (this.viewer.scene?.volumes ?? []).filter((volume) => volume instanceof SphereVolume);
	}

	// 绘制场景遮挡深度，供 helper 合成时比较。
	renderOcclusionTarget(camera) {
		const visiblePointclouds = this.getVisiblePointclouds();
		const clipSpheres = this.getClipSpheres();
		this.clearRenderTarget(this.occlusionRenderTarget);
		this.viewer.pRenderer.render(this.viewer.scene.scenePointCloud, camera, this.occlusionRenderTarget, {
			clipSpheres,
			pointclouds: visiblePointclouds,
		});
		this.viewer.renderer.setRenderTarget(this.occlusionRenderTarget);
		this.viewer.renderer.render(this.viewer.scene.scene, camera);
	}

	// 绘制 helper 自身的颜色和深度。
	renderHelperTarget(camera) {
		this.clearRenderTarget(this.helperRenderTarget);
		this.viewer.renderer.setRenderTarget(this.helperRenderTarget);
		this.viewer.renderer.render(this.helperScene, camera);
	}

	// Potree 专属能力注入：点云拾取、场景尺度和当前 pivot 同步。
	// 根据屏幕坐标从点云中拾取旋转中心。
	resolveOrbitPoint(clientX, clientY) {
		const camera = this.viewer.scene?.getActiveCamera?.();
		const canvas = this.viewer.renderer?.domElement;
		if (!camera || !canvas) {
			return null;
		}
		const rect = canvas.getBoundingClientRect();
		const mouse = {
			x: clientX - rect.left,
			y: clientY - rect.top,
		};
		const intersection = Utils.getMousePointCloudIntersection(
			mouse,
			camera,
			this.viewer,
			this.viewer.scene?.pointclouds ?? [],
			{pickClipped: true},
		);
		return intersection?.location?.clone?.() ?? null;
	}

	// 为退化目标提供场景级参考包围盒。
	resolveFitReferenceBounds(targetBounds) {
		const sceneBounds =
			this.viewer.getBoundingBox?.(this.viewer.scene?.pointclouds) ??
			this.viewer.scene?.getBoundingBox?.();
		if (sceneBounds?.isBox3 && !sceneBounds.isEmpty()) {
			return sceneBounds.clone();
		}

		return targetBounds.clone();
	}

	// 解析当前应作为同步源的 pivot。
	resolveCurrentPivot() {
		const target = new THREE.Vector3();
		const controls = this.viewer.controls;
		if (controls?.getTarget) {
			return controls.getTarget(target, true).clone();
		}
		if (this.viewer.cameraControls?.getTarget) {
			return this.viewer.cameraControls.getTarget(target, true).clone();
		}
		if (this.viewer.scene?.view?.getPivot) {
			return this.viewer.scene.view.getPivot().clone();
		}
		return this.viewer.scene?.getActiveCamera?.()?.position?.clone?.() ?? new THREE.Vector3();
	}

	// 把活动相机同步给 controls core。
	syncControlsCameraContext() {
		if (typeof this.controls.setCamera === "function") {
			this.controls.setCamera(this.viewer.scene?.getActiveCamera?.());
		}
	}

	// 用 viewer 当前相机与 pivot 覆盖 controls 内部状态。
	syncControlsFromViewer() {
		const pivot = this.resolveCurrentPivot();
		this.syncControlsCameraContext();
		this.controls.syncFromCameraAndViewTarget(pivot);
		this.syncHelperPosition();
	}

	// 兼容旧调用方式的启停入口，内部最终仍委托给 viewer.setControls。
	// 保留该方法是为了兼容历史调用方。
	setEnabled(enabled) {
		const nextEnabled = Boolean(enabled);
		if (nextEnabled) {
			if (this.isEnabled()) {
				return;
			}
			this.enableControls();
		} else {
			if (!this.enabled && this.viewer.controls !== this.controls) {
				return;
			}
			this.disableControls();
		}
	}

	// 启用 FJD controls，并切换为当前 viewer.controls。
	enableControls() {
		this.previousControls = this.viewer.controls;
		this.syncControlsFromViewer();
		if (typeof this.viewer.setControls === "function") {
			this.viewer.setControls(this.controls);
		} else {
			this.controls.enabled = true;
			this.controls.connect(this.viewer.renderArea);
			this.viewer.controls = this.controls;
		}
		this.hideHelper();
		this.enabled = true;
	}

	// 停用 FJD controls，并恢复切换前的 controls。
	disableControls() {
		this.controls.disconnect();
		this.controls.enabled = false;
		this.hideHelper();
		if (this.previousControls) {
			if (typeof this.viewer.setControls === "function") {
				this.viewer.setControls(this.previousControls);
			} else {
				this.viewer.controls = this.previousControls;
				this.previousControls.enabled = true;
			}
		}
		this.previousControls = null;
		this.enabled = false;
	}
}

