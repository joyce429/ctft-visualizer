# Fourier Transform Lab

面向《信号与系统》课程的连续时间傅里叶变换交互式学习平台。项目采用解析公式而不是 FFT 近似，能够离线展示时域信号、幅度谱、相位谱、广义函数分量及五类核心变换的对应关系。

## 数学约定

\[
X(j\omega)=\int_{-\infty}^{\infty}x(t)e^{-j\omega t}\,dt,
\qquad
x(t)=\frac{1}{2\pi}\int_{-\infty}^{\infty}X(j\omega)e^{j\omega t}\,d\omega.
\]

频率统一使用角频率 `ω`（rad/s），并定义 `sinc(z)=sin(z)/z`、`sinc(0)=1`。Dirac 冲激保存位置与复权重，主值分布保留符号意义，不被伪装成普通采样数组。

## 支持的信号

- 广义与基础信号：单位冲激、平移冲激、常数、单位阶跃。
- 非周期脉冲：矩形脉冲、三角脉冲、sinc 信号。
- 衰减信号：单边指数、双边指数、`te^{-at}u(t)`。
- 周期信号：复指数、余弦、正弦、周期矩形波、周期冲激串。

每个信号的名称、公式、参数、范围、条件及参考文献来自 `data/signals.json`，网页没有维护另一套重复公式。

## 主要功能

- 参数滑块与数值框实时更新时域、幅度谱、相位谱和解析式。
- 时间翻转、时间平移、时间尺度、解析微分及从负无穷累积积分。
- 原始/变换后/叠加显示，蓝色代表原始信号，橙色代表变换后信号。
- 主值/展开相位和弧度/角度切换；零幅值处相位标记为未定义。
- 连续频谱、冲激线谱、PV 分布、时域冲激及冲激导数分层显示。
- 傅里叶变换性质速查；全部公式由本地 KaTeX 排版，不显示原始 LaTeX 命令。
- 自定义频率显示范围、缩放、恢复视图和悬停读数。
- 三张图导出 PNG；时域连续数据、频域连续数据和冲激谱分别导出 CSV。
- 当前页面配置导出为 JSON，并可导入恢复。

## 直接离线使用

最终入口：[release/offline/index.html](release/offline/index.html)。双击即可通过 `file://` 打开，不需要安装 Node.js、启动服务器或连接网络。

开发构建入口为 `dist/index.html`。两者包含同一套应用代码，全部 ECharts、KaTeX、字体和信号数据均已本地打包。

## 开发、测试与打包

```powershell
npm ci
npm run check
npm run test:browser
npm run release
```

- `npm run check`：重新生成嵌入数据、构建网页、执行 HTTP 200 冒烟和55项数学/数据测试。
- `npm run test:browser`：通过真实 Chrome/Edge 无头浏览器以 `file://` 打开页面，执行控件与导出测试，同时阻止 HTTP/HTTPS 请求。
- `npm run release`：完整检查后生成 `release/offline/` 与 `release/static-site/`，并校验两套应用文件逐字节一致。
- `npm audit --audit-level=low`：依赖安全审计。

## CSV 与配置格式

- 时域 CSV：`series,t,real,imag`。
- 连续频谱 CSV：`series,omega,real,imag,magnitude,phase,phase_unit`。
- 冲激谱 CSV：`series,omega,coefficient_real,coefficient_imag,coefficient_magnitude,coefficient_phase,phase_unit,label`。
- JSON 配置：保存信号 ID、参数、单项变换、显示模式、相位设置和频率范围；导入时执行版本、约定、参数及操作校验。

## 静态网站部署

`release/static-site/` 可直接作为任意静态托管服务的发布根目录。仓库同时提供 `.github/workflows/pages.yml`，用于构建、测试并发布 `dist/` 到 GitHub Pages。具体步骤见 [docs/deployment.md](docs/deployment.md)。

当前环境没有用户指定的 GitHub 仓库和发布权限，因此没有声称已经生成线上网址。

## 已知限制

- 页面一次只激活一种变换；底层存在操作队列接口，但未提供复杂组合的可视化编辑器。
- 参数控件目前以实数为主，未提供通用复参数输入。
- 周期无限线谱只显示用户指定的有限谐波窗口，同时保留无限族元数据。
- 常数、周期正弦/余弦/复指数等从负无穷起的普通积分不收敛，当前明确禁用。
- 阶跃再次积分和其他高阶分布运算未强行实现；sinc 累积积分尚未加入 Si 条件收敛模式。
- 当前没有 Service Worker；这是为了保持 `file://` 直接打开兼容性。在线首次访问仍需网络。

详细架构、知识来源、需求、进度及最终测试结果位于 `docs/`。
