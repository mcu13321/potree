// src/FJDCameraControlsTHREE.js
var installedTHREE = null;
function assertValidTHREE(THREE) {
  if (!THREE || typeof THREE !== "object") {
    throw new Error("FJDCameraControls.install({ THREE }) \u9700\u8981\u4F20\u5165\u6709\u6548\u7684 THREE \u5BF9\u8C61\u3002");
  }
  if (typeof THREE.Box3 !== "function" || typeof THREE.Vector2 !== "function" || typeof THREE.Vector3 !== "function" || typeof THREE.Vector4 !== "function" || typeof THREE.Quaternion !== "function" || typeof THREE.Matrix4 !== "function" || typeof THREE.Sphere !== "function" || typeof THREE.Spherical !== "function" || typeof THREE.MathUtils?.clamp !== "function") {
    throw new Error("\u4F20\u5165\u7684 THREE \u7F3A\u5C11 FJDCameraControls \u8FD0\u884C\u6240\u9700\u7684\u6838\u5FC3\u7C7B\u578B\u6216\u5DE5\u5177\u65B9\u6CD5\u3002");
  }
}
function installFJDCameraControlsTHREE(THREE) {
  assertValidTHREE(THREE);
  installedTHREE = THREE;
  return installedTHREE;
}
function getInstalledFJDCameraControlsTHREE() {
  if (!installedTHREE) {
    throw new Error(
      "FJDCameraControls \u5C1A\u672A\u5B89\u88C5 THREE\u3002\u8BF7\u5148\u8C03\u7528 FJDCameraControls.install({ THREE })\u3002"
    );
  }
  return installedTHREE;
}
var THREEProxy = new Proxy({}, {
  get(_target, property) {
    return getInstalledFJDCameraControlsTHREE()[property];
  }
});

// src/EventDispatcher.js
var EventDispatcher = class {
  constructor() {
    this._listeners = {};
  }
  addEventListener(type, listener) {
    const listeners = this._listeners;
    if (listeners[type] === void 0) {
      listeners[type] = [];
    }
    if (listeners[type].indexOf(listener) === -1) {
      listeners[type].push(listener);
    }
  }
  hasEventListener(type, listener) {
    const listeners = this._listeners;
    return listeners[type] !== void 0 && listeners[type].indexOf(listener) !== -1;
  }
  removeEventListener(type, listener) {
    const listeners = this._listeners;
    const listenerArray = listeners[type];
    if (listenerArray === void 0) {
      return;
    }
    const index = listenerArray.indexOf(listener);
    if (index !== -1) {
      listenerArray.splice(index, 1);
    }
  }
  removeEventListeners(type) {
    if (this._listeners[type] !== void 0) {
      delete this._listeners[type];
    }
  }
  dispatchEvent(event) {
    const listeners = this._listeners;
    const listenerArray = listeners[event.type];
    if (listenerArray === void 0) {
      return;
    }
    event.target = this;
    for (const listener of listenerArray.slice(0)) {
      listener.call(this, event);
    }
  }
};

// src/FJDCameraControlsMath.js
var WORLD_UP = null;
var CAMERA_LOCAL_RIGHT = null;
var CAMERA_LOCAL_UP = null;
var CAMERA_LOCAL_FORWARD = null;
var _cachedTHREE = null;
var _tmpRightAxis = null;
var _tmpUpAxis = null;
var _tmpForwardAxis = null;
var _tmpOffset = null;
var _tmpYawQuaternion = null;
var _tmpPitchQuaternion = null;
var _tmpInverseQuaternion = null;
var _tmpUpAlignQuaternion = null;
var _tmpSpherical = null;
var _tmpLookAtMatrix = null;
function ensureMathTHREEInstalled() {
  const installedTHREE2 = getInstalledFJDCameraControlsTHREE();
  if (_cachedTHREE === installedTHREE2) {
    return installedTHREE2;
  }
  _cachedTHREE = installedTHREE2;
  WORLD_UP = Object.freeze(new installedTHREE2.Vector3(0, 0, 1));
  CAMERA_LOCAL_RIGHT = Object.freeze(new installedTHREE2.Vector3(1, 0, 0));
  CAMERA_LOCAL_UP = Object.freeze(new installedTHREE2.Vector3(0, 1, 0));
  CAMERA_LOCAL_FORWARD = Object.freeze(new installedTHREE2.Vector3(0, 0, -1));
  _tmpRightAxis = new installedTHREE2.Vector3();
  _tmpUpAxis = new installedTHREE2.Vector3();
  _tmpForwardAxis = new installedTHREE2.Vector3();
  _tmpOffset = new installedTHREE2.Vector3();
  _tmpYawQuaternion = new installedTHREE2.Quaternion();
  _tmpPitchQuaternion = new installedTHREE2.Quaternion();
  _tmpInverseQuaternion = new installedTHREE2.Quaternion();
  _tmpUpAlignQuaternion = new installedTHREE2.Quaternion();
  _tmpSpherical = new installedTHREE2.Spherical();
  _tmpLookAtMatrix = new installedTHREE2.Matrix4();
  return installedTHREE2;
}
function installFJDCameraControlsMathTHREE(THREE) {
  installFJDCameraControlsTHREE(THREE);
  return ensureMathTHREEInstalled();
}
function computeRotateAngles(deltaX, deltaY, viewportHeight, azimuthRotateSpeed, polarRotateSpeed) {
  ensureMathTHREEInstalled();
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return { yaw: 0, pitch: 0 };
  }
  const yaw = -deltaX / viewportHeight * Math.PI * 2 * azimuthRotateSpeed;
  const pitch = -deltaY / viewportHeight * Math.PI * 2 * polarRotateSpeed;
  return { yaw, pitch };
}
function getWorldRightAxis(quaternion, out = new THREEProxy.Vector3()) {
  ensureMathTHREEInstalled();
  return out.copy(CAMERA_LOCAL_RIGHT).applyQuaternion(quaternion).normalize();
}
function getWorldCameraUpAxis(quaternion, out = new THREEProxy.Vector3()) {
  ensureMathTHREEInstalled();
  return out.copy(CAMERA_LOCAL_UP).applyQuaternion(quaternion).normalize();
}
function getWorldForwardAxis(quaternion, out = new THREEProxy.Vector3()) {
  ensureMathTHREEInstalled();
  return out.copy(CAMERA_LOCAL_FORWARD).applyQuaternion(quaternion).normalize();
}
function composeOrbitDeltaQuaternion(yaw, pitch, currentQuaternion, worldUp = WORLD_UP, out = new THREEProxy.Quaternion()) {
  ensureMathTHREEInstalled();
  const rightAxis = getWorldRightAxis(currentQuaternion, _tmpRightAxis);
  _tmpYawQuaternion.setFromAxisAngle(worldUp, yaw);
  _tmpPitchQuaternion.setFromAxisAngle(rightAxis, pitch);
  return out.copy(_tmpYawQuaternion).multiply(_tmpPitchQuaternion).normalize();
}
function rotateCameraPoseAroundPivot(position, quaternion, pivot, deltaQuaternion, outPosition = new THREEProxy.Vector3(), outQuaternion = new THREEProxy.Quaternion()) {
  ensureMathTHREEInstalled();
  _tmpOffset.copy(position).sub(pivot).applyQuaternion(deltaQuaternion);
  outPosition.copy(pivot).add(_tmpOffset);
  outQuaternion.copy(deltaQuaternion).multiply(quaternion).normalize();
  return {
    position: outPosition,
    quaternion: outQuaternion
  };
}
function computeOrbitDistance(position, pivot) {
  ensureMathTHREEInstalled();
  return position.distanceTo(pivot);
}
function computeSphericalFromOrbitPose(position, pivot, worldUp = WORLD_UP, out = new THREEProxy.Spherical()) {
  ensureMathTHREEInstalled();
  const offset = _tmpOffset.copy(position).sub(pivot);
  const radius = offset.length();
  if (radius <= Number.EPSILON) {
    return out.set(0, Math.PI / 2, 0);
  }
  _tmpUpAlignQuaternion.setFromUnitVectors(worldUp, CAMERA_LOCAL_UP);
  offset.applyQuaternion(_tmpUpAlignQuaternion);
  return out.setFromVector3(offset);
}
function computeOrbitPoseFromSpherical(theta, phi, radius, pivot, worldUp = WORLD_UP, outPosition = new THREEProxy.Vector3(), outQuaternion = new THREEProxy.Quaternion()) {
  ensureMathTHREEInstalled();
  const safeRadius = Math.max(radius, Number.EPSILON);
  _tmpSpherical.set(safeRadius, phi, theta);
  outPosition.setFromSpherical(_tmpSpherical);
  _tmpUpAlignQuaternion.setFromUnitVectors(CAMERA_LOCAL_UP, worldUp);
  outPosition.applyQuaternion(_tmpUpAlignQuaternion).add(pivot);
  computeLookAtQuaternion(outPosition, pivot, worldUp, outQuaternion);
  return {
    position: outPosition,
    quaternion: outQuaternion
  };
}
function computePanOffset(deltaX, deltaY, distanceToPivot, viewportHeight, verticalFovInRadians, truckSpeed, quaternion, out = new THREEProxy.Vector3()) {
  ensureMathTHREEInstalled();
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(distanceToPivot) || distanceToPivot <= 0) {
    return out.set(0, 0, 0);
  }
  const worldUnitsPerPixel = 2 * distanceToPivot * Math.tan(verticalFovInRadians * 0.5) / viewportHeight;
  const scale = worldUnitsPerPixel * truckSpeed;
  const rightAxis = getWorldRightAxis(quaternion, _tmpRightAxis);
  const upAxis = getWorldCameraUpAxis(quaternion, _tmpUpAxis);
  out.copy(rightAxis).multiplyScalar(-deltaX * scale);
  out.add(_tmpUpAxis.copy(upAxis).multiplyScalar(deltaY * scale));
  return out;
}
function computeForwardOffset(distance, quaternion, out = new THREEProxy.Vector3()) {
  ensureMathTHREEInstalled();
  return getWorldForwardAxis(quaternion, out).multiplyScalar(distance);
}
function clampPitchAngleDelta(pitch, currentQuaternion, worldUp = WORLD_UP, minPolarAngle = 0, maxPolarAngle = Math.PI) {
  ensureMathTHREEInstalled();
  const forward = getWorldForwardAxis(currentQuaternion, _tmpForwardAxis);
  const currentPolar = forward.angleTo(worldUp);
  const unclampedTargetPolar = currentPolar - pitch;
  const targetPolar = THREEProxy.MathUtils.clamp(
    unclampedTargetPolar,
    minPolarAngle,
    maxPolarAngle
  );
  return currentPolar - targetPolar;
}
function computeLookAtQuaternion(position, target, worldUp = WORLD_UP, out = new THREEProxy.Quaternion()) {
  ensureMathTHREEInstalled();
  _tmpLookAtMatrix.lookAt(position, target, worldUp);
  return out.setFromRotationMatrix(_tmpLookAtMatrix).normalize();
}

