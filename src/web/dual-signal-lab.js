import * as echarts from "echarts";
import katex from "katex";
import { listSignalDefinitions, getSignalDefinition } from "../signals/registry.js";
import { linspace, phaseOf, sampleSpectrum } from "../plotting/sampling.js";
import { rowsToCsv } from "../io/export-data.js";
import {
  buildExpression,
  convolution,
  expressionToJSON,
  makeLinearCombination,
  sum,
  termNode
} from "../operations/signal-expression.js";

const COLORS = { a: "#2468d8", b: "#16a1c7", y: "#e6902e", product: "#7b4cc2" };
const definitions = listSignalDefinitions();
const definitionMap = new Map(definitions.map((item) => [item.id, item]));
const chartElements = ["dual-time-chart", "dual-process-chart", "dual-magnitude-chart", "dual-phase-chart"];

const defaultTerm = (signalId) => {
  const definition = getSignalDefinition(signalId);
  return { signalId, coefficient: 1, shift: 0, scale: 1, parameters: { ...definition.defaultValues } };
};

const initialState = () => ({
  schemaVersion: 1,
  operation: "linear",
  coefficientA: 1,
  coefficientB: 1,
  t0: 0,
  speed: 1,
  inputs: {
    a: [defaultTerm("rectangular-pulse")],
    b: [defaultTerm("rectangular-pulse")]
  }
});

let state = initialState();
let charts = null;
let lastSnapshot = null;
let animationFrame = null;
let previousAnimationTime = null;

const byId = (id) => document.getElementById(id);

function renderMath(element, latex) {
  katex.render(latex, element, { throwOnError: false, strict: "ignore", displayMode: false, output: "htmlAndMathml" });
}

const format = (value, digits = 4) => Number.isFinite(value)
  ? Number(value.toFixed(digits)).toString()
  : "—";

function setStatus(message, error = false) {
  const element = byId("dual-status");
  element.textContent = message;
  element.style.color = error ? "#a73636" : "#34745c";
}

function setWarning(message = "") {
  const warning = byId("dual-warning");
  warning.hidden = !message;
  warning.textContent = message;
}

function nodeForInput(key) {
  const terms = state.inputs[key].map(termNode);
  return terms.length === 1 ? terms[0] : sum(terms);
}

