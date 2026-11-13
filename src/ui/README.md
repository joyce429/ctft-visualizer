# 页面交互模块说明

第二阶段页面实现位于 `src/web/`。本目录保留分层约束，供后续把复杂交互状态拆出时使用。

后续 UI 应从生成的数据模块读取信号列表和参数元数据，自动生成滑块/输入框；调用 `src/signals/registry.js` 验证参数并建立数学模型，再把频谱对象交给绘图层。UI 不得硬编码公式、副本信号表或独立参数范围。

最终离线页面应通过普通 `<script type="module">` 或构建后的单文件资源加载 `src/data/generated/signals.generated.js`，运行时不对 `data/*.json` 执行 `fetch`。
