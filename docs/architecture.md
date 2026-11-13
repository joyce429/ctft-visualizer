# 工程架构设计（最终版）

## 目标与边界

当前架构在第一阶段数学基础上加入基础交互网页。网页仍采用纯静态方案，无后台、数据库或运行时网络请求；构建产物可通过 `file://` 直接打开。

设计原则：数据单一来源、数学类型不失真、离线优先、浏览器与 Node 共享纯 JavaScript、公式显示与可执行实现分离。

## 模块关系

```text
data/*.json ──build-data.mjs──> src/data/generated/signals.generated.js
     │                                  │
     │                                  v
     └──文献与公式审查            signals/registry.js
                                         │
              complex.js <── spectrum.js ├──> fourier/index.js
                                         │
                                         v
                                transforms/properties.js
                                         │
                              transforms/signal-transform.js
                                         │
                                         v
                               plotting/sampling.js
                                         │
                                         v
                       web/app.js + ECharts + KaTeX
                                         │ esbuild
                                         v
                             dist/index.html + assets
```

## 目录职责

- `data/signals.json`：唯一信号元数据源，按类别组织公式、参数、约束和来源。
- `data/references.json`：可核查参考文献与访问说明；信号只保存引用 ID。
- `data/transform-properties.json`：统一的 CTFT 性质表。
- `scripts/build-data.mjs`：把 JSON 嵌入 ES module，解决 `file://` 下 `fetch` JSON 的跨源限制。
- `src/math/complex.js`：不可变复数值及基本运算。
- `src/math/spectrum.js`：连续谱、冲激谱、特殊分布和复合谱的数据模型。
- `src/math/time-signal.js`：普通时域分量、定点/周期冲激、冲激导数和符号分布的复合模型。
- `src/signals/registry.js`：参数校验、时域计算和各基础信号频谱构造；通过 `implementationId` 与 JSON 对接。
- `src/fourier/index.js`：傅里叶变换公共入口与数学约定。
- `src/transforms/properties.js`：时移、翻转、尺度、微分和从负无穷积分的频域操作。
- `src/plotting/sampling.js`：把数学频谱转换为绘图数据，统一处理幅值、`atan2` 相位、零幅值、跳变断线和分布奇点。
- `src/transforms/signal-transform.js`：把频域性质、时域求值映射、解析公式和时域冲激映射组合成新的结构化信号模型；提供单项操作与操作队列接口。
- `src/operations/signal-expression.js`：双信号表达式树、复频谱加法/乘法、冲激谱线合并、数值卷积和冲激筛选性质。
- `src/web/app.js`：从数据库建立信号选择器与参数控件，把数学模型传给绘图适配层和 ECharts。
- `src/web/dual-signal-lab.js`：双输入组合编辑器、线性/卷积模式、卷积动画、双信号导入导出和四图联动。
- `src/io/export-data.js`：CSV 转义和固定列宽序列化。
- `src/web/index.html`、`styles.css`：科研软件风格的响应式布局。
- `scripts/build-web.mjs`：使用 esbuild 把现有 ES module、ECharts、KaTeX 和字体打进 `dist/`。
- `scripts/serve.mjs`：本地预览服务器；`--smoke` 模式会自检 HTTP 200 后自动退出。
- `scripts/browser-smoke.mjs`：启动真实 Chrome/Edge，以 `file://` 执行控件、导出、配置恢复和远程请求审计。
- `scripts/package-release.mjs`、`verify-release.mjs`：生成并逐字节核对离线版与静态部署版。
- `tests/`：使用 Node 内置测试运行器，不依赖网络或第三方包。

## 频谱数据模型

### `ContinuousSpectrum`

用于普通函数频谱。`evaluate(omega)` 必须返回 `Complex`；`specialPoints` 记录零频可去奇点、带边等需要明确处理的位置。

### `ImpulseSpectrum`

`lines` 保存 `{frequency, coefficient}`，其中系数是冲激的“面积/权重”而不是绘图高度。周期信号同时保存 `infiniteFamily`，实际 `lines` 只表示当前显示谐波窗。

### `DistributionTerm`

保存 `distributionKind`、准确 LaTeX、奇点集合及可选的 `evaluateAway`。主值分布在奇点处禁止点值计算。

### `CompositeSpectrum`

组合普通连续部分、冲激部分和一个或多个特殊分布。单位阶跃因此表示为：

```text
CompositeSpectrum
├── impulses: πδ(ω)
└── distributions: PV[1/(jω)]
```

这种结构避免把冲激或主值分布误采样成普通浮点数组。

## 参数与输入设计

每个参数包含 `id`、中英文/符号信息、`type`、`default`、范围、步长与单位。通用范围在数据层声明，注册表执行运行时校验；`T1<T0/2` 等跨字段规则由实现层补充。后续 UI 从同一元数据自动生成控件。

第一阶段幅度和频率参数使用实数。教材中允许复数的 `a`（要求 `Re{a}>0`）已在文字约束中保留，但数值控件暂限定 `a>0`，避免界面提前引入复参数编辑器。

## 离线与部署策略

