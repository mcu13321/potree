# 控制点裁切

Potree Viewer 由宿主显式调用裁切接口。传入 Potree 场景坐标中的有序 XY 控制点、选中 ID 和 Z 轴范围。点对象里的原始 Z 值不参与裁切或标签定位。

选中少于三个点时，画布只保留可点击的点位编号。

```js
// Pass points in perimeter order and update the preview whenever the draft changes.
viewer.setControlPointCropPreview({
  points,
  selectedIds,
  zMin: 3.16,
  zMax: 5.75,
  onPointToggle: id => toggleSelection(id),
});
```

`points` 中每个点提供 `id`、`x`、`y`，可选 `label` 和 `accessibleLabel`。选中的点按原始顺序闭合为多边形，范围内的点云可见。有效裁切需要 3 至 64 个点组成的闭合多边形，以及严格递增的 Z 轴范围。

首次打开预览时切换到正交相机并框住控制点。宿主可传入归一化的 `viewport`（`x`、`y`、`width` 和 `height`）以使用侧栏未覆盖的画布区域，默认使用整个画布。预览期间可继续切换投影。退出或确认后保留当前视角。

- `confirmControlPointCrop()` 确认预览，隐藏编辑标签并保留当前场景的裁切效果，返回是否确认成功。
- `cancelControlPointCrop()` 关闭预览并恢复上一次确认的裁切效果。
- `clearControlPointCrop()` 清除该场景的预览和已确认效果。切换 Potree 场景时也会清除。

裁切按点在渲染阶段应用，设计中的绿色上沿、紫色下沿、绿色虚线和编号由 Potree 画布叠层绘制。叠层随预览挂载自身样式，嵌入页面可只加载 Potree 脚本。
