# BoxClippingTool

`Potree.BoxClippingTool` 提供完整的裁切盒编辑和 JSON 接口，不依赖 React、宿主样式或业务资源加载器。通过 `examples/box_clipping.html` 可以体验生成的两份点云，无需下载点云数据。

## 接入

```js
// Choose an explicit cloud; no tool is enabled automatically on existing viewers.
const tool = new Potree.BoxClippingTool(viewer);
tool.addEventListener('change', ({ active, keep, volume }) => {
  updateToolbar({ active, keep, volume });
});
tool.start({ targetCloud: pointcloud });
tool.setKeep('outside');
const data = tool.toJSON();
tool.fromJSON(data);
tool.stop();
// Explicit targets override the default; import applies the result without opening editing.
tool.fromJSON(data, { targetCloud: pointcloud });
// Release on host unmount or viewer disposal.
tool.dispose();
```

| 接口 | 约定 |
| --- | --- |
| `start({targetCloud, matchesTarget?})` | 目标必须已加入当前场景且可见；使用 `scene.getBoundingBox4One` 的精确世界包围盒初始化。显式 `targetCloud` 优先于当前目标；未指定时沿用当前目标，否则选择首个点云。默认只匹配目标对象，谓词可扩展目标集合。开启同一目标的编辑保留已有姿态，指定不同目标则切换。 |
| `active`、`editing`、`volume`、`targetCloud`、`keep` | 只读状态。`active` 表示裁切效果存在，`editing` 表示编辑控件开启，两者独立。关闭后 `volume`、`targetCloud` 为 `null`，`keep` 回到 `inside`。 |
| `setKeep('inside' \| 'outside')` | 切换保留方向，保持位置、旋转和尺寸。 |
| `toJSON()` | 返回普通对象；下载、字符串化由宿主负责。 |
| `fromJSON(data, options?)` | 接收对象或 JSON 字符串，支持 BOM。先完整校验，再更新或创建裁切结果。显式目标优先，否则沿用当前目标或首个点云。导入后隐藏线框和面控件，只保留最终裁切效果；再次 `start()` 可继续编辑。 |
| `stop()` | 关闭并恢复业务裁切，可再次开启。 |
| `dispose()` | 关闭并移除订阅；实例不可再次开启。 |
| `change` | 开启、关闭、方向变化、导入、面拖动和取消时发出，携带 `{tool, active, editing, volume, keep}`。 |

同一个 Viewer 最多一个新工具处于开启状态；开启另一个实例会关闭前一个。切换场景或删除最后一个目标实例会自动关闭。宿主销毁 Viewer 时仍应调用 `dispose()`。

宿主可选择按资源匹配重复实例；匹配规则在开启时捕获，不自动改变目标。所有匹配实例应共享同一源数据坐标系及场景变换：

```js
// Resource identity is host policy, not a global Potree default.
const resource = pointcloud.baseUrl;
tool.start({
  targetCloud: pointcloud,
  matchesTarget: cloud => Boolean(resource) && cloud.baseUrl === resource,
});
```

## 交互与兼容边界

- 黄线显示 12 条边，不显示实体面。每个面中心有移动和旋转按钮，X 为红色、Y 为绿色、Z 为蓝色，正反面同色。
- 鼠标左键拖动移动按钮只移动对应面，对面保持固定；拖动旋转按钮绕该面的外法线旋转整个盒子。水平右移 2 CSS 像素对应右手方向旋转 1°。
- 支持透视、正交相机；近乎正视一个面时，移动使用竖直拖动。重叠按钮由更靠近相机的面优先响应。
- Escape、失焦、指针取消和捕获丢失恢复拖动前姿态。控件挂在 Viewer 画布所属文档，支持 iframe。
- 不改变 `viewer.clipTask`、`viewer.clipMethod` 或原生 TransformControls。工具未启用时没有裁切副作用。
- 现有 keep-inside 高度盒与新盒取交集；保留盒外时仍限制在高度范围内。工具关闭保留最新高度状态。
- 当前范围为一个盒子、桌面鼠标和既有高度盒组合；不定义任意多边形裁切与不同全局布尔裁切模式的组合语义。

## JSON v1

格式标识为 `point-cloud-clip-box`，`version` 为 `1`。只包含这个新裁切盒，不包含高度盒、相机或点云内容；保持此前主项目导出格式兼容。

| 属性 | 含义 |
| --- | --- |
| `coordinateSystem.space` | `point-cloud-source`，原始点云坐标系。 |
| `axes`、`handedness`、`upAxis` | 固定 `xyz`、`right`、`z`。 |
| `unit`、`crs` | `source-unit` 表示沿用源数据单位，不推断为米；CRS 为已知投影字符串或 `null`。 |
| `target.resource` | 资源标识，仅供参考；导入不下载、不切换资源。 |
| `clipping.keep` | `inside` 或 `outside`，表示保留区域。 |
| `boundary` | `inside-inclusive`，边界属于盒内。 |
| `matrixLayout` | `column-major`，矩阵按列展开。 |
| `localBounds` | 标准立方体，三个轴均为 `[-0.5, 0.5]`。 |
| `boxToSource` | 16 个数，将标准立方体变换到原始点云坐标。前三列为三个完整边向量，第四列前三项为盒中心。 |

几何变换为 `sourcePoint = boxToSource * [x, y, z, 1]`。其他系统将源坐标点乘以逆矩阵，三个坐标绝对值均不超过 `0.5` 即为盒内，再按 `keep` 决定保留。

令 `S = cloud.matrixWorld * Translation(-cloud.pcoGeometry.offset)`，导出矩阵为 `inverse(S) * volume.matrixWorld`，导入世界矩阵为 `S * boxToSource`。因此场景居中、贴地或重定位不会破坏源坐标含义。

缺少 loader offset、坐标声明不支持、双方已知 CRS 不一致、非有限或奇异矩阵、镜像和无法用 BoxVolume 表达的剪切均拒绝导入；不会自动重投影。错误通过 `Error.message` 暴露：`Unavailable`、`InvalidJson`、`UnsupportedJson`、`MissingCoordinates`、`UnsupportedCoordinates`，由宿主翻译。

## 验证与构建

```sh
npx vitest run test/BoxClippingTool.test.js test/BoxClippingSession.test.js test/potreeClippingFaces.test.js test/potreeClippingJson.test.js test/potreeOutsideClipBoxes.test.js test/PotreeSourceRegression.test.js
node -e "require('fs').mkdirSync('build', {recursive:true})"
npx gulp shaders
npx rollup -c
```

完整发布仍使用项目的 `npm run build`，包含样式和资源复制。裁切代码本身只新增 JS 模块，控件样式随工具挂载，不要求宿主引入专用 CSS。新工具不会自动接入 Potree 旧侧栏；宿主通过上面的接口放置自己的按钮。