function optionGroups(selected) {
  const categories = new Map();
  for (const definition of definitions) {
    const group = categories.get(definition.category) ?? [];
    group.push(definition);
    categories.set(definition.category, group);
  }
  return [...categories.entries()].map(([category, items]) => {
    const label = items[0]?.categoryNameZh ?? category;
    return `<optgroup label="${label}">${items.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${item.nameZh}</option>`).join("")}</optgroup>`;
  }).join("");
}

function termEditor(key, term, index) {
  const definition = definitionMap.get(term.signalId);
  const container = document.createElement("div");
  container.className = "signal-term";
  container.dataset.input = key;
  container.dataset.index = index;
  container.innerHTML = `
    <div class="term-top">
      <label>基本信号<select data-field="signalId">${optionGroups(term.signalId)}</select></label>
      <label>系数 c<input data-field="coefficient" type="number" step="0.1" value="${term.coefficient}"></label>
      <label>平移 t₀<input data-field="shift" type="number" step="0.1" value="${term.shift}"></label>
      <label>尺度 s<input data-field="scale" type="number" step="0.1" value="${term.scale}"></label>
      <button type="button" class="remove-term" aria-label="删除此信号项">×</button>
    </div>
    <div class="term-parameters"></div>`;
  const parameters = container.querySelector(".term-parameters");
  for (const parameter of definition.parameters) {
    const label = document.createElement("label");
    label.textContent = `${parameter.nameZh ?? parameter.id} ${parameter.unit ? `· ${parameter.unit}` : ""}`;
    const input = document.createElement("input");
    input.type = "number";
    input.dataset.parameter = parameter.id;
    input.value = term.parameters[parameter.id];
    input.step = parameter.step ?? "any";
    if (parameter.min !== undefined) input.min = parameter.exclusiveMin ? parameter.min + (parameter.step ?? 0.001) : parameter.min;
    if (parameter.max !== undefined) input.max = parameter.max;
    label.append(input);
    parameters.append(label);
  }
  if (!definition.parameters.length) parameters.innerHTML = `<span class="empty-parameters">该信号没有可调基础参数</span>`;
  container.addEventListener("change", (event) => updateTermFromEvent(key, index, event));
  container.querySelector(".remove-term").addEventListener("click", () => {
    if (state.inputs[key].length === 1) return setStatus("每个输入至少保留一个信号项。", true);
    state.inputs[key].splice(index, 1);
    renderEditors();
    renderAll();
  });
  return container;
}

function updateTermFromEvent(key, index, event) {
  const term = state.inputs[key][index];
  if (event.target.dataset.field === "signalId") {
    state.inputs[key][index] = defaultTerm(event.target.value);
    renderEditors();
    renderAll();
    return;
  }
  if (event.target.dataset.field) term[event.target.dataset.field] = Number(event.target.value);
  if (event.target.dataset.parameter) term.parameters[event.target.dataset.parameter] = Number(event.target.value);
  renderAll();
}

function renderEditors() {
  for (const key of ["a", "b"]) {
    const list = byId(`dual-terms-${key}`);
    list.replaceChildren(...state.inputs[key].map((term, index) => termEditor(key, term, index)));
  }
}

function paddedRange(models) {
  const min = Math.min(...models.map((item) => item.window.min));
  const max = Math.max(...models.map((item) => item.window.max));
  const span = Math.max(max - min, 2);
  return { min: min - span * 0.08, max: max + span * 0.08 };
}

function lineSeries(name, points, color, width = 2) {
  return { name, type: "line", showSymbol: false, connectNulls: false, data: points, lineStyle: { color, width }, itemStyle: { color }, animation: false };
}

function impulseSeries(name, lines, color) {
  return {
    name, type: "custom", data: lines, animation: false,
    renderItem(params, api) {
      const frequency = api.value(0);
      const height = api.value(1);
      const start = api.coord([frequency, 0]);
      const end = api.coord([frequency, height]);
      return { type: "group", children: [
        { type: "line", shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] }, style: { stroke: color, lineWidth: 2 } },
        { type: "polygon", shape: { points: [[end[0], end[1]], [end[0] - 5, end[1] + 9], [end[0] + 5, end[1] + 9]] }, style: { fill: color } }
      ] };
    },
    encode: { x: 0, y: 1 },
    tooltip: { formatter: (params) => `${name}<br>ω=${format(params.value[0])}<br>冲激系数幅值=${format(params.value[1])}` }
  };
}

function timeOption(models, result, range) {
  const x = linspace(range.min, range.max, 401);
  const series = [];
  for (const [name, model, color] of [["x₁(t)", models.a, COLORS.a], ["x₂(t)", models.b, COLORS.b], ["y(t)", result, COLORS.y]]) {
    if (model.pointwise) series.push(lineSeries(name, x.map((t) => [t, model.evaluate(t).re]), color, name === "y(t)" ? 3 : 1.8));
  }
  if (state.operation === "convolution" && result.pointwise) {
    const y0 = result.evaluate(state.t0).re;
    const resultSeries = series.find((item) => item.name === "y(t)");
    if (resultSeries) resultSeries.markPoint = { symbolSize: 44, data: [{ coord: [state.t0, y0], value: format(y0) }], itemStyle: { color: COLORS.y } };
  }
  return baseOption("t", series, range);
}

function baseOption(axisName, series, range = null) {
  return {
    animation: false,
    color: [COLORS.a, COLORS.b, COLORS.y],
    legend: { top: 7, type: "scroll" },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    grid: { left: 58, right: 24, top: 45, bottom: 48 },
    xAxis: { type: "value", name: axisName, min: range?.min, max: range?.max, nameLocation: "middle", nameGap: 30, axisLine: { onZero: true } },
    yAxis: { type: "value", scale: true, axisLine: { show: true } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6 }],
    series
  };
}

function spectrumSeries(name, spectrum, color, phase = false) {
  const sample = sampleSpectrum(spectrum, { min: -12, max: 12 }, "rad", 801, "principal");
  const series = [];
  if (sample.continuous) {
    const points = phase ? sample.continuous.phase.map((p) => [p[0], p[1]]) : sample.continuous.magnitude.map((p) => [p[0], p[1]]);
    series.push(lineSeries(name, points, color, name.startsWith("Y") ? 2.8 : 1.6));
  }
  if (sample.impulses.length) {
    if (phase) series.push({ name: `${name} 冲激系数相位`, type: "scatter", symbol: "pin", symbolSize: 34, data: sample.impulses.map((p) => [p[0], p[4]]), itemStyle: { color } });
    else series.push(impulseSeries(`${name} 冲激谱线`, sample.impulses, color));
  }
  return { series, sample };
}

function spectrumOption(models, result, phase = false) {
  const outputs = [
    spectrumSeries(phase ? "arg X₁" : "|X₁|", models.a.spectrum, COLORS.a, phase),
    spectrumSeries(phase ? "arg X₂" : "|X₂|", models.b.spectrum, COLORS.b, phase),
    spectrumSeries(phase ? "arg Y" : "|Y|", result.spectrum, COLORS.y, phase)
  ];
  const option = baseOption("ω · rad/s", outputs.flatMap((item) => item.series), { min: -12, max: 12 });
  if (phase) {
    option.yAxis.min = -Math.PI;
    option.yAxis.max = Math.PI;
    option.yAxis.axisLabel = { formatter: (value) => Math.abs(value) < 1e-8 ? "0" : `${format(value / Math.PI, 2)}π` };
  }
  return { option, samples: outputs.map((item) => item.sample) };
}

function processOption(first, second, result) {
  if (!first.pointwise || !second.pointwise) {
    return { option: baseOption("τ", []), value: result.evaluate(state.t0), note: "冲激卷积采用筛选性质解析计算，不把冲激近似成尖峰参与数值积分。" };
  }
  const min = Math.min(first.window.min, state.t0 - second.window.max);
  const max = Math.max(first.window.max, state.t0 - second.window.min);
  const pad = Math.max((max - min) * 0.08, 0.5);
  const range = { min: min - pad, max: max + pad };
  const tau = linspace(range.min, range.max, 501);
  const firstPoints = [];
  const shiftedPoints = [];
  const product = [];
  const positive = [];
  const negative = [];
  for (const value of tau) {
    const x1 = first.evaluate(value);
    const x2 = second.evaluate(state.t0 - value);
    const p = x1.mul(x2);
    firstPoints.push([value, x1.re]);
    shiftedPoints.push([value, x2.re]);
    product.push([value, p.re]);
    positive.push([value, Math.max(p.re, 0)]);
    negative.push([value, Math.min(p.re, 0)]);
  }
  const value = result.evaluate(state.t0);
  const series = [
    lineSeries("x₁(τ)", firstPoints, COLORS.a, 1.6),
    lineSeries("x₂(t₀−τ)", shiftedPoints, COLORS.b, 1.6),
    { ...lineSeries("乘积", positive, "#63a774", 0), areaStyle: { color: "rgba(74,174,106,.28)" }, stack: "area", silent: true },
    { ...lineSeries("负面积", negative, "#d55c5c", 0), areaStyle: { color: "rgba(213,92,92,.25)" }, stack: "area", silent: true },
    lineSeries("x₁(τ)x₂(t₀−τ)", product, COLORS.product, 2.5)
  ];
  return { option: baseOption("τ", series, range), value, note: "绿色/红色填充分别表示乘积的正/负有符号面积。" };
}

function renderProcess(snapshot = lastSnapshot) {
  if (!snapshot || state.operation !== "convolution") return;
  const process = processOption(snapshot.models.a, snapshot.models.b, snapshot.result);
  charts.process.setOption(process.option, true);
  byId("dual-integral-value").textContent = `t₀=${format(state.t0, 3)} · y(t₀)=${format(process.value.re)}${Math.abs(process.value.im) > 1e-10 ? ` + j${format(process.value.im)}` : ""}`;
  byId("dual-t0-value").value = format(state.t0, 3);
  const timeOptionValue = timeOption(snapshot.models, snapshot.result, snapshot.timeRange);
  charts.time.setOption(timeOptionValue, true);
  if (process.note) setStatus(process.note);
}

function renderFormulas(models, result) {
  renderMath(byId("dual-formula-a"), String.raw`x_1(t)=${models.a.latex}`);
  renderMath(byId("dual-formula-b"), String.raw`x_2(t)=${models.b.latex}`);
  renderMath(byId("dual-frequency-a"), String.raw`X_1(j\omega)=${models.a.frequencyLatex}`);
  renderMath(byId("dual-frequency-b"), String.raw`X_2(j\omega)=${models.b.frequencyLatex}`);
  if (state.operation === "linear") {
    renderMath(byId("dual-result-time"), String.raw`y(t)=${state.coefficientA}x_1(t)+${state.coefficientB}x_2(t)`);
    renderMath(byId("dual-result-frequency"), String.raw`Y(j\omega)=${state.coefficientA}X_1(j\omega)+${state.coefficientB}X_2(j\omega)`);
    renderMath(byId("dual-property-formula"), String.raw`a x_1(t)+b x_2(t)\longleftrightarrow aX_1(j\omega)+bX_2(j\omega)`);
    byId("dual-property-explanation").textContent = "频域中相加的是复频谱。幅度和相位必须在复数相加完成后重新计算；抵消为零时相位未定义。";
    byId("dual-method-badge").textContent = "线性性质 · 复频谱相加";
  } else {
    renderMath(byId("dual-result-time"), String.raw`y(t)=\int_{-\infty}^{\infty}x_1(\tau)x_2(t-\tau)d\tau`);
    renderMath(byId("dual-result-frequency"), String.raw`Y(j\omega)=X_1(j\omega)X_2(j\omega)`);
    renderMath(byId("dual-property-formula"), String.raw`x_1(t)*x_2(t)\longleftrightarrow X_1(j\omega)X_2(j\omega)`);
    const numeric = result.method === "numeric-trapezoid";
    byId("dual-property-explanation").textContent = numeric
      ? "频域结果按复数乘法解析计算；时域结果采用有限有效窗内的中点数值积分（默认 800 个区间），页面明确标记为数值近似。"
      : "冲激输入使用筛选性质解析计算；不会把 Dirac 冲激画成有限尖峰后参与积分。";
    byId("dual-method-badge").textContent = numeric ? "时域数值近似 · 频域解析乘积" : "冲激筛选性质 · 解析结果";
  }
}

function renderAll() {
  try {
    setWarning("");
    const inputNodes = { a: nodeForInput("a"), b: nodeForInput("b") };
    const models = { a: buildExpression(inputNodes.a), b: buildExpression(inputNodes.b) };
    const resultNode = state.operation === "linear"
      ? makeLinearCombination(inputNodes.a, inputNodes.b, state.coefficientA, state.coefficientB)
      : convolution(inputNodes.a, inputNodes.b, { samples: 800 });
    const result = buildExpression(resultNode);
    const timeRange = paddedRange([models.a, models.b, result]);
    if (state.operation === "convolution") {
      const min = result.window.min;
      const max = result.window.max;
      const slider = byId("dual-t0");
      slider.min = min;
      slider.max = max;
      slider.step = Math.max((max - min) / 240, 0.01);
      state.t0 = Math.min(max, Math.max(min, state.t0));
      slider.value = state.t0;
    }
    const magnitude = spectrumOption(models, result, false);
    const phase = spectrumOption(models, result, true);
    charts.time.setOption(timeOption(models, result, timeRange), true);
    charts.magnitude.setOption(magnitude.option, true);
    charts.phase.setOption(phase.option, true);
    renderFormulas(models, result);
    lastSnapshot = { inputNodes, resultNode, models, result, timeRange, magnitude: magnitude.samples, phase: phase.samples };
    if (state.operation === "convolution") renderProcess(lastSnapshot);
    else setStatus("线性叠加已按复频谱运算实时更新。相同频率的冲激系数会先合并。 ");
  } catch (error) {
    setWarning(`当前组合暂不支持：${error.message}`);
    setStatus("请调整信号类型或参数后重试。", true);
  }
}

function updateOperation(operation) {
  state.operation = operation;
  document.querySelectorAll("[data-dual-operation]").forEach((button) => button.classList.toggle("active", button.dataset.dualOperation === operation));
  byId("linear-coefficients").hidden = operation !== "linear";
  byId("convolution-controls").hidden = operation !== "convolution";
  byId("convolution-process-card").hidden = operation !== "convolution";
  if (operation !== "convolution") stopAnimation();
  renderAll();
  requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize()));
}

function stopAnimation() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  previousAnimationTime = null;
  byId("dual-play").textContent = "播放";
}

function animate(time) {
  if (!lastSnapshot || state.operation !== "convolution") return stopAnimation();
  if (previousAnimationTime !== null) {
    const slider = byId("dual-t0");
    const span = Number(slider.max) - Number(slider.min);
    state.t0 += (time - previousAnimationTime) / 1000 * span / 8 * state.speed;
    if (state.t0 > Number(slider.max)) state.t0 = Number(slider.min);
    slider.value = state.t0;
    renderProcess();
  }
  previousAnimationTime = time;
  animationFrame = requestAnimationFrame(animate);
}

function toggleAnimation() {
  if (animationFrame) return stopAnimation();
  byId("dual-play").textContent = "暂停";
  animationFrame = requestAnimationFrame(animate);
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportConfiguration() {
  const config = { ...state, inputs: { a: state.inputs.a.map((item) => ({ ...item, parameters: { ...item.parameters } })), b: state.inputs.b.map((item) => ({ ...item, parameters: { ...item.parameters } })) }, expression: lastSnapshot ? { a: expressionToJSON(lastSnapshot.inputNodes.a), b: expressionToJSON(lastSnapshot.inputNodes.b), result: expressionToJSON(lastSnapshot.resultNode) } : null, convention: "X(jω)=∫x(t)e^(-jωt)dt" };
  downloadBlob("ctft-dual-signal.json", JSON.stringify(config, null, 2), "application/json;charset=utf-8");
  setStatus("已导出双信号表达式树与页面配置。 ");
}

function importConfiguration(config) {
  if (!config || config.schemaVersion !== 1 || !config.inputs?.a?.length || !config.inputs?.b?.length) throw new TypeError("不是有效的双信号配置文件");
  state = { ...initialState(), ...config, inputs: config.inputs };
  stopAnimation();
  renderEditors();
  byId("dual-coefficient-a").value = state.coefficientA;
  byId("dual-coefficient-b").value = state.coefficientB;
  byId("dual-speed").value = state.speed;
  updateOperation(state.operation);
  setStatus("配置导入成功。 ");
}

function exportResultCsv() {
  if (!lastSnapshot) return;
  const range = lastSnapshot.timeRange;
  const rows = linspace(range.min, range.max, 801).map((t) => {
    const value = lastSnapshot.result.evaluate(t);
    return [t, value.re, value.im];
  });
  downloadBlob("ctft-dual-result.csv", rowsToCsv(["t", "real", "imag"], rows), "text/csv;charset=utf-8");
  setStatus("已导出结果信号采样数据。 ");
}

function bindEvents() {
  document.querySelectorAll("[data-lab-view]").forEach((button) => button.addEventListener("click", () => {
    const dual = button.dataset.labView === "dual";
    byId("single-signal-lab").hidden = dual;
    byId("dual-signal-lab").hidden = !dual;
    document.querySelectorAll("[data-lab-view]").forEach((item) => item.classList.toggle("active", item === button));
    if (dual) requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize()));
  }));
  document.querySelectorAll("[data-dual-operation]").forEach((button) => button.addEventListener("click", () => updateOperation(button.dataset.dualOperation)));
  byId("dual-add-a").addEventListener("click", () => { state.inputs.a.push(defaultTerm("one-sided-exponential")); renderEditors(); renderAll(); });
  byId("dual-add-b").addEventListener("click", () => { state.inputs.b.push(defaultTerm("one-sided-exponential")); renderEditors(); renderAll(); });
  byId("dual-coefficient-a").addEventListener("input", (event) => { state.coefficientA = Number(event.target.value); renderAll(); });
  byId("dual-coefficient-b").addEventListener("input", (event) => { state.coefficientB = Number(event.target.value); renderAll(); });
  byId("dual-t0").addEventListener("input", (event) => { state.t0 = Number(event.target.value); renderProcess(); });
  byId("dual-speed").addEventListener("change", (event) => { state.speed = Number(event.target.value); });
  byId("dual-play").addEventListener("click", toggleAnimation);
  byId("dual-step").addEventListener("click", () => { const slider = byId("dual-t0"); state.t0 = Math.min(Number(slider.max), state.t0 + Number(slider.step)); slider.value = state.t0; renderProcess(); });
  byId("dual-reset-animation").addEventListener("click", () => { stopAnimation(); state.t0 = Number(byId("dual-t0").min); byId("dual-t0").value = state.t0; renderProcess(); });
  byId("dual-swap").addEventListener("click", () => { [state.inputs.a, state.inputs.b] = [state.inputs.b, state.inputs.a]; renderEditors(); renderAll(); });
  byId("dual-reset").addEventListener("click", () => { stopAnimation(); state = initialState(); renderEditors(); byId("dual-coefficient-a").value = 1; byId("dual-coefficient-b").value = 1; updateOperation("linear"); });
  byId("dual-export-config").addEventListener("click", exportConfiguration);
  byId("dual-import-config").addEventListener("click", () => byId("dual-import-file").click());
  byId("dual-import-file").addEventListener("change", async (event) => {
    try { importConfiguration(JSON.parse(await event.target.files[0].text())); }
    catch (error) { setStatus(`导入失败：${error.message}`, true); }
    event.target.value = "";
  });
  byId("dual-export-csv").addEventListener("click", exportResultCsv);
  document.querySelectorAll("[data-dual-png]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.dualPng.replace("dual-", "");
    const url = charts[key].getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    const link = document.createElement("a"); link.href = url; link.download = `ctft-dual-${key}.png`; link.click();
  }));
  window.addEventListener("resize", () => requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize())));
}

export function initDualSignalLab() {
  charts = {
    time: echarts.init(byId("dual-time-chart")),
    process: echarts.init(byId("dual-process-chart")),
    magnitude: echarts.init(byId("dual-magnitude-chart")),
    phase: echarts.init(byId("dual-phase-chart"))
  };
  renderEditors();
  bindEvents();
  updateOperation("linear");
  if (["#dual-signal", "#dual-convolution"].includes(location.hash)) document.querySelector('[data-lab-view="dual"]').click();
  if (location.hash === "#dual-convolution") updateOperation("convolution");
}