源 JSON 便于维护和审查，构建产物便于浏览器直接加载。未来静态部署与本地打开使用相同的生成模块，不在运行时读取 JSON。数学模块没有 DOM、服务器、数据库或网络依赖。

## 第二阶段绘图规则

- 连续谱数据点保存 `ω、幅值、实部、虚部、相位`，悬停信息不需要重新计算。
- 相位严格通过 `atan2(Im, Re)` 得到；相对幅度小于阈值时写为 `null`。
- 相邻相位跨越约 `π` 时插入断点，避免把 `+π` 和 `−π` 画成错误斜线。
- 冲激谱用 ECharts 自定义箭头系列；箭头编码复系数的模，标签和悬停保留位置、实部、虚部与相位。
- 单位阶跃的 PV 项只画奇点之外的虚线辅助值，`ω=0` 附近留空，同时单独画 `πδ(ω)`。
- 数据缩放、框选缩放、恢复视图、保存图片、图例和交叉指针均由本地 ECharts 提供。

## 第三阶段变换模型

- `reverse`：时域求值调用 `x(-t)`，频域使用 `timeReverse`；冲激位置取负，系数不变。
- `shift(t0)`：时域求值调用 `x(t-t0)`，频域乘 `e^{-jωt0}`；冲激时间位置增加 `t0`。
- `scale(a)`：时域求值调用 `x(at)`，频域使用 `(1/|a|)X(jω/a)`；时域冲激位置除以 `a`、权重除以 `|a|`，频域冲激位置乘 `a`。
- UI 当前只激活一个操作，但 `applyTransformQueue(model, operations)` 已提供组合接口；复杂组合的公式化简尚未进入本阶段。
- 原始模型与变换模型分别采样，再使用两者显示范围的并集，避免靠移动已有绘图数据伪装变换。
- 主值相位在跨越 `±π` 时断线；展开相位以 `2π`（或 `360°`）为周期消除包裹，同时保留零幅值处的空点。

## 第四阶段微积分模型

- `differentiate` 生成解析普通导数，并把每个跳变保存为独立 `TimeImpulse`；对 δ 的微分保存 `derivativeOrder=1`，不采用采样差分。
- `integrate` 仅对具有已实现解析累积积分且 `X(0)` 有限的信号开放；频域保存为 `DistributionTerm(PV)` 与零频 `ImpulseLine` 的组合。
- PV 的绘图曲线只代表奇点外的复值，不定义分布整体的普通幅值或相位；页面标签明确说明这一点。
- 发散的周期信号、常数，以及需要更高阶分布的阶跃再次积分返回 `supported=false` 和可展示原因。

后续阶段可以沿用操作队列加入多操作组合，但不得改变冲激权重含义或把分布降格为采样数组。若引入任意表达式输入，应使用白名单解析器生成表达式树，不能执行用户字符串。

## 精简界面与导出模型

- 最终界面只保留核心信号、变换、三图、解析公式和性质速查，移除实验与独立教学数据层。
- 性质速查由 `transform-properties.json` 驱动；公式字符串使用保留反斜杠的模板构造并交给 KaTeX 渲染。
- 连续谱 CSV 和冲激谱 CSV 分开导出；冲激文件保存位置及复系数，不把 Dirac 冲激降格为采样高度。
- JSON 配置带 `schemaVersion` 与 `convention`，导入时重新执行信号参数和变换参数验证。

## 最终构建与部署

```text
data/*.json → build-data → generated module
                         ↓
src/web + math modules → esbuild → dist/
                                  ├→ release/offline/
                                  └→ release/static-site/
```

- `dist/`、离线版和静态部署版使用同一构建结果，不维护两套业务代码。
- `verify-release` 比较两个发布目录的文件列表与 SHA-256 内容；静态版仅额外包含空 `.nojekyll`。
- GitHub Pages 工作流先执行完整 `npm run check`，再上传 `dist/`。
- 不注册 Service Worker，确保 `file://` 兼容；后续 PWA 只能是 HTTPS 部署的可选增强。

## 双信号表达式与卷积模型

表达式树使用纯 JSON 节点，不执行用户字符串：

```json
{
  "type": "sum",
  "children": [
    {"type": "scale", "factor": 2, "child": {"type": "leaf", "signalId": "rectangular-pulse", "parameters": {"A": 1, "T": 2}}},
    {"type": "shift", "t0": 1, "child": {"type": "leaf", "signalId": "one-sided-exponential", "parameters": {"A": 1, "a": 1}}}
  ]
}
```

- `sum` 在时域递归求和，在频域组合连续项并合并同频冲激复系数。
- `scale / shift / timeScale` 复用既有 CTFT 性质实现，不移动已采样曲线伪装结果。
- `convolution` 的频域部分调用复频谱乘法；含 PV/符号分布或两个冲激频谱时拒绝未定义乘积。
- 普通点值信号的时域卷积在两个有效窗交集上用中点积分，默认800区间；指数窗截到约12个时间常数并在页面标记数值近似。
- 一个输入为单冲激时直接应用筛选性质，保持冲激位置和系数，不参与浮点尖峰积分。
