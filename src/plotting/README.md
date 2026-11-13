# 绘图模块说明

第二阶段已实现 `sampling.js`，负责把数学频谱转换为 ECharts 可消费的数据；ECharts 配置和 DOM 仍留在 `src/web/app.js`。

绘图层只消费数学层提供的类型：

- `ContinuousSpectrum`：在指定角频率网格上调用 `evaluate(omega)`，分别绘制幅度和相位。
- `ImpulseSpectrum`：按 `lines[].frequency` 与复系数绘制带权箭头/谱线，不能伪装成有限高度采样点。
- `DistributionTerm`：显示准确符号与奇点提示；只有 `evaluateAway` 可用于远离奇点的辅助曲线。
- `CompositeSpectrum`：把上述图层叠加，并在图例中明确区分。

绘图层不得重新写傅里叶公式、参数约束或信号定义。`sampling.js` 已统一实现 `atan2` 相位、零幅值未定义、相位跳变断点、分布奇点避让及自动显示范围。
