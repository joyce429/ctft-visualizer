# 教材知识与基本信号库说明

## 来源核查结论

主来源为 Oppenheim、Willsky、Nawab《Signals and Systems》第二版第 4 章。已直接核查第 4.6 节 Table 4.1 与 Table 4.2：Table 4.1 汇总线性、时移、频移、共轭、翻转、尺度、卷积、相乘、时域微分、从负无穷积分、频域微分、对称性与 Parseval；Table 4.2 列出周期线谱、复指数、正弦、余弦、常数、周期矩形波、周期冲激串、矩形脉冲、带限 sinc 对、冲激、阶跃、平移冲激、单边指数与 `te^{-at}u(t)` 等。

三角脉冲和双边指数不是本项目声称的 Table 4.2 原条目：前者由矩形脉冲卷积及卷积性质推得，并以 Oregon State 课程讲义交叉核查；后者由左右单边指数相加/直接积分推得，并以 UT Austin 与 UPenn 托管的课程表交叉核查。

参考文献的完整元数据、链接、访问日期与核验说明位于 `data/references.json`。未填写无法核实的页码。

## 当前 15 个信号

| ID | 时域 | 频域 | 条件与类型 |
|---|---|---|---|
| `unit-impulse` | `δ(t)` | `1` | 时域为分布；频域为连续常数 |
| `shifted-impulse` | `Aδ(t-t0)` | `Ae^{-jωt0}` | `A,t0` 实数；连续复频谱 |
| `constant` | `A` | `2πAδ(ω)` | 广义变换；冲激谱 |
| `unit-step` | `u(t)` | `PV[1/(jω)]+πδ(ω)` | 复合谱，主值与冲激分开 |
| `rectangular-pulse` | `A rect(t/T)` | `AT sinc(ωT/2)` | `T>0`；`rect=1` 于 `|t|<T/2` |
| `triangular-pulse` | `A tri(t/T)` | `AT sinc²(ωT/2)` | `T>0`；支撑 `[-T,T]` |
| `sinc-signal` | `A sinc(Wt)` | `(Aπ/W)rect(ω/(2W))` | `W>0`；带边采用对称半值 |
| `one-sided-exponential` | `Ae^{-at}u(t)` | `A/(a+jω)` | 数值实现 `a>0`；教材一般条件 `Re{a}>0` |
| `two-sided-exponential` | `Ae^{-a|t|}` | `2Aa/(a²+ω²)` | `a>0`；实偶谱 |
| `t-times-exponential` | `Ate^{-at}u(t)` | `A/(a+jω)²` | `a>0` |
| `complex-exponential` | `Ae^{jω0t}` | `2πAδ(ω-ω0)` | 单边频率冲激线 |
| `cosine` | `A cos(ω0t)` | `Aπ[δ(ω-ω0)+δ(ω+ω0)]` | `ω0>0`；等权实线谱 |
| `sine` | `A sin(ω0t)` | `(Aπ/j)[δ(ω-ω0)-δ(ω+ω0)]` | `ω0>0`；正频权重 `-jAπ` |
| `periodic-rectangular-wave` | 周期 `T0`、半脉宽 `T1` | 谐波冲激和 | `0<T1<T0/2`；扩展位已实现 |
| `periodic-impulse-train` | `ΣAδ(t-nT0)` | `(2πA/T0)Σδ(ω-2πk/T0)` | `T0>0`；扩展位已实现 |

## 易错点记录

- `sin(ω0t)` 在 `+ω0` 的冲激权重是 `-jπ`（乘幅度后为 `-jAπ`），在 `-ω0` 为 `+jAπ`。
- 常数 `1` 的变换是 `2πδ(ω)`，不是 `δ(ω)`。
- 单位阶跃的 `1/(jω)` 不是零点之外普通函数的完整定义，必须保留 `PV`，且还要加 `πδ(ω)`。
- `te^{-at}u(t)` 由 `t x(t) ↔ j dX/dω` 得到正号 `1/(a+jω)²`。
- 本项目 sinc 不含 `π` 归一化；从其他资料换算时必须检查其定义。
- 周期矩形波 `k=0` 系数使用极限，代码中不能直接除以零。
- 冲激谱绘图箭头表示权重/面积，不表示有限函数高度。