// src/FJDCameraControls.js
var BASE_ACTION = {
  NONE: 0,
  ROTATE: 1,
  TRUCK: 2,
  SCREEN_PAN: 4,
  OFFSET: 8,
  DOLLY: 16,
  ZOOM: 32
};
var ACTION = Object.freeze({
  ...BASE_ACTION,
  TOUCH_ROTATE: BASE_ACTION.ROTATE,
  TOUCH_TRUCK: BASE_ACTION.TRUCK,
  TOUCH_DOLLY: BASE_ACTION.DOLLY,
  TOUCH_ZOOM: BASE_ACTION.ZOOM,
  TOUCH_DOLLY_TRUCK: BASE_ACTION.DOLLY | BASE_ACTION.TRUCK
});
var MOUSE_BUTTON_TO_NAME = {
  0: "left",
  1: "middle",
  2: "right"
};
var WHEEL_STEP_RATIO = 1 / 5;
var WHEEL_ZOOM_STEP_RATIO = 0.18;
var MIN_WHEEL_STEP = 0.2;
var TOUCH_PINCH_FORWARD_RATIO = 4;
var TOUCH_PINCH_ZOOM_RATIO = 2.5;
var TOP_VIEW_PADDING_FACTOR = 1.05;
var DEFAULT_SMOOTH_TIME = 0.25;
var DEFAULT_REST_THRESHOLD = 1e-4;
var DEFAULT_ROTATION_REST_THRESHOLD = 1e-4;
var DEFAULT_ZOOM_REST_THRESHOLD = 1e-4;
var MIN_ORTHOGRAPHIC_ZOOM = 1e-3;
var MAX_ORTHOGRAPHIC_ZOOM = 1e6;
function degToRad(degrees) {
  return typeof THREEProxy.MathUtils?.degToRad === "function" ? THREEProxy.MathUtils.degToRad(degrees) : Number(degrees) * Math.PI / 180;
}
function lerp(start, end, alpha) {
  return typeof THREEProxy.MathUtils?.lerp === "function" ? THREEProxy.MathUtils.lerp(start, end, alpha) : Number(start) + (Number(end) - Number(start)) * Number(alpha);
}
function createSceneControlsPlaceholder() {
  return typeof THREEProxy.Scene === "function" ? new THREEProxy.Scene() : null;
}
var FJDCameraControls = class extends EventDispatcher {
  // 保留 camera-controls 风格的安装入口，方便外部包装层统一调用。
  // 通过显式安装 THREE，避免 core 直接绑定 Potree 私有 three 路径。
  static install({ THREE }) {
    installFJDCameraControlsTHREE(THREE);
    installFJDCameraControlsMathTHREE(THREE);
  }
  // 暴露动作枚举，兼容外部按 camera-controls 方式读取。
  // 这样外部可以通过 FJDCameraControls.ACTION 访问动作常量。
  static get ACTION() {
    return ACTION;
  }
  // 初始化相机状态、控制能力标记、交互配置和运行期缓存。
  constructor(camera, domElement = null, options = {}) {
    super();
    this._camera = camera;
    this.isDomDrivenControls = true;
    this.drivesCameraDirectly = true;
    this.supportsSetCamera = true;
    this.usesRigidTopViewFit = true;
    this.sceneControls = createSceneControlsPlaceholder();
    this._domElement = null;
    this._ownerDocument = null;
    this._previousTouchAction = null;
    this._position = this._camera.position.clone();
    this._quaternion = this._camera.quaternion.clone();
    this._positionEnd = this._camera.position.clone();
    this._quaternionEnd = this._camera.quaternion.clone();
    this._zoom = this._sanitizeZoom(this._camera.zoom);
    this._zoomEnd = this._zoom;
    this._orbitPoint = options.orbitPoint?.clone?.() ?? this._camera.position.clone();
    this._orbitPointCurrent = this._orbitPoint.clone();
    this._yawVelocity = 0;
    this._pitchVelocity = 0;
    this._panVelocity = new THREEProxy.Vector3();
    this._forwardVelocity = 0;
    this._zoomInertiaVelocity = 0;
    this._zoomWheelVelocity = 0;
    this._isRotatingByUser = false;
    this._isPanningByUser = false;
    this._isDollyingByUser = false;
    this._lastUpdateDelta = 1 / 60;
    this._worldUp = this._resolveWorldUp(options.worldUp, WORLD_UP);
    if (options.worldUp) {
      this._camera.up.copy(this._worldUp);
    }
    this._enabled = true;
    this.currentAction = ACTION.NONE;
    this.azimuthRotateSpeed = options.azimuthRotateSpeed ?? 0.3;
    this.polarRotateSpeed = options.polarRotateSpeed ?? 0.3;
    this.truckSpeed = options.truckSpeed ?? 1;
    this.dollySpeed = options.dollySpeed ?? 1;
    this.rotateImmediateRatio = options.rotateImmediateRatio ?? 0.7;
    this.rotateImpulseGain = options.rotateImpulseGain ?? 1;
    this.rotateDamping = options.rotateDamping ?? 12;
    this.rotateStopThreshold = options.rotateStopThreshold ?? 1e-3;
    this.panImmediateRatio = options.panImmediateRatio ?? 0.65;
    this.panImpulseGain = options.panImpulseGain ?? 1.1;
    this.panDamping = options.panDamping ?? 10;
    this.panStopThreshold = options.panStopThreshold ?? 1e-4;
    this.wheelImpulseGain = options.wheelImpulseGain ?? 3.2;
    this.wheelImmediateRatio = options.wheelImmediateRatio ?? 0.35;
    this.wheelDamping = options.wheelDamping ?? 10;
    this.wheelStopThreshold = options.wheelStopThreshold ?? 1e-3;
    this.zoomImpulseGain = options.zoomImpulseGain ?? 2.4;
    this.zoomDamping = options.zoomDamping ?? 11;
    this.zoomStopThreshold = options.zoomStopThreshold ?? 1e-4;
    this.smoothTime = options.smoothTime ?? DEFAULT_SMOOTH_TIME;
    this.draggingSmoothTime = options.draggingSmoothTime ?? this.smoothTime;
    this.maxSpeed = options.maxSpeed ?? Infinity;
    this.minPolarAngle = options.minPolarAngle ?? 0.05;
    this.maxPolarAngle = options.maxPolarAngle ?? Math.PI - 0.05;
    this.dragThreshold = options.dragThreshold ?? 3;
    this.touchTapThreshold = options.touchTapThreshold ?? 8;
    this.restThreshold = options.restThreshold ?? DEFAULT_REST_THRESHOLD;
    this.minAzimuthAngle = options.minAzimuthAngle ?? -Infinity;
    this.maxAzimuthAngle = options.maxAzimuthAngle ?? Infinity;
    this.minDistance = options.minDistance ?? Number.EPSILON;
    this.maxDistance = options.maxDistance ?? Infinity;
    this.minZoom = options.minZoom ?? MIN_ORTHOGRAPHIC_ZOOM;
    this.maxZoom = options.maxZoom ?? MAX_ORTHOGRAPHIC_ZOOM;
    this.rotationRestThreshold = options.rotationRestThreshold ?? DEFAULT_ROTATION_REST_THRESHOLD;
    this.zoomRestThreshold = options.zoomRestThreshold ?? DEFAULT_ZOOM_REST_THRESHOLD;
    this.infinityDolly = options.infinityDolly ?? false;
    this.dollyDragInverted = options.dollyDragInverted ?? false;
    this.dollyToCursor = options.dollyToCursor ?? false;
    this.dragToOffset = options.dragToOffset ?? false;
    this.boundaryFriction = options.boundaryFriction ?? 0;
    this.boundaryEnclosesCamera = options.boundaryEnclosesCamera ?? false;
    this.colliderMeshes = Array.isArray(options.colliderMeshes) ? [...options.colliderMeshes] : [];
    this.verticalDragToForward = options.verticalDragToForward ?? false;
    this.interactiveArea = options.interactiveArea ?? { x: 0, y: 0, width: 1, height: 1 };
    this.shouldCaptureSingleTouch = null;
    this._fitReferenceBoundsResolver = typeof options.fitReferenceBoundsResolver === "function" ? options.fitReferenceBoundsResolver : null;
    this._pendingSingleTouchCapture = false;
    this._singleTouchCaptureStart = new THREEProxy.Vector2();
    this.mouseButtons = {
      left: ACTION.ROTATE,
      middle: ACTION.DOLLY,
      right: ACTION.TRUCK,
      wheel: ACTION.DOLLY
    };
    this.touches = {
      one: ACTION.ROTATE,
      two: ACTION.TRUCK,
      three: ACTION.DOLLY
    };
    this._activePointerId = null;
    this._activeButton = null;
    this._dragStartClient = new THREEProxy.Vector2();
    this._lastClient = new THREEProxy.Vector2();
    this._hasPassedDragThreshold = false;
    this._clickRestoreOrbitPoint = new THREEProxy.Vector3();
    this._hasPendingOrbitPoint = false;
    this._pendingOrbitPoint = new THREEProxy.Vector3();
    this._resolveOrbitPoint = null;
    this._activeTouchPointers = /* @__PURE__ */ new Map();
    this._touchMode = "none";
    this._touchLastCenter = new THREEProxy.Vector2();
    this._touchLastDistance = 0;
    this._elementRect = new DOMRect(0, 0, 1, 1);
    this._viewport = null;
    this._boundary = new THREEProxy.Box3().makeEmpty();
    this._hasUpdated = false;
    this._isAnimating = false;
    this._transitionResolvers = [];
    this._isAwake = false;
    this._pendingRestEvent = false;
    this._position0 = this._position.clone();
    this._quaternion0 = this._quaternion.clone();
    this._zoom0 = this._zoom;
    this._orbitPoint0 = this._orbitPointCurrent.clone();
    this._worldUp0 = this._worldUp.clone();
    this._focalOffset = new THREEProxy.Vector3();
    this._focalOffsetEnd = new THREEProxy.Vector3();
    this._focalOffset0 = new THREEProxy.Vector3();
    this._tmpPosition = new THREEProxy.Vector3();
    this._tmpPosition2 = new THREEProxy.Vector3();
    this._tmpSize = new THREEProxy.Vector3();
    this._tmpQuaternion = new THREEProxy.Quaternion();
    this._tmpQuaternion2 = new THREEProxy.Quaternion();
    this._tmpOffset = new THREEProxy.Vector3();
    this._tmpSphere = new THREEProxy.Sphere();
    this._tmpBox = new THREEProxy.Box3();
    this._tmpBox2 = new THREEProxy.Box3();
    this._tmpDirection = new THREEProxy.Vector3();
    this._tmpDirection2 = new THREEProxy.Vector3();
    this._tmpDirection3 = new THREEProxy.Vector3();
    this._tmpSpherical = new THREEProxy.Spherical();
    this._tmpTouchCenter = new THREEProxy.Vector2();
    this._tmpMatrix = new THREEProxy.Matrix4();
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerCancel = this._handlePointerCancel.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    if (domElement) {
      this.connect(domElement);
    }
  }
  // 基础访问器与兼容属性。
  // 读取控件是否启用。
  get enabled() {
    return this._enabled;
  }
  // 读取当前受控相机。
  get camera() {
    return this._camera;
  }
  // 判断控件当前是否处于交互中或补间中。
  get active() {
    return this._isAnimating || this.currentAction !== ACTION.NONE;
  }
  // 设置控件启用状态。
  set enabled(value) {
    this._enabled = Boolean(value);
  }
  // 读取当前球坐标半径。
  get distance() {
    return this.getSpherical(this._tmpSpherical, true).radius;
  }
  // 通过兼容写法设置球坐标半径。
  set distance(value) {
    this.dollyTo(value, false);
  }
  // 读取当前球坐标方位角。
  get azimuthAngle() {
    return this.getSpherical(this._tmpSpherical, true).theta;
  }
  // 通过兼容写法设置球坐标方位角。
  set azimuthAngle(value) {
    this.rotateAzimuthTo(value, false);
  }
  // 读取当前球坐标极角。
  get polarAngle() {
    return this.getSpherical(this._tmpSpherical, true).phi;
  }
  // 通过兼容写法设置球坐标极角。
  set polarAngle(value) {
    this.rotatePolarTo(value, false);
  }
  // 对 zoom 做统一裁剪，避免正交相机进入非法范围。
  _sanitizeZoom(zoom) {
    const minZoom = this.minZoom ?? MIN_ORTHOGRAPHIC_ZOOM;
    const maxZoom = this.maxZoom ?? MAX_ORTHOGRAPHIC_ZOOM;
    return THREEProxy.MathUtils.clamp(
      Number.isFinite(zoom) ? zoom : 1,
      minZoom,
      maxZoom
    );
  }
  // 解析并归一化实例级 up 轴，非法输入统一回退到默认世界上轴。
  _resolveWorldUp(value, fallback = WORLD_UP, out = new THREEProxy.Vector3()) {
    if (value?.isVector3) {
      out.copy(value);
    } else if (Array.isArray(value) && value.length >= 3) {
      out.fromArray(value);
    } else {
      out.copy(fallback);
    }
    if (out.lengthSq() <= Number.EPSILON) {
      out.copy(fallback);
    }
    return out.normalize();
  }
  // 把正交相机下的屏幕像素位移换算为世界空间平移量。
  _getOrthographicPanOffset(deltaX, deltaY, out = this._tmpOffset) {
    const camera = this._camera;
    const viewWidth = Math.max(camera.right - camera.left, Number.EPSILON);
    const viewHeight = Math.max(camera.top - camera.bottom, Number.EPSILON);
    const zoom = Math.max(this._zoomEnd, MIN_ORTHOGRAPHIC_ZOOM);
    const truckX = this.truckSpeed * deltaX * viewWidth / zoom / Math.max(this._elementRect.width, 1);
    const truckY = this.truckSpeed * deltaY * viewHeight / zoom / Math.max(this._elementRect.height, 1);
    out.copy(getWorldRightAxis(this._quaternionEnd, this._tmpPosition2)).multiplyScalar(-truckX);
    out.add(
      getWorldCameraUpAxis(this._quaternionEnd, this._tmpPosition).multiplyScalar(truckY)
    );
    return out;
  }
  // 把前进距离转换为正交相机的目标 zoom。
  _getForwardDistanceAsOrthographicZoom(distance) {
    const orbitDistance = Math.max(
      computeOrbitDistance(this._positionEnd, this._orbitPoint),
      Number.EPSILON
    );
    const zoomScale = Math.exp(distance / orbitDistance);
    return this._sanitizeZoom(this._zoomEnd * zoomScale);
  }
  // 注入外部解析器，让 core 不直接依赖场景实现。
  // 注入屏幕坐标到旋转中心世界坐标的解析器。
  setOrbitPointResolver(resolver) {
    this._resolveOrbitPoint = typeof resolver === "function" ? resolver : null;
    return this;
  }
  // 注入退化目标回退时使用的参考包围盒解析器。
  setFitReferenceBoundsResolver(resolver) {
    this._fitReferenceBoundsResolver = typeof resolver === "function" ? resolver : null;
    return this;
  }
  // 兼容 camera-controls 的动作配置写法，支持直接常量或返回常量的函数。
  _resolveInputAction(action) {
    return typeof action === "function" ? action() : action;
  }
  // 判断复合触摸动作是否包含指定语义，兼容 TOUCH_DOLLY_TRUCK 这类组合常量。
  _includesInputAction(action, expectedAction) {
    if (expectedAction === ACTION.NONE) {
      return action === ACTION.NONE;
    }
    return action === expectedAction || (Number(action) & Number(expectedAction)) === expectedAction;
  }
  // 终止当前动画和交互状态，并在必要时补发 controlend。
  cancel() {
    const hadControlAction = this.currentAction !== ACTION.NONE;
    this._cancelAnimationToCurrent();
    this._removeDocumentPointerListeners();
    this._resetPointerInteraction();
    if (hadControlAction) {
      this.dispatchEvent({ type: "controlend" });
    }
  }
  // 兼容 camera-controls 的锁指针接口，当前不实际使用。
  lockPointer() {
  }
  // 兼容 camera-controls 的解锁指针接口，当前不实际使用。
  unlockPointer() {
  }
  // 兼容 camera-controls 风格的 camera 读写入口。
  // 读取当前相机引用。
  // 直接替换相机并同步内部状态。
  set camera(camera) {
    this._camera = camera;
    this._position.copy(camera.position);
    this._quaternion.copy(camera.quaternion);
    this._positionEnd.copy(camera.position);
    this._quaternionEnd.copy(camera.quaternion);
    this._zoom = this._sanitizeZoom(camera.zoom);
    this._zoomEnd = this._zoom;
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 对外暴露统一的相机切换入口。
  setCamera(camera) {
    if (!camera || camera === this._camera) {
      return this;
    }
    this.camera = camera;
    return this;
  }
  // 绑定和解绑 DOM 事件。
  // 绑定渲染区域并注册所需事件。
  connect(domElement) {
    if (this._domElement === domElement) {
      return;
    }
    this.disconnect();
    this._domElement = domElement;
    this._ownerDocument = domElement?.ownerDocument ?? document;
    if (!this._domElement) {
      return;
    }
    this._domElement.addEventListener("pointerdown", this._onPointerDown);
    this._domElement.addEventListener("wheel", this._onWheel, { passive: false });
    this._domElement.addEventListener("contextmenu", this._onContextMenu);
    if (this._domElement.style) {
      this._previousTouchAction = this._domElement.style.touchAction;
      this._domElement.style.touchAction = "none";
    }
    this._updateElementRect();
  }
  // 解绑当前 DOM 上的所有事件并清理状态。
  disconnect() {
    if (!this._domElement) {
      return;
    }
    this._domElement.removeEventListener("pointerdown", this._onPointerDown);
    this._domElement.removeEventListener("wheel", this._onWheel, { passive: false });
    this._domElement.removeEventListener("contextmenu", this._onContextMenu);
    if (this._domElement.style) {
      this._domElement.style.touchAction = this._previousTouchAction ?? "";
      this._previousTouchAction = null;
    }
    this._removeDocumentPointerListeners();
    this._domElement = null;
    this._ownerDocument = null;
    this._resetPointerInteraction();
  }
  // 释放控件占用的事件资源。
  dispose() {
    this.disconnect();
  }
  // 推进补间动画，并补发 wake / rest / sleep 等兼容事件。
  // 每帧由宿主调用，用于推进动画和派发事件。
  update(delta = 0) {
    this._lastUpdateDelta = Math.max(Number(delta) || 0, 1 / 120);
    this._updateUserInertia(this._lastUpdateDelta);
    if (this._isAnimating) {
      this._updateTransition(this._lastUpdateDelta);
    }
    const changed = this._hasUpdated;
    if (changed) {
      if (!this._isAwake) {
        this._isAwake = true;
        this.dispatchEvent({ type: "wake" });
      }
      this.dispatchEvent({ type: "update" });
      if (this._pendingRestEvent && !this._isAnimating) {
        this._pendingRestEvent = false;
        this.dispatchEvent({ type: "rest" });
      }
    } else if (this._isAwake) {
      this._isAwake = false;
      this.dispatchEvent({ type: "sleep" });
    }
    this._hasUpdated = false;
    return changed;
  }
  // 查询当前目标点、位置和球坐标。
  // 读取当前旋转中心。
  getTarget(out = new THREEProxy.Vector3(), receiveEndValue = true) {
    return out.copy(receiveEndValue ? this._orbitPoint : this._orbitPointCurrent);
  }
  // 读取当前相机位置。
  getPosition(out = new THREEProxy.Vector3(), receiveEndValue = true) {
    return out.copy(receiveEndValue ? this._positionEnd : this._position);
  }
  // 读取当前刚体相机朝向，供宿主在跨场景同步时避开旧球坐标语义。
  getQuaternion(out = new THREEProxy.Quaternion(), receiveEndValue = true) {
    return out.copy(receiveEndValue ? this._quaternionEnd : this._quaternion);
  }
  // 将数组、Vector3 或普通对象统一读取为 Vector3。
  _readVectorLike(value, out = new THREEProxy.Vector3()) {
    if (Array.isArray(value)) {
      return out.set(
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0
      );
    }
    if (value?.isVector3 === true || typeof value?.toArray === "function") {
      return out.copy(value);
    }
    return out.set(
      Number(value?.x) || 0,
      Number(value?.y) || 0,
      Number(value?.z) || 0
    );
  }
  // 将数组、Quaternion 或普通对象统一读取为单位四元数。
  _readQuaternionLike(value, out = new THREEProxy.Quaternion()) {
    if (Array.isArray(value)) {
      return out.set(
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0,
        Number.isFinite(Number(value[3])) ? Number(value[3]) : 1
      ).normalize();
    }
    if (value?.isQuaternion === true || typeof value?.toArray === "function") {
      return out.copy(value).normalize();
    }
    return out.set(
      Number(value?.x) || 0,
      Number(value?.y) || 0,
      Number(value?.z) || 0,
      Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
    ).normalize();
  }
  // 导出刚体位姿；同步链路应优先使用 position + quaternion，而不是 target + spherical。
  getRigidPose(receiveEndValue = true) {
    const position = receiveEndValue ? this._positionEnd : this._position;
    const quaternion = receiveEndValue ? this._quaternionEnd : this._quaternion;
    const orbitPoint = receiveEndValue ? this._orbitPoint : this._orbitPointCurrent;
    return {
      position: position.toArray(),
      quaternion: quaternion.toArray(),
      orbitPoint: orbitPoint.toArray(),
      zoom: receiveEndValue ? this._zoomEnd : this._zoom
    };
  }
  // 按刚体位姿恢复相机；未传 orbitPoint 时按当前位置差值平移旧旋转中心。
  setRigidPose(pose, enableTransition = false) {
    if (!pose || typeof pose !== "object") {
      return Promise.resolve();
    }
    this._cancelAnimationToCurrent();
    const nextPosition = pose.position ? this._readVectorLike(pose.position, this._tmpPosition) : this._tmpPosition.copy(this._positionEnd);
    const nextQuaternion = pose.quaternion ? this._readQuaternionLike(pose.quaternion, this._tmpQuaternion) : this._tmpQuaternion.copy(this._quaternionEnd);
    const nextOrbitPoint = this._tmpOffset;
    if (pose.orbitPoint || pose.target) {
      this._readVectorLike(pose.orbitPoint ?? pose.target, nextOrbitPoint);
    } else {
      const orbitOffset = this._tmpPosition2.copy(this._orbitPoint).sub(this._positionEnd);
      nextOrbitPoint.copy(nextPosition).add(orbitOffset);
    }
    const nextZoom = Number.isFinite(pose.zoom) ? pose.zoom : this._zoomEnd;
    const preserveRotationInertia = pose.preserveRotationInertia === true && !pose.quaternion;
    return this._setPose(nextPosition, nextQuaternion, nextOrbitPoint, enableTransition, nextZoom, {
      // 内部漫游只平移相机位置时，需要保留用户刚刚拖拽产生的旋转残量。
      preserveRotationInertia
    });
  }
  // 根据当前位置与目标点反算球坐标。
  getSpherical(out = new THREEProxy.Spherical(), receiveEndValue = true) {
    const position = receiveEndValue ? this._positionEnd : this._position;
    const pivot = receiveEndValue ? this._orbitPoint : this._orbitPointCurrent;
    return computeSphericalFromOrbitPose(position, pivot, this._worldUp, out);
  }
  // 估算透视相机装下球体所需的最小视距。
  getDistanceToFitSphere(radius) {
    if (!this._camera.isPerspectiveCamera) {
      return computeOrbitDistance(this._positionEnd, this._orbitPoint);
    }
    const safeRadius = Math.max(Number(radius) || 0, 0);
    const verticalFov = degToRad(
      this._camera.getEffectiveFOV ? this._camera.getEffectiveFOV() : this._camera.fov
    );
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * Math.max(this._camera.aspect, Number.EPSILON));
    const fitFov = this._camera.aspect > 1 ? verticalFov : horizontalFov;
    return safeRadius / Math.max(Math.sin(fitFov * 0.5), Number.EPSILON);
  }
  // 估算透视相机装下包围盒所需的最小视距。
  getDistanceToFitBox(width, height, depth, cover = false) {
    if (!this._camera.isPerspectiveCamera) {
      return computeOrbitDistance(this._positionEnd, this._orbitPoint);
    }
    const safeWidth = Math.max(Number(width) || 0, 0);
    const safeHeight = Math.max(Number(height) || 0, 0);
    const safeDepth = Math.max(Number(depth) || 0, 0);
    const boundingRectAspect = safeHeight <= Number.EPSILON ? Infinity : safeWidth / safeHeight;
    const verticalFov = degToRad(
      this._camera.getEffectiveFOV ? this._camera.getEffectiveFOV() : this._camera.fov
    );
    const aspect = Math.max(this._camera.aspect, Number.EPSILON);
    const heightToFit = (cover ? boundingRectAspect > aspect : boundingRectAspect < aspect) ? safeHeight : safeWidth / aspect;
    return heightToFit * 0.5 / Math.max(Math.tan(verticalFov * 0.5), Number.EPSILON) + safeDepth * 0.5;
  }
  // 把包围盒投影到当前相机局部坐标系，供 fit 逻辑复用。
  // 返回投影后的宽、高、深三个尺寸。
  _computeProjectedBoundsSize(bounds, out = this._tmpPosition) {
    return this._computeBoundsSizeInBasis(
      bounds,
      getWorldRightAxis(this._quaternionEnd, this._tmpDirection),
      getWorldCameraUpAxis(this._quaternionEnd, this._tmpDirection2),
      this._tmpDirection3.set(0, 0, 1).applyQuaternion(this._quaternionEnd).normalize(),
      out
    );
  }
  // 把包围盒投影到指定正交基，返回该基下的宽、高、深。
  _computeBoundsSizeInBasis(bounds, rightAxis, upAxis, backAxis, out = this._tmpPosition) {
    const boundsSize = bounds.getSize(this._tmpSize);
    const halfX = boundsSize.x * 0.5;
    const halfY = boundsSize.y * 0.5;
    const halfZ = boundsSize.z * 0.5;
    const projectedWidth = 2 * (Math.abs(rightAxis.x) * halfX + Math.abs(rightAxis.y) * halfY + Math.abs(rightAxis.z) * halfZ);
    const projectedHeight = 2 * (Math.abs(upAxis.x) * halfX + Math.abs(upAxis.y) * halfY + Math.abs(upAxis.z) * halfZ);
    const projectedDepth = 2 * (Math.abs(backAxis.x) * halfX + Math.abs(backAxis.y) * halfY + Math.abs(backAxis.z) * halfZ);
    return out.set(projectedWidth, projectedHeight, projectedDepth);
  }
  // 选择一个与当前 worldUp 垂直的稳定屏幕上轴，避免顶视图 lookAt 在任意 up 下退化。
  // 为顶视图选择固定且稳定的屏幕上方向，避免结果继承当前视图的平面内旋转角。
  _resolveTopViewScreenUp(out = this._tmpDirection2) {
    const candidateAxes = [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0]
    ];
    for (const [x, y, z] of candidateAxes) {
      out.set(x, y, z);
      out.addScaledVector(this._worldUp, -out.dot(this._worldUp));
      if (out.lengthSq() > Number.EPSILON) {
        return out.normalize();
      }
    }
    return out.set(0, 1, 0);
  }
  // 为顶视图构造相机局部 X/Y/Z 在世界空间中的正交基。
  // 为顶视图构造相机局部 X/Y/Z 在世界空间中的正交基，并固定屏幕内朝向。
  _resolveTopViewBasis(outRight = this._tmpDirection, outUp = this._tmpDirection2, outBack = this._tmpDirection3) {
    outBack.copy(this._worldUp).normalize();
    this._resolveTopViewScreenUp(outUp);
    outRight.crossVectors(outUp, outBack).normalize();
    outUp.crossVectors(outBack, outRight).normalize();
    return { right: outRight, up: outUp, back: outBack };
  }
  // 统一计算正交相机 fit 时的目标 zoom。
  // cover 为 true 时使用覆盖策略，否则使用完整包含策略。
  _resolveOrthographicFitZoom(projectedWidth, projectedHeight, cover = false) {
    const viewWidth = Math.max(this._camera.right - this._camera.left, Number.EPSILON);
    const viewHeight = Math.max(this._camera.top - this._camera.bottom, Number.EPSILON);
    const zoomResolver = cover ? Math.max : Math.min;
    return projectedWidth <= Number.EPSILON && projectedHeight <= Number.EPSILON ? this._sanitizeZoom(Infinity) : this._sanitizeZoom(
      zoomResolver(
        viewWidth / Math.max(projectedWidth, Number.EPSILON),
        viewHeight / Math.max(projectedHeight, Number.EPSILON)
      )
    );
  }
  // 保持当前视向，对目标包围盒执行框景。
  // 对透视和正交相机分别走不同的框景计算分支。
  fitToBox(box3OrObject, enableTransition = false, options = {}) {
    this._cancelAnimationToCurrent();
    const targetBounds = this._resolveFitTargetBounds(box3OrObject, this._tmpBox);
    if (!targetBounds || targetBounds.isEmpty?.()) {
      return Promise.resolve();
    }
    const referenceBounds = this._resolveFitReferenceBounds(targetBounds, this._tmpBox2);
    const nextTarget = targetBounds.getCenter(this._tmpPosition2);
    const projectedSize = this._computeProjectedBoundsSize(referenceBounds, this._tmpPosition);
    const cover = Boolean(options?.cover);
    if (this._camera.isPerspectiveCamera) {
      const distanceToFit = THREEProxy.MathUtils.clamp(
        Math.max(
          this.getDistanceToFitBox(
            projectedSize.x,
            projectedSize.y,
            projectedSize.z,
            cover
          ),
          this.minDistance
        ),
        this.minDistance,
        this.maxDistance
      );
      const backAxis = this._tmpDirection3.set(0, 0, 1).applyQuaternion(this._quaternionEnd).normalize();
      const nextPosition = this._tmpPosition.copy(nextTarget).add(backAxis.multiplyScalar(distanceToFit));
      const nextQuaternion = computeLookAtQuaternion(
        nextPosition,
        nextTarget,
        this._worldUp,
        this._tmpQuaternion
      );
      return this._setPose(
        nextPosition,
        nextQuaternion,
        nextTarget,
        enableTransition
      );
    }
    if (this._camera.isOrthographicCamera) {
      const targetZoom = this._resolveOrthographicFitZoom(
        projectedSize.x,
        projectedSize.y,
        cover
      );
      const orbitOffset = this._tmpOffset.copy(this._positionEnd).sub(this._orbitPoint);
      return this._setPose(
        this._tmpPosition.copy(nextTarget).add(orbitOffset),
        this._tmpQuaternion.copy(this._quaternionEnd),
        nextTarget,
        enableTransition,
        targetZoom
      );
    }
    return Promise.resolve();
  }
  // 直接修改旋转中心，或带动相机与目标一起平移。
  // 直接设置旋转中心，不改变相机位置和朝向。
  setOrbitPoint(x, y, z) {
    this._cancelAnimationToCurrent();
    this._orbitPoint.set(x, y, z);
    this._orbitPointCurrent.set(x, y, z);
    return this;
  }
  // 移动旋转中心，并带动相机做等量平移。
  moveTo(x, y, z, enableTransition = false) {
    this._cancelAnimationToCurrent();
    const nextTarget = this._tmpOffset.set(x, y, z);
    const delta = nextTarget.clone().sub(this._orbitPoint);
    const nextPosition = this._tmpPosition.copy(this._positionEnd).add(delta);
    const nextQuaternion = this._tmpQuaternion.copy(this._quaternionEnd);
    return this._setPose(nextPosition, nextQuaternion, nextTarget, enableTransition);
  }
  // 兼容 camera-controls 的 setTarget 别名。
  setTarget(x, y, z, enableTransition = false) {
    return this.moveTo(x, y, z, enableTransition);
  }
  // 仅修改相机位置，不改变旋转中心。
  setPosition(x, y, z, enableTransition = false) {
    this._cancelAnimationToCurrent();
    return this._setPose(
      this._tmpPosition.set(x, y, z),
      this._tmpQuaternion.copy(this._quaternionEnd),
      this._orbitPoint,
      enableTransition
    );
  }
  // 同时设置相机位置和观察目标，并据此重建朝向。
  setLookAt(positionX, positionY, positionZ, targetX, targetY, targetZ, enableTransition = false) {
    this._cancelAnimationToCurrent();
    const nextPosition = this._tmpPosition.set(positionX, positionY, positionZ);
    const nextOrbitPoint = this._tmpOffset.set(targetX, targetY, targetZ);
    const nextQuaternion = computeLookAtQuaternion(
      nextPosition,
      nextOrbitPoint,
      this._worldUp,
      this._tmpQuaternion
    );
    return this._setPose(nextPosition, nextQuaternion, nextOrbitPoint, enableTransition);
  }
  // 按 FJD 刚体相机模型切换到顶视图位姿。
  // 顶视图会根据相机类型自动选择距离或 zoom 的适配方式。
  fitToTopViewBox(box, enableTransition = false) {
    this._cancelAnimationToCurrent();
    if (!box || box.isEmpty?.()) {
      return Promise.resolve();
    }
    const center = box.getCenter(this._tmpPosition2);
    const camera = this._camera;
    const { right, up, back } = this._resolveTopViewBasis(
      this._tmpDirection,
      this._tmpDirection2,
      this._tmpDirection3
    );
    const projectedSize = this._computeBoundsSizeInBasis(box, right, up, back, this._tmpSize);
    const topQuaternion = this._tmpQuaternion.setFromRotationMatrix(this._tmpMatrix.makeBasis(right, up, back)).normalize();
    if (camera.isPerspectiveCamera) {
      const targetZoom = 1;
      const halfHeight = Math.max(projectedSize.y * 0.5, Number.EPSILON);
      const halfWidth = Math.max(projectedSize.x * 0.5, Number.EPSILON);
      const verticalFov = degToRad(
        camera.getEffectiveFOV ? camera.getEffectiveFOV() : camera.fov
      );
      const halfVerticalFov = Math.max(verticalFov * 0.5, Number.EPSILON);
      const horizontalFov = 2 * Math.atan(Math.tan(halfVerticalFov) * Math.max(camera.aspect, Number.EPSILON));
      const halfHorizontalFov = Math.max(horizontalFov * 0.5, Number.EPSILON);
      const distanceForHeight = halfHeight / Math.tan(halfVerticalFov);
      const distanceForWidth = halfWidth / Math.tan(halfHorizontalFov);
      const topDistance = Math.max(distanceForHeight, distanceForWidth) * TOP_VIEW_PADDING_FACTOR;
      const targetDistance = projectedSize.z * 0.5 + topDistance;
      return this._setPose(
        this._tmpPosition.copy(center).add(this._tmpOffset.copy(back).multiplyScalar(targetDistance)),
        topQuaternion,
        center,
        enableTransition,
        targetZoom
      );
    }
    if (camera.isOrthographicCamera) {
      const viewWidth = Math.max(camera.right - camera.left, Number.EPSILON);
      const viewHeight = Math.max(camera.top - camera.bottom, Number.EPSILON);
      const widthZoom = viewWidth / Math.max(projectedSize.x * TOP_VIEW_PADDING_FACTOR, Number.EPSILON);
      const heightZoom = viewHeight / Math.max(projectedSize.y * TOP_VIEW_PADDING_FACTOR, Number.EPSILON);
      const targetZoom = this._sanitizeZoom(Math.min(widthZoom, heightZoom));
      const targetDistance = projectedSize.z * 0.5 + Math.max(projectedSize.z, 1);
      return this._setPose(
        this._tmpPosition.copy(center).add(this._tmpOffset.copy(back).multiplyScalar(targetDistance)),
        topQuaternion,
        center,
        enableTransition,
        targetZoom
      );
    }
    return Promise.resolve();
  }
  // 对球体或对象执行框景。
  // fitToSphere 始终优先使用宿主提供的参考包围盒来估算视距，保证所有目标共用场景尺度。
  fitToSphere(sphereOrObject, enableTransition = false) {
    this._cancelAnimationToCurrent();
    const targetBounds = this._resolveFitTargetBounds(sphereOrObject, this._tmpBox);
    if (!targetBounds) {
      return Promise.resolve();
    }
    const referenceBounds = this._resolveFitReferenceBounds(
      targetBounds,
      this._tmpBox2,
      {
        forceReferenceBounds: true
      }
    );
    const nextTarget = targetBounds.getCenter(this._tmpPosition2);
    const boundsSize = referenceBounds.getSize(this._tmpPosition);
    const orbitOffset = this._tmpOffset.copy(this._positionEnd).sub(this._orbitPoint);
    if (orbitOffset.lengthSq() <= Number.EPSILON) {
      orbitOffset.set(0, 0, 1).applyQuaternion(this._quaternionEnd);
    }
    if (this._camera.isPerspectiveCamera) {
      const distanceToFit = THREEProxy.MathUtils.clamp(
        Math.max(boundsSize.length() * 0.5, this.minDistance),
        this.minDistance,
        this.maxDistance
      );
      const nextPosition = this._tmpPosition.copy(nextTarget).add(orbitOffset.normalize().multiplyScalar(distanceToFit));
      const nextQuaternion = computeLookAtQuaternion(
        nextPosition,
        nextTarget,
        this._worldUp,
        this._tmpQuaternion
      );
      return this._setPose(
        nextPosition,
        nextQuaternion,
        nextTarget,
        enableTransition
      );
    }
    if (this._camera.isOrthographicCamera) {
      const projectedSize = this._computeProjectedBoundsSize(referenceBounds, this._tmpPosition);
      const targetZoom = this._resolveOrthographicFitZoom(
        projectedSize.x,
        projectedSize.y,
        false
      );
      return this._setPose(
        this._tmpPosition.copy(nextTarget).add(orbitOffset),
        this._tmpQuaternion.copy(this._quaternionEnd),
        nextTarget,
        enableTransition,
        targetZoom
      );
    }
    return Promise.resolve();
  }
  // 平移、旋转和前进等主交互 API。
  // 按增量角度围绕当前旋转中心旋转。
  rotate(theta, phi, enableTransition = false) {
    this._cancelAnimationToCurrent();
    if (!enableTransition) {
      this._rotateByAngles(theta, phi);
      return Promise.resolve();
    }
    const deltaQuaternion = composeOrbitDeltaQuaternion(
      theta,
      phi,
      this._quaternionEnd,
      this._worldUp,
      this._tmpQuaternion
    );
    rotateCameraPoseAroundPivot(
      this._positionEnd,
      this._quaternionEnd,
      this._orbitPoint,
      deltaQuaternion,
      this._tmpPosition,
      this._tmpQuaternion2
    );
    return this._setPose(this._tmpPosition, this._tmpQuaternion2, this._orbitPoint, true);
  }
  // 按屏幕像素位移执行平移。
  truck(x, y, enableTransition = false) {
    this._cancelAnimationToCurrent();
    if (!enableTransition) {
      this._panByPixels(x, y);
      return Promise.resolve();
    }
    const offset = this._camera.isOrthographicCamera ? this._getOrthographicPanOffset(x, y, this._tmpOffset) : computePanOffset(
      x,
      y,
      Math.max(computeOrbitDistance(this._positionEnd, this._orbitPoint), Number.EPSILON),
      this._elementRect.height,
      degToRad(
        this._camera.getEffectiveFOV ? this._camera.getEffectiveFOV() : this._camera.fov
      ),
      this.truckSpeed,
      this._quaternionEnd,
      this._tmpOffset
    );
    return this._setPose(
      this._tmpPosition.copy(this._positionEnd).add(offset),
      this._tmpQuaternion.copy(this._quaternionEnd),
      this._orbitPoint,
      true
    );
  }
  // 沿相机视线前进或后退。
  forward(distance, enableTransition = false) {
    this._cancelAnimationToCurrent();
    if (!enableTransition) {
      this._moveForward(distance);
      return Promise.resolve();
    }
    if (this._camera.isOrthographicCamera) {
      return this._setPose(
        this._positionEnd,
        this._quaternionEnd,
        this._orbitPoint,
        true,
        this._getForwardDistanceAsOrthographicZoom(distance)
      );
    }
    const offset = computeForwardOffset(distance, this._quaternionEnd, this._tmpOffset);
    return this._setPose(
      this._tmpPosition.copy(this._positionEnd).add(offset),
      this._tmpQuaternion.copy(this._quaternionEnd),
      this._orbitPoint,
      true
    );
  }
  // 保存当前位姿快照，供 reset 恢复。
  saveState() {
    this._position0.copy(this._position);
    this._quaternion0.copy(this._quaternion);
    this._zoom0 = this._zoom;
    this._orbitPoint0.copy(this._orbitPointCurrent);
    this._worldUp0.copy(this._worldUp);
  }
  // 恢复到最近一次 saveState 保存的状态。
  reset(enableTransition = false) {
    this._cancelAnimationToCurrent();
    this._worldUp.copy(this._worldUp0);
    this._camera.up.copy(this._worldUp);
    return this._setPose(
      this._position0,
      this._quaternion0,
      this._orbitPoint0,
      enableTransition,
      this._zoom0
    );
  }
  // 立即停止动画并收敛到当前可见状态。
  stop() {
    this._cancelAnimationToCurrent();
    return this;
  }
  // 用外部相机位姿与目标点直接覆盖当前内部状态。
  // 常用于宿主切换 controls 时把已有 viewer 状态接管到 core。
  syncFromCameraAndViewTarget(target) {
    this._position.copy(this._camera.position);
    this._quaternion.copy(this._camera.quaternion);
    this._positionEnd.copy(this._camera.position);
    this._quaternionEnd.copy(this._camera.quaternion);
    this._zoom = this._sanitizeZoom(this._camera.zoom);
    this._zoomEnd = this._zoom;
    this._orbitPoint.copy(target);
    this._orbitPointCurrent.copy(target);
    this._clickRestoreOrbitPoint.copy(target);
    this._isAnimating = false;
    this._resolveTransitionPromises();
    return this;
  }
  // 桌面端指针与滚轮输入。
  // 处理桌面端 pointerdown。
  _handlePointerDown(event) {
    if (event.pointerType === "touch") {
      this._handleTouchPointerDown(event);
      return;
    }
    if (this._activeTouchPointers.size > 0) {
      return;
    }
    if (!this._enabled || !this._domElement || this._activePointerId != null) {
      return;
    }
    this._cancelAnimationToCurrent();
    const buttonName = MOUSE_BUTTON_TO_NAME[event.button];
    const mappedAction = this._resolveInputAction(
      buttonName ? this.mouseButtons[buttonName] : ACTION.NONE
    );
    if (mappedAction !== ACTION.ROTATE && mappedAction !== ACTION.TRUCK) {
      return;
    }
    this._updateElementRect();
    this._activePointerId = event.pointerId;
    this._activeButton = event.button;
    this._dragStartClient.set(event.clientX, event.clientY);
    this._lastClient.set(event.clientX, event.clientY);
    this._hasPassedDragThreshold = false;
    this._clickRestoreOrbitPoint.copy(this._orbitPoint);
    this._hasPendingOrbitPoint = false;
    if (mappedAction === ACTION.ROTATE) {
      this._tryUpdateOrbitPointFromPointerDown(event.clientX, event.clientY);
    }
    if (mappedAction === ACTION.TRUCK) {
      this.currentAction = ACTION.TRUCK;
      this._dispatchControlStart();
    }
    this._addDocumentPointerListeners();
  }
  // 处理桌面端 pointermove。
  _handlePointerMove(event) {
    if (event.pointerType === "touch") {
      this._handleTouchPointerMove(event);
      return;
    }
    if (event.pointerId !== this._activePointerId || !this._enabled) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - this._lastClient.x;
    const deltaY = event.clientY - this._lastClient.y;
    const totalDeltaX = event.clientX - this._dragStartClient.x;
    const totalDeltaY = event.clientY - this._dragStartClient.y;
    const thresholdSq = this.dragThreshold * this.dragThreshold;
    const hasPassedDragThreshold = totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY > thresholdSq;
    if (this._activeButton === 0) {
      if (!hasPassedDragThreshold) {
        this._lastClient.set(event.clientX, event.clientY);
        return;
      }
      if (!this._hasPassedDragThreshold) {
        this._hasPassedDragThreshold = true;
        this.currentAction = ACTION.ROTATE;
        this._isRotatingByUser = true;
        this._dispatchControlStart();
      }
      this._rotateByPointerDelta(deltaX, deltaY);
      this.dispatchEvent({ type: "control" });
    } else if (this._activeButton === 2) {
      this._isPanningByUser = true;
      this._panByPixels(deltaX, deltaY);
      this.dispatchEvent({ type: "control" });
    }
    this._lastClient.set(event.clientX, event.clientY);
  }
  // 处理桌面端 pointerup。
  _handlePointerUp(event) {
    if (event.pointerType === "touch") {
      this._handleTouchPointerUp(event);
      return;
    }
    if (event.pointerId !== this._activePointerId) {
      return;
    }
    if (this._activeButton === 0 && !this._hasPassedDragThreshold) {
      this._restoreOrbitPointAfterClickIfNeeded();
    }
    const hadControlAction = this.currentAction !== ACTION.NONE;
    this._resetPointerInteraction();
    this._removeDocumentPointerListeners();
    if (hadControlAction) {
      this._isRotatingByUser = false;
      this._isPanningByUser = false;
      this.dispatchEvent({ type: "controlend" });
    }
  }
  // 处理桌面端 pointercancel。
  _handlePointerCancel(event) {
    if (event.pointerType === "touch") {
      this._handleTouchPointerCancel(event);
      return;
    }
    if (event.pointerId !== this._activePointerId) {
      return;
    }
    if (this._activeButton === 0 && !this._hasPassedDragThreshold) {
      this._restoreOrbitPointAfterClickIfNeeded();
    }
    const hadControlAction = this.currentAction !== ACTION.NONE;
    this._resetPointerInteraction();
    this._removeDocumentPointerListeners();
    if (hadControlAction) {
      this._isRotatingByUser = false;
      this._isPanningByUser = false;
      this.dispatchEvent({ type: "controlend" });
    }
  }
  // 处理桌面端滚轮缩放。
  _handleWheel(event) {
    const wheelAction = this._resolveInputAction(this.mouseButtons.wheel);
    if (!this._enabled || !this._domElement || wheelAction !== ACTION.DOLLY && wheelAction !== ACTION.ZOOM) {
      return;
    }
    event.preventDefault();
    this._cancelAnimationToCurrent();
    const step = this._computeWheelStep(event);
    this.currentAction = wheelAction;
    this._isDollyingByUser = true;
    this._dispatchControlStart();
    if (wheelAction === ACTION.ZOOM) {
      const zoomStep = this._computeWheelZoomStep(event);
      const immediateZoomStep = zoomStep * this.wheelImmediateRatio;
      const residualZoomStep = zoomStep - immediateZoomStep;
      this._zoomByWheelStep(immediateZoomStep);
      this._zoomWheelVelocity += residualZoomStep * this.zoomImpulseGain;
    } else {
      const immediateStep = step * this.wheelImmediateRatio;
      const residualStep = step - immediateStep;
      this._moveForward(immediateStep);
      if (this._camera.isOrthographicCamera) {
        this._zoomInertiaVelocity += residualStep * this.zoomImpulseGain;
      } else {
        this._forwardVelocity += residualStep * this.wheelImpulseGain;
      }
    }
    this.dispatchEvent({ type: "control" });
    this.currentAction = ACTION.NONE;
    this._isDollyingByUser = false;
    this.dispatchEvent({ type: "controlend" });
  }
  // 阻止右键弹出浏览器默认菜单。
  _handleContextMenu(event) {
    if (!this._enabled) {
      return;
    }
    event.preventDefault();
  }
  // 刷新当前 DOM 边界矩形缓存。
  _updateElementRect() {
    if (!this._domElement) {
      return;
    }
    this._elementRect = this._domElement.getBoundingClientRect();
  }
  // 在 document 上注册拖动阶段需要的事件。
  _addDocumentPointerListeners() {
    const doc = this._ownerDocument ?? document;
    doc.addEventListener("pointermove", this._onPointerMove, { passive: false });
    doc.addEventListener("pointerup", this._onPointerUp);
    doc.addEventListener("pointercancel", this._onPointerCancel);
  }
  // 从 document 上移除拖动阶段事件。
  _removeDocumentPointerListeners() {
    const doc = this._ownerDocument ?? document;
    doc.removeEventListener("pointermove", this._onPointerMove, { passive: false });
    doc.removeEventListener("pointerup", this._onPointerUp);
    doc.removeEventListener("pointercancel", this._onPointerCancel);
  }
  // 重置当前桌面端和触摸端交互状态。
  _resetPointerInteraction() {
    this._activePointerId = null;
    this._activeButton = null;
    this._hasPassedDragThreshold = false;
    this._hasPendingOrbitPoint = false;
    this.currentAction = ACTION.NONE;
    this._activeTouchPointers.clear();
    this._touchMode = "none";
    this._touchLastDistance = 0;
    this._pendingSingleTouchCapture = false;
    this._singleTouchCaptureStart.set(0, 0);
  }
  // 单指捕获是宿主可选策略，默认保留原有 FJD 手势语义。
  // 只有宿主显式提供策略时才启用单指捕获兼容层。
  _shouldCaptureSingleTouchGesture() {
    return typeof this.shouldCaptureSingleTouch === "function" && this.shouldCaptureSingleTouch() === true;
  }
  // 在开始控制时统一补发兼容事件。
  _dispatchControlStart() {
    this.dispatchEvent({ type: "transitionstart" });
    this.dispatchEvent({ type: "controlstart" });
  }
  // 清空交互惯性层中的剩余速度，避免程序动画继承上一段手势的运动趋势。
  _clearUserInertia({ preserveRotation = false } = {}) {
    if (!preserveRotation) {
      this._yawVelocity = 0;
      this._pitchVelocity = 0;
    }
    this._panVelocity.set(0, 0, 0);
    this._forwardVelocity = 0;
    this._zoomInertiaVelocity = 0;
    this._zoomWheelVelocity = 0;
    this._isRotatingByUser = false;
    this._isPanningByUser = false;
    this._isDollyingByUser = false;
  }
  // 将一段旋转输入拆成“立即响应 + 惯性脉冲”，兼顾跟手性与松手后的拖尾。
  _applyRotateInput(yaw, pitch, deltaTime = this._lastUpdateDelta) {
    const immediateYaw = yaw * this.rotateImmediateRatio;
    const immediatePitch = pitch * this.rotateImmediateRatio;
    const residualYaw = yaw - immediateYaw;
    const residualPitch = pitch - immediatePitch;
    const safeDelta = Math.max(Number(deltaTime) || 0, 1 / 120);
    this._rotateByAngles(immediateYaw, immediatePitch);
    this._yawVelocity += residualYaw / safeDelta * this.rotateImpulseGain;
    this._pitchVelocity += residualPitch / safeDelta * this.rotateImpulseGain;
  }
  // 把世界空间中的平移位移作用到相机位姿本身，保持 FJD 现有“平移不改变旋转中心”的语义。
  _applyPanOffset(offset) {
    this._positionEnd.add(offset);
    this._position.add(offset);
    this._quaternion.copy(this._quaternionEnd);
    this._orbitPointCurrent.copy(this._orbitPoint);
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 每帧推进交互惯性。这里不改变 FJD 的空间模型，只复用既有位姿更新语义。
  _updateUserInertia(delta) {
    const safeDelta = Math.max(Number(delta) || 0, 1 / 120);
    const panStopThresholdSq = this.panStopThreshold * this.panStopThreshold;
    if (Math.abs(this._yawVelocity) > this.rotateStopThreshold || Math.abs(this._pitchVelocity) > this.rotateStopThreshold) {
      this._rotateByAngles(this._yawVelocity * safeDelta, this._pitchVelocity * safeDelta);
      const rotateDecay = Math.exp(-this.rotateDamping * safeDelta);
      this._yawVelocity *= rotateDecay;
      this._pitchVelocity *= rotateDecay;
      if (Math.abs(this._yawVelocity) <= this.rotateStopThreshold) {
        this._yawVelocity = 0;
      }
      if (Math.abs(this._pitchVelocity) <= this.rotateStopThreshold) {
        this._pitchVelocity = 0;
      }
    }
    if (this._panVelocity.lengthSq() > panStopThresholdSq) {
      this._applyPanOffset(this._tmpOffset.copy(this._panVelocity).multiplyScalar(safeDelta));
      this._panVelocity.multiplyScalar(Math.exp(-this.panDamping * safeDelta));
      if (this._panVelocity.lengthSq() <= panStopThresholdSq) {
        this._panVelocity.set(0, 0, 0);
      }
    }
    if (this._camera.isOrthographicCamera) {
      if (Math.abs(this._zoomInertiaVelocity) > this.zoomStopThreshold) {
        this._moveForward(this._zoomInertiaVelocity * safeDelta);
        const zoomDecay = Math.exp(-this.zoomDamping * safeDelta);
        this._zoomInertiaVelocity *= zoomDecay;
        if (Math.abs(this._zoomInertiaVelocity) <= this.zoomStopThreshold) {
          this._zoomInertiaVelocity = 0;
        }
      }
      return;
    }
    if (Math.abs(this._zoomWheelVelocity) > this.zoomStopThreshold) {
      this._zoomByWheelStep(this._zoomWheelVelocity * safeDelta);
      const zoomDecay = Math.exp(-this.zoomDamping * safeDelta);
      this._zoomWheelVelocity *= zoomDecay;
      if (Math.abs(this._zoomWheelVelocity) <= this.zoomStopThreshold) {
        this._zoomWheelVelocity = 0;
      }
    }
    if (Math.abs(this._forwardVelocity) > this.wheelStopThreshold) {
      this._moveForward(this._forwardVelocity * safeDelta);
      const wheelDecay = Math.exp(-this.wheelDamping * safeDelta);
      this._forwardVelocity *= wheelDecay;
      if (Math.abs(this._forwardVelocity) <= this.wheelStopThreshold) {
        this._forwardVelocity = 0;
      }
    }
  }
  // 统一解析 fit 目标，并在退化目标时回退到宿主提供的参考包围盒。
  // 输入既可以是 Box3，也可以是 Sphere、Object3D 或点测量对象。
  _resolveFitTargetBounds(sphereOrObject, out = this._tmpBox) {
    if (!sphereOrObject) {
      return null;
    }
    if (Array.isArray(sphereOrObject.points)) {
      const measurementPoints = sphereOrObject.points.map((point) => point?.position).filter((position) => position?.isVector3);
      if (measurementPoints.length > 0) {
        return out.setFromPoints(measurementPoints);
      }
    }
    if (sphereOrObject.isBox3) {
      return out.copy(sphereOrObject);
    }
    if (sphereOrObject.center?.isVector3 && Number.isFinite(sphereOrObject.radius)) {
      return out.setFromCenterAndSize(
        sphereOrObject.center,
        this._tmpPosition.setScalar(Math.max(sphereOrObject.radius, 0) * 2)
      );
    }
    if (sphereOrObject.name === "point" && Array.isArray(sphereOrObject.points) && sphereOrObject.points[0]?.position?.isVector3) {
      out.makeEmpty();
      out.expandByPoint(sphereOrObject.points[0].position);
      return out;
    }
    if (sphereOrObject.isObject3D) {
      const bounds = out.makeEmpty();
      bounds.expandByObject(sphereOrObject);
      if (bounds.isEmpty()) {
        const worldPosition = this._tmpPosition;
        sphereOrObject.getWorldPosition?.(worldPosition);
        bounds.expandByPoint(worldPosition);
      }
      return bounds;
    }
    return null;
  }
  // 解析 fit 时使用的参考包围盒。
  // 默认只在退化目标时回退；调用方也可显式强制走宿主参考尺度。
  _resolveFitReferenceBounds(targetBounds, out = this._tmpBox2, options = {}) {
    const forceReferenceBounds = options?.forceReferenceBounds === true;
    const targetSize = targetBounds.getSize(this._tmpPosition2);
    if (!forceReferenceBounds && targetSize.lengthSq() > Number.EPSILON) {
      return out.copy(targetBounds);
    }
    const resolvedBounds = this._fitReferenceBoundsResolver?.(targetBounds.clone());
    if (resolvedBounds?.isBox3 && !resolvedBounds.isEmpty()) {
      return out.copy(resolvedBounds);
    }
    return out.copy(targetBounds);
  }
  // 触摸端输入处理，单指旋转、双指平移与缩放都在这里完成。
  // 处理触摸端 pointerdown。
  _handleTouchPointerDown(event) {
    if (!this._enabled || !this._domElement || this._activePointerId != null) {
      return;
    }
    this._cancelAnimationToCurrent();
    this._updateElementRect();
    this._activeTouchPointers.set(
      event.pointerId,
      new THREEProxy.Vector2(event.clientX, event.clientY)
    );
    if (this._activeTouchPointers.size === 1) {
      const oneTouchAction = this._resolveInputAction(this.touches.one);
      if (oneTouchAction === ACTION.NONE) {
        return;
      }
      const point = this._getPrimaryTouchPoint();
      this._touchMode = "one";
      this._dragStartClient.copy(point);
      this._lastClient.copy(point);
      this._hasPassedDragThreshold = false;
      this._pendingSingleTouchCapture = this._shouldCaptureSingleTouchGesture();
      this._singleTouchCaptureStart.copy(point);
      this._clickRestoreOrbitPoint.copy(this._orbitPoint);
      this._hasPendingOrbitPoint = false;
      this._tryUpdateOrbitPointFromPointerDown(point.x, point.y);
      this._addDocumentPointerListeners();
      return;
    }
    if (this._activeTouchPointers.size === 2) {
      const twoTouchAction = this._resolveInputAction(this.touches.two);
      if (twoTouchAction === ACTION.NONE) {
        return;
      }
      this._pendingSingleTouchCapture = false;
      if (this.currentAction !== ACTION.NONE) {
        this.dispatchEvent({ type: "controlend" });
      }
      const { center, distance } = this._computeTwoTouchGestureState();
      this._touchMode = "two";
      this._touchLastCenter.copy(center);
      this._touchLastDistance = distance;
      this.currentAction = twoTouchAction;
      this._dispatchControlStart();
    }
  }
  // 处理触摸端 pointermove。
  _handleTouchPointerMove(event) {
    if (!this._enabled || !this._activeTouchPointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    this._activeTouchPointers.get(event.pointerId).set(event.clientX, event.clientY);
    if (this._touchMode === "one" && this._activeTouchPointers.size === 1) {
      const point = this._getPrimaryTouchPoint();
      if (this._pendingSingleTouchCapture) {
        const captureDeltaX = point.x - this._singleTouchCaptureStart.x;
        const captureDeltaY = point.y - this._singleTouchCaptureStart.y;
        const captureThresholdSq = this.touchTapThreshold * this.touchTapThreshold;
        const hasPassedCaptureThreshold = captureDeltaX * captureDeltaX + captureDeltaY * captureDeltaY >= captureThresholdSq;
        if (!hasPassedCaptureThreshold) {
          this._lastClient.copy(point);
          return;
        }
        this._pendingSingleTouchCapture = false;
        this._dragStartClient.copy(point);
        this._lastClient.copy(point);
        return;
      }
      const deltaX = point.x - this._lastClient.x;
      const deltaY = point.y - this._lastClient.y;
      const totalDeltaX = point.x - this._dragStartClient.x;
      const totalDeltaY = point.y - this._dragStartClient.y;
      const thresholdSq = this.dragThreshold * this.dragThreshold;
      const hasPassedDragThreshold = totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY > thresholdSq;
      if (!hasPassedDragThreshold) {
        this._lastClient.copy(point);
        return;
      }
      if (!this._hasPassedDragThreshold) {
        this._hasPassedDragThreshold = true;
        this.currentAction = ACTION.ROTATE;
        this._isRotatingByUser = true;
        this._dispatchControlStart();
      }
      this._rotateByPointerDelta(deltaX, deltaY);
      this.dispatchEvent({ type: "control" });
      this._lastClient.copy(point);
      return;
    }
    if (this._touchMode === "two" && this._activeTouchPointers.size >= 2) {
      const twoTouchAction = this._resolveInputAction(this.touches.two);
      if (twoTouchAction === ACTION.NONE) {
        return;
      }
      const { center, distance } = this._computeTwoTouchGestureState();
      const deltaCenterX = center.x - this._touchLastCenter.x;
      const deltaCenterY = center.y - this._touchLastCenter.y;
      const deltaDistance = distance - this._touchLastDistance;
      const shouldTruck = twoTouchAction === ACTION.TRUCK || this._includesInputAction(twoTouchAction, ACTION.TRUCK);
      const shouldDolly = twoTouchAction === ACTION.DOLLY || this._includesInputAction(twoTouchAction, ACTION.DOLLY);
      const shouldZoom = twoTouchAction === ACTION.ZOOM;
      this._isPanningByUser = shouldTruck;
      this._isDollyingByUser = shouldDolly || shouldZoom;
      if (shouldTruck) {
        this._panByPixels(deltaCenterX, deltaCenterY);
      }
      if (shouldDolly) {
        this._moveForward(this._computePinchForwardDistance(deltaDistance));
      }
      if (shouldZoom) {
        this._zoomByWheelStep(this._computePinchZoomStep(deltaDistance));
      }
      this.dispatchEvent({ type: "control" });
      this._touchLastCenter.copy(center);
      this._touchLastDistance = distance;
    }
  }
  // 处理触摸端 pointerup。
  _handleTouchPointerUp(event) {
    if (!this._activeTouchPointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    const hadControlAction = this.currentAction !== ACTION.NONE;
    const wasSingleTouchTap = this._touchMode === "one" && !this._hasPassedDragThreshold;
    this._activeTouchPointers.delete(event.pointerId);
    if (wasSingleTouchTap) {
      this._restoreOrbitPointAfterClickIfNeeded();
    }
    if (hadControlAction) {
      this._isRotatingByUser = false;
      this._isPanningByUser = false;
      this._isDollyingByUser = false;
      this.dispatchEvent({ type: "controlend" });
    }
    if (this._activeTouchPointers.size === 0) {
      this._removeDocumentPointerListeners();
      this._resetPointerInteraction();
      return;
    }
    if (this._activeTouchPointers.size === 1) {
      const point = this._getPrimaryTouchPoint();
      this._touchMode = "one";
      this.currentAction = ACTION.NONE;
      this._dragStartClient.copy(point);
      this._lastClient.copy(point);
      this._hasPassedDragThreshold = false;
      this._pendingSingleTouchCapture = false;
      this._singleTouchCaptureStart.copy(point);
      this._clickRestoreOrbitPoint.copy(this._orbitPoint);
      this._hasPendingOrbitPoint = false;
      return;
    }
    const { center, distance } = this._computeTwoTouchGestureState();
    const twoTouchAction = this._resolveInputAction(this.touches.two);
    this._touchMode = "two";
    this.currentAction = twoTouchAction;
    this._isPanningByUser = twoTouchAction === ACTION.TRUCK || this._includesInputAction(twoTouchAction, ACTION.TRUCK);
    this._touchLastCenter.copy(center);
    this._touchLastDistance = distance;
    this._dispatchControlStart();
  }
  // 处理触摸端 pointercancel。
  _handleTouchPointerCancel(event) {
    this._handleTouchPointerUp(event);
  }
  // 读取当前唯一触摸点。
  _getPrimaryTouchPoint() {
    return this._activeTouchPointers.values().next().value;
  }
  // 计算双指手势的中心点和指间距离。
  _computeTwoTouchGestureState() {
    const points = Array.from(this._activeTouchPointers.values());
    const first = points[0];
    const second = points[1];
    const center = this._tmpTouchCenter.set(
      (first.x + second.x) * 0.5,
      (first.y + second.y) * 0.5
    );
    const distance = first.distanceTo(second);
    return { center, distance };
  }
  // 把双指距离变化换算为前进距离。
  _computePinchForwardDistance(deltaDistance) {
    if (!Number.isFinite(deltaDistance) || deltaDistance === 0) {
      return 0;
    }
    const orbitDistance = computeOrbitDistance(this._positionEnd, this._orbitPoint);
    const normalizedDelta = deltaDistance / Math.max(this._elementRect.height, 1);
    return orbitDistance * normalizedDelta * this.dollySpeed * TOUCH_PINCH_FORWARD_RATIO;
  }
  // 左键按下时可由外部拾取新的旋转中心；单击结束后再按需回滚。
  // 在按下瞬间尝试拾取新的旋转中心。
  _tryUpdateOrbitPointFromPointerDown(clientX, clientY) {
    if (!this._resolveOrbitPoint) {
      return;
    }
    const resolvedPoint = this._resolveOrbitPoint(clientX, clientY);
    if (!resolvedPoint) {
      return;
    }
    this._pendingOrbitPoint.copy(resolvedPoint);
    this._orbitPoint.copy(resolvedPoint);
    this._orbitPointCurrent.copy(resolvedPoint);
    this._hasPendingOrbitPoint = true;
  }
  // 单击结束且未拖动时恢复按下前的旋转中心。
  _restoreOrbitPointAfterClickIfNeeded() {
    if (!this._hasPendingOrbitPoint) {
      return;
    }
    this._orbitPoint.copy(this._clickRestoreOrbitPoint);
    this._orbitPointCurrent.copy(this._clickRestoreOrbitPoint);
  }
  // 核心位姿变换实现，所有公开 API 最终都会落到这些内部方法。
  // 根据屏幕位移计算旋转增量。
  _rotateByPointerDelta(deltaX, deltaY) {
    const { yaw, pitch } = computeRotateAngles(
      deltaX,
      deltaY,
      this._elementRect.height,
      this.azimuthRotateSpeed,
      this.polarRotateSpeed
    );
    const clampedPitch = clampPitchAngleDelta(
      pitch,
      this._quaternionEnd,
      this._worldUp,
      this.minPolarAngle,
      this.maxPolarAngle
    );
    this._applyRotateInput(yaw, clampedPitch, this._lastUpdateDelta);
  }
  // 按给定偏航角与俯仰角直接旋转相机位姿。
  _rotateByAngles(yaw, pitch) {
    const clampedPitch = clampPitchAngleDelta(
      pitch,
      this._quaternionEnd,
      this._worldUp,
      this.minPolarAngle,
      this.maxPolarAngle
    );
    const deltaQuaternion = composeOrbitDeltaQuaternion(
      yaw,
      clampedPitch,
      this._quaternionEnd,
      this._worldUp,
      this._tmpQuaternion
    );
    rotateCameraPoseAroundPivot(
      this._positionEnd,
      this._quaternionEnd,
      this._orbitPoint,
      deltaQuaternion,
      this._tmpPosition,
      this._tmpQuaternion2
    );
    this._positionEnd.copy(this._tmpPosition);
    this._quaternionEnd.copy(this._tmpQuaternion2);
    this._position.copy(this._positionEnd);
    this._quaternion.copy(this._quaternionEnd);
    this._orbitPointCurrent.copy(this._orbitPoint);
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 根据屏幕像素位移执行平移。
  _panByPixels(deltaX, deltaY) {
    const offset = this._camera.isOrthographicCamera ? this._getOrthographicPanOffset(deltaX, deltaY, this._tmpOffset) : computePanOffset(
      deltaX,
      deltaY,
      Math.max(computeOrbitDistance(this._positionEnd, this._orbitPoint), Number.EPSILON),
      this._elementRect.height,
      degToRad(
        this._camera.getEffectiveFOV ? this._camera.getEffectiveFOV() : this._camera.fov
      ),
      this.truckSpeed,
      this._quaternionEnd,
      this._tmpOffset
    );
    const safeDelta = Math.max(this._lastUpdateDelta, 1 / 120);
    const immediateOffset = this._tmpDirection.copy(offset).multiplyScalar(this.panImmediateRatio);
    const residualOffset = this._tmpDirection2.copy(offset).sub(immediateOffset);
    this._applyPanOffset(immediateOffset);
    this._panVelocity.addScaledVector(residualOffset, this.panImpulseGain / safeDelta);
  }
  // 执行前进或后退；正交相机下会退化为 zoom 调整。
  _moveForward(distance) {
    if (this._camera.isOrthographicCamera) {
      this._zoomEnd = this._getForwardDistanceAsOrthographicZoom(distance);
      this._zoom = this._zoomEnd;
      this._position.copy(this._positionEnd);
      this._quaternion.copy(this._quaternionEnd);
      this._orbitPointCurrent.copy(this._orbitPoint);
      this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
      return;
    }
    const offset = computeForwardOffset(distance, this._quaternionEnd, this._tmpOffset);
    this._positionEnd.add(offset);
    this._position.copy(this._positionEnd);
    this._quaternion.copy(this._quaternionEnd);
    this._orbitPointCurrent.copy(this._orbitPoint);
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 按无量纲缩放步长调整 camera.zoom，不改变相机刚体位置。
  _zoomByWheelStep(step) {
    const zoomScale = Math.exp((Number(step) || 0) * this.dollySpeed);
    this._zoomEnd = this._sanitizeZoom(this._zoomEnd * zoomScale);
    this._zoom = this._zoomEnd;
    this._position.copy(this._positionEnd);
    this._quaternion.copy(this._quaternionEnd);
    this._orbitPointCurrent.copy(this._orbitPoint);
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 根据滚轮事件计算纯 zoom 语义的投影倍率步长。
  _computeWheelZoomStep(event) {
    const wheelMagnitude = Math.min(Math.max(Math.abs(event.deltaY), 1), 120) / 120;
    return event.deltaY < 0 ? WHEEL_ZOOM_STEP_RATIO * wheelMagnitude : -WHEEL_ZOOM_STEP_RATIO * wheelMagnitude;
  }
  // 根据双指捏合像素变化计算纯 zoom 语义的投影倍率步长。
  _computePinchZoomStep(deltaDistance) {
    const viewportHeight = Math.max(this._elementRect.height, 1);
    return (Number(deltaDistance) || 0) / viewportHeight * TOUCH_PINCH_ZOOM_RATIO;
  }
  // 根据滚轮事件计算本次缩放步长。
  _computeWheelStep(event) {
    const orbitDistance = computeOrbitDistance(this._positionEnd, this._orbitPoint);
    const baseStep = Math.max(MIN_WHEEL_STEP, orbitDistance * WHEEL_STEP_RATIO) * this.dollySpeed;
    const wheelMagnitude = Math.min(Math.max(Math.abs(event.deltaY), 1), 120) / 120;
    return event.deltaY < 0 ? baseStep * wheelMagnitude : -baseStep * wheelMagnitude;
  }
  // 把内部状态写回 three.js 相机，并负责管理补间终点。
  // 这是唯一真正把状态同步到 three.js camera 的出口。
  _applyPoseToCamera(position, quaternion, zoom = this._zoom) {
    this._camera.position.copy(position);
    this._camera.quaternion.copy(quaternion);
    const nextZoom = this._sanitizeZoom(zoom);
    if (this._camera.zoom !== nextZoom) {
      this._camera.zoom = nextZoom;
      this._camera.updateProjectionMatrix();
    }
    this._camera.updateMatrix();
    this._camera.updateMatrixWorld(true);
    this._hasUpdated = true;
  }
  // 设置新的目标位姿，并按需选择立即生效或补间生效。
  _setPose(position, quaternion, orbitPoint, enableTransition, zoom = this._zoomEnd, options = {}) {
    this._clearUserInertia({ preserveRotation: options.preserveRotationInertia === true });
    this._positionEnd.copy(position);
    this._quaternionEnd.copy(quaternion);
    this._orbitPoint.copy(orbitPoint);
    this._zoomEnd = this._sanitizeZoom(zoom);
    if (!enableTransition || this.smoothTime <= 0) {
      this._position.copy(this._positionEnd);
      this._quaternion.copy(this._quaternionEnd);
      this._orbitPointCurrent.copy(this._orbitPoint);
      this._zoom = this._zoomEnd;
      this._isAnimating = false;
      this._pendingRestEvent = false;
      this._resolveTransitionPromises();
      this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
      return Promise.resolve();
    }
    this._isAnimating = true;
    this._pendingRestEvent = true;
    this.dispatchEvent({ type: "transitionstart" });
    return this._createTransitionPromise();
  }
  // 插值动画与过渡 Promise 维护。
  // 按指数收敛方式推进位置、旋转、目标点和 zoom。
  _updateTransition(delta) {
    const safeDelta = Math.max(delta || 0, 1 / 60);
    const smoothTime = this._getActiveSmoothTime();
    const positionDistance = this._position.distanceTo(this._positionEnd);
    const orbitDistance = this._orbitPointCurrent.distanceTo(this._orbitPoint);
    const rotationDistance = this._quaternion.angleTo(this._quaternionEnd);
    const zoomDistance = Math.abs(this._zoom - this._zoomEnd);
    if (positionDistance <= this.restThreshold && orbitDistance <= this.restThreshold && rotationDistance <= this.rotationRestThreshold && zoomDistance <= this.zoomRestThreshold) {
      this._position.copy(this._positionEnd);
      this._quaternion.copy(this._quaternionEnd);
      this._orbitPointCurrent.copy(this._orbitPoint);
      this._zoom = this._zoomEnd;
      this._isAnimating = false;
      this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
      this._resolveTransitionPromises();
      return;
    }
    const interpolationFactor = 1 - Math.exp(-safeDelta / Math.max(smoothTime, Number.EPSILON));
    this._position.lerp(this._positionEnd, interpolationFactor);
    this._orbitPointCurrent.lerp(this._orbitPoint, interpolationFactor);
    this._zoom = lerp(this._zoom, this._zoomEnd, interpolationFactor);
    this._quaternion.slerp(this._quaternionEnd, interpolationFactor).normalize();
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
  }
  // 读取当前启用的平滑时间。
  _getActiveSmoothTime() {
    return this.smoothTime;
  }
  // 用当前可见状态打断动画，并重置终点。
  _cancelAnimationToCurrent() {
    if (!this._isAnimating) {
      return;
    }
    this._positionEnd.copy(this._position);
    this._quaternionEnd.copy(this._quaternion);
    this._orbitPoint.copy(this._orbitPointCurrent);
    this._zoomEnd = this._zoom;
    this._isAnimating = false;
    this._pendingRestEvent = false;
    this._resolveTransitionPromises();
  }
  // 创建一个在补间结束时 resolve 的 Promise。
  _createTransitionPromise() {
    return new Promise((resolve) => {
      this._transitionResolvers.push(resolve);
    });
  }
  // 统一清空并触发所有补间完成回调。
  _resolveTransitionPromises() {
    const resolvers = this._transitionResolvers.splice(0, this._transitionResolvers.length);
    for (const resolve of resolvers) {
      resolve();
    }
  }
  // 兼容 camera-controls 的绝对旋转、缩放与位姿接口。
  // 按绝对球坐标角度重建相机位姿。
  rotateTo(theta, phi, enableTransition = false) {
    this._cancelAnimationToCurrent();
    const currentSpherical = this.getSpherical(this._tmpSpherical, true);
    const clampedTheta = THREEProxy.MathUtils.clamp(
      theta,
      this.minAzimuthAngle,
      this.maxAzimuthAngle
    );
    const clampedPhi = THREEProxy.MathUtils.clamp(
      phi,
      this.minPolarAngle,
      this.maxPolarAngle
    );
    computeOrbitPoseFromSpherical(
      clampedTheta,
      clampedPhi,
      currentSpherical.radius,
      this._orbitPoint,
      this._worldUp,
      this._tmpPosition,
      this._tmpQuaternion
    );
    return this._setPose(this._tmpPosition, this._tmpQuaternion, this._orbitPoint, enableTransition);
  }
  // 仅按绝对方位角旋转。
  rotateAzimuthTo(theta, enableTransition = false) {
    const currentSpherical = this.getSpherical(this._tmpSpherical, true);
    return this.rotateTo(theta, currentSpherical.phi, enableTransition);
  }
  // 仅按绝对极角旋转。
  rotatePolarTo(phi, enableTransition = false) {
    const currentSpherical = this.getSpherical(this._tmpSpherical, true);
    return this.rotateTo(currentSpherical.theta, phi, enableTransition);
  }
  // 兼容 pan 别名，内部仍走 truck。
  pan(x, y, enableTransition = false) {
    return this.truck(x, y, enableTransition);
  }
  // 按增量方式执行 dolly。
  dolly(distance, enableTransition = false) {
    const currentSpherical = this.getSpherical(this._tmpSpherical, true);
    return this.dollyTo(currentSpherical.radius - distance, enableTransition);
  }
  // 把旋转中心距离调整到指定值。
  dollyTo(distance, enableTransition = false) {
    this._cancelAnimationToCurrent();
    const clampedDistance = THREEProxy.MathUtils.clamp(
      distance,
      this.minDistance,
      this.maxDistance
    );
    if (this._camera.isOrthographicCamera) {
      const currentDistance = Math.max(
        computeOrbitDistance(this._positionEnd, this._orbitPoint),
        Number.EPSILON
      );
      const targetZoom = this._sanitizeZoom(
        this._zoomEnd * currentDistance / Math.max(clampedDistance, Number.EPSILON)
      );
      return this.zoomTo(targetZoom, enableTransition);
    }
    const direction = this._tmpOffset.copy(this._positionEnd).sub(this._orbitPoint).normalize();
    const nextPosition = this._tmpPosition.copy(this._orbitPoint).add(direction.multiplyScalar(clampedDistance));
    const nextQuaternion = computeLookAtQuaternion(
      nextPosition,
      this._orbitPoint,
      this._worldUp,
      this._tmpQuaternion
    );
    return this._setPose(nextPosition, nextQuaternion, this._orbitPoint, enableTransition);
  }
  // 沿当前视线整体平移相机与旋转中心，保持二者距离不变。
  dollyInFixed(distance, enableTransition = false) {
    const offset = computeForwardOffset(distance, this._quaternionEnd, this._tmpOffset);
    return this.moveTo(
      this._orbitPoint.x + offset.x,
      this._orbitPoint.y + offset.y,
      this._orbitPoint.z + offset.z,
      enableTransition
    );
  }
  // 沿相机 up 方向整体抬升或下降相机与旋转中心。
  elevate(height, enableTransition = false) {
    const up = this._tmpOffset.copy(this._camera.up);
    if (up.lengthSq() <= Number.EPSILON) {
      up.copy(this._worldUp);
    }
    up.normalize().multiplyScalar(height);
    return this.moveTo(
      this._orbitPoint.x + up.x,
      this._orbitPoint.y + up.y,
      this._orbitPoint.z + up.z,
      enableTransition
    );
  }
  // 保持旋转中心与视距，只重建观察方向。
  lookInDirectionOf(x, y, z, enableTransition = false) {
    const direction = this._tmpOffset.set(x, y, z).sub(this._orbitPoint);
    if (direction.lengthSq() <= Number.EPSILON) {
      return Promise.resolve();
    }
    const radius = Math.max(
      computeOrbitDistance(this._positionEnd, this._orbitPoint),
      this.minDistance,
      Number.EPSILON
    );
    const nextPosition = this._tmpPosition.copy(this._orbitPoint).add(direction.normalize().multiplyScalar(-radius));
    return this.setLookAt(
      nextPosition.x,
      nextPosition.y,
      nextPosition.z,
      this._orbitPoint.x,
      this._orbitPoint.y,
      this._orbitPoint.z,
      enableTransition
    );
  }
  // 按增量修改相机 zoom。
  zoom(zoomStep, enableTransition = false) {
    return this.zoomTo(this._zoomEnd + zoomStep, enableTransition);
  }
  // 把相机 zoom 设置到指定值。
  zoomTo(zoom, enableTransition = false) {
    this._cancelAnimationToCurrent();
    return this._setPose(
      this._positionEnd,
      this._quaternionEnd,
      this._orbitPoint,
      enableTransition,
      this._sanitizeZoom(zoom)
    );
  }
  // 序列化、反序列化与兼容占位 API。
  // 把边界值转换成可稳定写入 JSON 的形式。
  _serializeBoundNumber(value) {
    if (value === Infinity) {
      return "Infinity";
    }
    if (value === -Infinity) {
      return "-Infinity";
    }
    return Number.isFinite(value) ? value : null;
  }
  // 把 JSON 里的边界值恢复为运行期数值。
  _deserializeBoundNumber(value, fallback) {
    if (value === "Infinity") {
      return Infinity;
    }
    if (value === "-Infinity") {
      return -Infinity;
    }
    return Number.isFinite(value) ? value : fallback;
  }
  // 序列化当前控件状态与关键配置。
  toJSON() {
    return JSON.stringify({
      enabled: this._enabled,
      minDistance: this._serializeBoundNumber(this.minDistance),
      maxDistance: this._serializeBoundNumber(this.maxDistance),
      minZoom: this._serializeBoundNumber(this.minZoom),
      maxZoom: this._serializeBoundNumber(this.maxZoom),
      minPolarAngle: this._serializeBoundNumber(this.minPolarAngle),
      maxPolarAngle: this._serializeBoundNumber(this.maxPolarAngle),
      minAzimuthAngle: this._serializeBoundNumber(this.minAzimuthAngle),
      maxAzimuthAngle: this._serializeBoundNumber(this.maxAzimuthAngle),
      infinityDolly: this.infinityDolly,
      smoothTime: this.smoothTime,
      draggingSmoothTime: this.draggingSmoothTime,
      maxSpeed: this._serializeBoundNumber(this.maxSpeed),
      restThreshold: this.restThreshold,
      rotationRestThreshold: this.rotationRestThreshold,
      zoomRestThreshold: this.zoomRestThreshold,
      dollySpeed: this.dollySpeed,
      truckSpeed: this.truckSpeed,
      azimuthRotateSpeed: this.azimuthRotateSpeed,
      polarRotateSpeed: this.polarRotateSpeed,
      dollyDragInverted: this.dollyDragInverted,
      dollyToCursor: this.dollyToCursor,
      dragToOffset: this.dragToOffset,
      boundaryFriction: this.boundaryFriction,
      boundaryEnclosesCamera: this.boundaryEnclosesCamera,
      interactiveArea: this.interactiveArea,
      verticalDragToForward: this.verticalDragToForward,
      dragThreshold: this.dragThreshold,
      touchTapThreshold: this.touchTapThreshold,
      target: this._orbitPoint.toArray(),
      position: this._positionEnd.toArray(),
      quaternion: this._quaternionEnd.toArray(),
      zoom: this._zoomEnd,
      worldUp: this._worldUp.toArray(),
      focalOffset: this._focalOffsetEnd.toArray(),
      target0: this._orbitPoint0.toArray(),
      position0: this._position0.toArray(),
      quaternion0: this._quaternion0.toArray(),
      zoom0: this._zoom0,
      worldUp0: this._worldUp0.toArray(),
      focalOffset0: this._focalOffset0.toArray()
    });
  }
  // 从序列化结果恢复控件状态。
  fromJSON(json, enableTransition = false) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    if (!data || typeof data !== "object") {
      return Promise.resolve();
    }
    this.enabled = data.enabled ?? this.enabled;
    this.minDistance = this._deserializeBoundNumber(data.minDistance, this.minDistance);
    this.maxDistance = this._deserializeBoundNumber(data.maxDistance, this.maxDistance);
    this.minZoom = this._deserializeBoundNumber(data.minZoom, this.minZoom);
    this.maxZoom = this._deserializeBoundNumber(data.maxZoom, this.maxZoom);
    this.minPolarAngle = this._deserializeBoundNumber(data.minPolarAngle, this.minPolarAngle);
    this.maxPolarAngle = this._deserializeBoundNumber(data.maxPolarAngle, this.maxPolarAngle);
    this.minAzimuthAngle = this._deserializeBoundNumber(
      data.minAzimuthAngle,
      this.minAzimuthAngle
    );
    this.maxAzimuthAngle = this._deserializeBoundNumber(
      data.maxAzimuthAngle,
      this.maxAzimuthAngle
    );
    this.smoothTime = Number.isFinite(data.smoothTime) ? data.smoothTime : this.smoothTime;
    this.draggingSmoothTime = Number.isFinite(data.draggingSmoothTime) ? data.draggingSmoothTime : this.draggingSmoothTime;
    this.maxSpeed = this._deserializeBoundNumber(data.maxSpeed, this.maxSpeed);
    this.restThreshold = Number.isFinite(data.restThreshold) ? data.restThreshold : this.restThreshold;
    this.rotationRestThreshold = Number.isFinite(data.rotationRestThreshold) ? data.rotationRestThreshold : this.rotationRestThreshold;
    this.zoomRestThreshold = Number.isFinite(data.zoomRestThreshold) ? data.zoomRestThreshold : this.zoomRestThreshold;
    this.dollySpeed = Number.isFinite(data.dollySpeed) ? data.dollySpeed : this.dollySpeed;
    this.truckSpeed = Number.isFinite(data.truckSpeed) ? data.truckSpeed : this.truckSpeed;
    this.azimuthRotateSpeed = Number.isFinite(data.azimuthRotateSpeed) ? data.azimuthRotateSpeed : this.azimuthRotateSpeed;
    this.polarRotateSpeed = Number.isFinite(data.polarRotateSpeed) ? data.polarRotateSpeed : this.polarRotateSpeed;
    this.infinityDolly = data.infinityDolly ?? this.infinityDolly;
    this.dollyDragInverted = data.dollyDragInverted ?? this.dollyDragInverted;
    this.dollyToCursor = data.dollyToCursor ?? this.dollyToCursor;
    this.dragToOffset = data.dragToOffset ?? this.dragToOffset;
    this.boundaryFriction = Number.isFinite(data.boundaryFriction) ? data.boundaryFriction : this.boundaryFriction;
    this.boundaryEnclosesCamera = data.boundaryEnclosesCamera ?? this.boundaryEnclosesCamera;
    this.verticalDragToForward = data.verticalDragToForward ?? this.verticalDragToForward;
    if (data.interactiveArea && typeof data.interactiveArea === "object") {
      this.interactiveArea = data.interactiveArea;
    }
    this.dragThreshold = Number.isFinite(data.dragThreshold) ? data.dragThreshold : this.dragThreshold;
    this.touchTapThreshold = Number.isFinite(data.touchTapThreshold) ? data.touchTapThreshold : this.touchTapThreshold;
    if (Array.isArray(data.target0) && data.target0.length >= 3) {
      this._orbitPoint0.fromArray(data.target0);
    }
    if (Array.isArray(data.position0) && data.position0.length >= 3) {
      this._position0.fromArray(data.position0);
    }
    if (Array.isArray(data.quaternion0) && data.quaternion0.length >= 4) {
      this._quaternion0.fromArray(data.quaternion0).normalize();
    }
    if (Number.isFinite(data.zoom0)) {
      this._zoom0 = this._sanitizeZoom(data.zoom0);
    }
    if (Array.isArray(data.worldUp0) && data.worldUp0.length >= 3) {
      this._resolveWorldUp(data.worldUp0, this._worldUp0, this._worldUp0);
    }
    if (Array.isArray(data.focalOffset0) && data.focalOffset0.length >= 3) {
      this._focalOffset0.fromArray(data.focalOffset0);
    }
    if (Array.isArray(data.focalOffset) && data.focalOffset.length >= 3) {
      this._focalOffsetEnd.fromArray(data.focalOffset);
      this._focalOffset.copy(this._focalOffsetEnd);
    }
    if (Array.isArray(data.worldUp) && data.worldUp.length >= 3) {
      this._resolveWorldUp(data.worldUp, this._worldUp, this._worldUp);
      this._camera.up.copy(this._worldUp);
    }
    const nextTarget = Array.isArray(data.target) && data.target.length >= 3 ? this._tmpOffset.fromArray(data.target) : this._tmpOffset.copy(this._orbitPoint);
    const nextPosition = Array.isArray(data.position) && data.position.length >= 3 ? this._tmpPosition.fromArray(data.position) : this._tmpPosition.copy(this._positionEnd);
    const nextQuaternion = Array.isArray(data.quaternion) && data.quaternion.length >= 4 ? this._tmpQuaternion.fromArray(data.quaternion).normalize() : computeLookAtQuaternion(
      nextPosition,
      nextTarget,
      this._worldUp,
      this._tmpQuaternion
    );
    const nextZoom = Number.isFinite(data.zoom) ? this._sanitizeZoom(data.zoom) : this._zoomEnd;
    return this._setPose(
      nextPosition,
      nextQuaternion,
      nextTarget,
      enableTransition,
      nextZoom
    );
  }
  // 对两组状态做线性插值并生成新的 lookAt 结果。
  lerp(stateA, stateB, t, enableTransition = false) {
    const clampedT = THREEProxy.MathUtils.clamp(Number(t) || 0, 0, 1);
    const targetA = this._tmpPosition.fromArray(stateA?.target ?? [0, 0, 0]);
    const targetB = this._tmpPosition2.fromArray(stateB?.target ?? [0, 0, 0]);
    const nextTarget = this._tmpOffset.copy(targetA).lerp(targetB, clampedT);
    const positionA = this._resolveLerpStatePosition(stateA, targetA, this._tmpDirection);
    const positionB = this._resolveLerpStatePosition(stateB, targetB, this._tmpDirection2);
    const nextPosition = this._tmpPosition.copy(positionA).lerp(positionB, clampedT);
    return this.setLookAt(
      nextPosition.x,
      nextPosition.y,
      nextPosition.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      enableTransition
    );
  }
  // 对两组 position / target 做线性插值。
  lerpLookAt(positionAX, positionAY, positionAZ, targetAX, targetAY, targetAZ, positionBX, positionBY, positionBZ, targetBX, targetBY, targetBZ, t, enableTransition = false) {
    const clampedT = THREEProxy.MathUtils.clamp(Number(t) || 0, 0, 1);
    const nextPosition = this._tmpPosition.set(positionAX, positionAY, positionAZ).lerp(this._tmpPosition2.set(positionBX, positionBY, positionBZ), clampedT);
    const nextTarget = this._tmpOffset.set(targetAX, targetAY, targetAZ).lerp(this._tmpDirection.set(targetBX, targetBY, targetBZ), clampedT);
    return this.setLookAt(
      nextPosition.x,
      nextPosition.y,
      nextPosition.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      enableTransition
    );
  }
  // 设置兼容占位用的 focal offset。
  setFocalOffset(x, y, z, enableTransition = false) {
    this._focalOffsetEnd.set(x, y, z);
    if (!enableTransition) {
      this._focalOffset.copy(this._focalOffsetEnd);
    }
    return Promise.resolve();
  }
  // 读取兼容占位用的 focal offset。
  getFocalOffset(out = new THREEProxy.Vector3(), receiveEndValue = true) {
    return out.copy(receiveEndValue ? this._focalOffsetEnd : this._focalOffset);
  }
  // 设置兼容占位用的 boundary。
  setBoundary(box3 = null) {
    if (box3?.isBox3) {
      this._boundary.copy(box3);
      return;
    }
    this._boundary.makeEmpty();
  }
  // 设置兼容占位用的 viewport。
  setViewport(viewportOrX, y, width, height) {
    if (viewportOrX == null) {
      this._viewport = null;
      return;
    }
    if (viewportOrX.isVector4) {
      this._viewport = viewportOrX.clone();
      return;
    }
    this._viewport = new THREEProxy.Vector4(
      Number(viewportOrX) || 0,
      Number(y) || 0,
      Number(width) || 0,
      Number(height) || 0
    );
  }
  // FJD 不维护累积球坐标，因此直接返回自身。
  normalizeRotations() {
    return this;
  }
  // 在保持世界位置和目标点不变的前提下，用当前 worldUp 重建相机朝向。
  _rebuildQuaternionsForWorldUp() {
    if (this._position.distanceToSquared(this._orbitPointCurrent) > Number.EPSILON) {
      computeLookAtQuaternion(
        this._position,
        this._orbitPointCurrent,
        this._worldUp,
        this._quaternion
      );
    }
    if (this._positionEnd.distanceToSquared(this._orbitPoint) > Number.EPSILON) {
      computeLookAtQuaternion(
        this._positionEnd,
        this._orbitPoint,
        this._worldUp,
        this._quaternionEnd
      );
    }
  }
  // 兼容 camera-controls 的 camera.up 更新接口；同步实例级 up 轴并重新编码当前刚体位姿。
  updateCameraUp() {
    this._resolveWorldUp(this._camera.up, this._worldUp, this._worldUp);
    this._camera.up.copy(this._worldUp);
    this._rebuildQuaternionsForWorldUp();
    this._applyPoseToCamera(this._position, this._quaternion, this._zoom);
    return this;
  }
  // 兼容 camera-controls 的应用 camera.up 接口；先把 up 正交化到当前视线平面，再同步控制模型。
  applyCameraUp() {
    const cameraDirection = this._tmpDirection.copy(this._orbitPointCurrent).sub(this._position);
    if (cameraDirection.lengthSq() <= Number.EPSILON) {
      return this.updateCameraUp();
    }
    cameraDirection.normalize();
    const desiredUp = this._tmpDirection2.copy(this._camera.up);
    if (desiredUp.lengthSq() <= Number.EPSILON) {
      desiredUp.copy(this._worldUp);
    }
    desiredUp.normalize();
    const side = this._tmpDirection3.crossVectors(cameraDirection, desiredUp);
    if (side.lengthSq() <= Number.EPSILON) {
      const absX = Math.abs(cameraDirection.x);
      const absY = Math.abs(cameraDirection.y);
      const absZ = Math.abs(cameraDirection.z);
      if (absX <= absY && absX <= absZ) {
        desiredUp.set(1, 0, 0);
      } else if (absY <= absX && absY <= absZ) {
        desiredUp.set(0, 1, 0);
      } else {
        desiredUp.set(0, 0, 1);
      }
      desiredUp.addScaledVector(cameraDirection, -desiredUp.dot(cameraDirection)).normalize();
      side.crossVectors(cameraDirection, desiredUp);
    }
    if (side.lengthSq() > Number.EPSILON) {
      this._camera.up.crossVectors(side.normalize(), cameraDirection).normalize();
    }
    this._camera.updateMatrixWorld(true);
    return this.updateCameraUp();
  }
  // 解析 lerp 输入里的 position 或 spherical 字段。
  // 统一把不同状态格式转换为世界坐标位置。
  _resolveLerpStatePosition(state, target, out = this._tmpDirection) {
    if (Array.isArray(state?.position) && state.position.length >= 3) {
      return out.fromArray(state.position);
    }
    if (Array.isArray(state?.spherical) && state.spherical.length >= 3) {
      const [radius, phi, theta] = state.spherical;
      computeOrbitPoseFromSpherical(
        theta,
        phi,
        radius,
        target,
        this._worldUp,
        out,
        this._tmpQuaternion
      );
      return out;
    }
    return out.copy(this._positionEnd);
  }
};
export {
  FJDCameraControls
};
