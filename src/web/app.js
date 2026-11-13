import * as echarts from "echarts";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  SIGNAL_DATABASE,
  TRANSFORM_PROPERTIES
} from "../data/generated/signals.generated.js";
import { createSignalModel, getSignalDefinition } from "../signals/registry.js";
import { comparisonRanges, sampleSpectrum, sampleTimeSignal } from "../plotting/sampling.js";
import { createTransformOperation, transformSignalModel } from "../transforms/signal-transform.js";
import { rowsToCsv } from "../io/export-data.js";

const colors = {
  blue: "#2468d8",
  blueDark: "#174d9e",
  cyan: "#16a1c7",
  orange: "#e6902e",
  grid: "#e8eef5",
  axis: "#9ba9ba",
  text: "#5e6d82"
};

const categoryLabels = {
  generalized: "基础信号",
  "aperiodic-pulses": "脉冲信号",
  decaying: "指数信号",
  periodic: "周期信号"
};

const spectrumLabels = {
  continuous: "连续频谱",
  impulse: "冲激线谱",
  composite: "复合分布谱"
};

const elements = Object.fromEntries([
  "signal-select", "sidebar-time-formula", "signal-description", "parameter-controls",
  "parameter-error", "current-signal-title", "spectrum-type-badge", "special-notice",
  "time-range-label", "phase-unit-label", "time-formula", "frequency-formula",
  "current-parameters", "constraint-list", "transform-select", "transform-parameter",
  "transformed-time-formula", "transformed-frequency-formula", "property-formula",
  "property-explanation", "property-title", "restore-original", "reset-transform", "component-summary",
  "frequency-range", "frequency-auto",
  "export-time-csv", "export-frequency-csv", "export-impulse-csv", "export-config", "import-config",
  "import-config-file", "export-status", "property-reference-grid"
].map((id) => [id, document.getElementById(id)]));

const charts = {
  time: echarts.init(document.getElementById("time-chart"), null, { renderer: "canvas" }),
  magnitude: echarts.init(document.getElementById("magnitude-chart"), null, { renderer: "canvas" }),
  phase: echarts.init(document.getElementById("phase-chart"), null, { renderer: "canvas" })
};

const initialDefinition = getSignalDefinition("rectangular-pulse");
const state = {
  signalId: initialDefinition.id,
  parameters: { ...initialDefinition.defaultValues },
  phaseUnit: "rad",
  phaseMode: "principal",
  displayMode: "original",
  transformType: "none",
  transformParameters: { shift: 1, scale: 2 },
  frequencyMax: null,
  model: null,
  transformedModel: null,
  lastRender: null
};

function renderMath(element, latex) {
  katex.render(latex, element, {
    throwOnError: false,
    displayMode: false,
    strict: "ignore",
    trust: false
  });
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-12) return "0";
  if (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3) return value.toExponential(3);
  return Number(value.toFixed(digits)).toString();
}

function formatComplex(re, im) {
  const real = Math.abs(re) < 1e-10 ? 0 : re;
  const imaginary = Math.abs(im) < 1e-10 ? 0 : im;
  if (imaginary === 0) return formatNumber(real);
  if (real === 0) return `${formatNumber(imaginary)}j`;
  return `${formatNumber(real)} ${imaginary >= 0 ? "+" : "−"} ${formatNumber(Math.abs(imaginary))}j`;
}

function commonGrid() {
  return { left: 68, right: 30, top: 28, bottom: 48, containLabel: false };
}

function toolbox() {
  return {
    right: 12,
    top: 1,
    itemSize: 13,
    feature: {
      dataZoom: { yAxisIndex: "none", title: { zoom: "框选缩放", back: "撤销缩放" } },
      restore: { title: "恢复默认视图" },
      saveAsImage: { title: "保存图片", pixelRatio: 2 }
    }
  };
}

function valueAxis(name, overrides = {}) {
  return {
    type: "value",
    name,
    nameLocation: "middle",
    nameGap: 45,
    nameTextStyle: { color: colors.text, fontSize: 11 },
    axisLine: { show: true, lineStyle: { color: colors.axis } },
    axisTick: { show: true },
    axisLabel: { color: colors.text, fontSize: 10, formatter: (value) => formatNumber(value, 3) },
    splitLine: { lineStyle: { color: colors.grid, type: "dashed" } },
    ...overrides
  };
}

function xAxis(name, range) {
  return valueAxis(name, {
    min: range.min,
    max: range.max,
    nameLocation: "end",
    nameGap: 10,
    axisLine: { onZero: true, lineStyle: { color: colors.axis } }
  });
}

function dataZoom() {
  return [
    { type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: true },
    { type: "slider", xAxisIndex: 0, height: 12, bottom: 6, borderColor: "#d8e1ec", fillerColor: "rgba(36,104,216,.12)", showDetail: false }
  ];
}

function lineSeries(name, data, color, style = "solid") {
  return {
    name,
    type: "line",
    data,
    showSymbol: false,
    connectNulls: false,
    animation: false,
    sampling: "lttb",
    lineStyle: { width: 2, color, type: style },
    itemStyle: { color },
    emphasis: { focus: "series" }
  };
}

function impulseArrowSeries(name, data, color, showLabels = false) {
  return {
    name,
    type: "custom",
    data,
    encode: { x: 0, y: 1 },
    animation: false,
    renderItem(params, api) {
      const x = api.value(0);
      const y = api.value(1);
      const base = api.coord([x, 0]);
      const tip = api.coord([x, y]);
      const direction = y >= 0 ? 1 : -1;
      const derivativeOrder = Number(api.value(6) ?? 0);
      const children = [
        { type: "line", shape: { x1: base[0], y1: base[1], x2: tip[0], y2: tip[1] }, style: { stroke: color, lineWidth: 2.2 } },
        { type: "polygon", shape: { points: [[tip[0], tip[1]], [tip[0] - 5, tip[1] + direction * 9], [tip[0] + 5, tip[1] + direction * 9]] }, style: { fill: color } }
      ];
      if (derivativeOrder > 0) {
        children.push({ type: "line", shape: { x1: tip[0] - 7, y1: tip[1] - direction * 5, x2: tip[0] + 7, y2: tip[1] + direction * 5 }, style: { stroke: color, lineWidth: 2 } });
      }
      if (showLabels && api.value(5)) {
        children.push({
          type: "text",
          style: { text: String(api.value(5)), x: tip[0], y: tip[1] - direction * 13, textAlign: "center", textVerticalAlign: "middle", font: "10px Segoe UI", fill: colors.text }
        });
      }
      return { type: "group", children };
    },
    itemStyle: { color },
    z: 5
  };
}

function impulsePhaseSeries(name, data, color) {
  return {
    name,
    type: "custom",
    data: data.filter((point) => point[1] !== null),
    encode: { x: 0, y: 1 },
    animation: false,
    renderItem(params, api) {
      const point = api.coord([api.value(0), api.value(1)]);
      const base = api.coord([api.value(0), 0]);
      return {
        type: "group",
        children: [
          { type: "line", shape: { x1: base[0], y1: base[1], x2: point[0], y2: point[1] }, style: { stroke: color, lineWidth: 1.4, lineDash: [4, 3] } },
          { type: "circle", shape: { cx: point[0], cy: point[1], r: 5 }, style: { fill: color, stroke: "#fff", lineWidth: 1.5 } }
        ]
      };
    },
    z: 5
  };
}

function axisTooltip(params, domain) {
  const items = Array.isArray(params) ? params : [params];
  if (!items.length) return "";
  const first = items.find((item) => Array.isArray(item.value));
  if (!first) return "";
  const x = first.value[0];
  const rows = [`<strong>${domain === "time" ? "t" : "ω"} = ${formatNumber(x)}</strong>`];
  for (const item of items) {
    const value = item.value;
    if (!Array.isArray(value) || value[1] === null) continue;
    if (domain === "time") {
      rows.push(`${item.marker}${item.seriesName}: ${formatNumber(value[1])}`);
    } else {
      rows.push(`${item.marker}${item.seriesName}`);
      rows.push(`Re = ${formatNumber(value[2])}　Im = ${formatNumber(value[3])}`);
      if (item.seriesName.includes("幅") || item.seriesName.includes("冲激")) rows.push(`|X| / 权重 = ${formatNumber(value[1])}`);
      if (value[4] !== null && value[4] !== undefined) rows.push(`arg = ${formatNumber(value[4])} ${state.phaseUnit === "rad" ? "rad" : "°"}`);
      if (value[5]) rows.push(`标记：${value[5]}`);
    }
  }
  return rows.join("<br>");
}

function timeImpulseData(model, range) {
  const sourceId = model.sourceId ?? model.id;
  const source = model.sourceModel ?? model;
  const p = source.parameters;
  const map = (position, coefficient) => model.mapTimeImpulse
    ? model.mapTimeImpulse(position, coefficient)
    : { position, coefficient };
  const toPoint = (position, coefficient, label) => {
    const transformed = map(position, coefficient);
    return [
      transformed.position,
      transformed.coefficient,
      transformed.coefficient,
      0,
      transformed.coefficient < 0 ? Math.PI : 0,
      label
    ];
  };
  if (sourceId === "unit-impulse") return [toPoint(0, 1, "δ(t)")];
  if (sourceId === "shifted-impulse") return [toPoint(p.t0, p.A, `base t₀=${formatNumber(p.t0)}`)];
  if (sourceId === "periodic-impulse-train") {
    const points = [];
    for (let n = -250; n <= 250; n += 1) {
      const point = toPoint(n * p.T0, p.A, `n=${n}`);
      if (point[0] >= range.min && point[0] <= range.max) points.push(point);
    }
    return points;
  }
  return [];
}

function buildTimeOption(entries, range) {
  const series = [];
  let yName = "x(t)";
  for (const entry of entries) {
    const sampled = sampleTimeSignal(entry.model, range.time);
    const impulses = sampled.impulses?.length ? sampled.impulses : (sampled.kind === "distribution" ? timeImpulseData(entry.model, range.time) : []);
    if (sampled.points?.length) {
      const real = sampled.points.map((point) => [point[0], point[1]]);
      const imaginary = sampled.points.map((point) => [point[0], point[2]]);
      series.push(lineSeries(`${entry.label} Re{${entry.timeSymbol}(t)}`, real, entry.color, entry.key === "transformed" ? "dashed" : "solid"));
      if (imaginary.some((point) => Math.abs(point[1]) > 1e-9)) series.push(lineSeries(`${entry.label} Im{${entry.timeSymbol}(t)}`, imaginary, entry.key === "transformed" ? "#d45f20" : colors.cyan, "dotted"));
    }
    if (impulses.length) {
      series.push(impulseArrowSeries(`${entry.label} Dirac 冲激（权重）`, impulses, entry.color, impulses.length <= 9));
      yName = "信号值 / 冲激权重";
    }
  }
  return {
    animation: false,
    grid: commonGrid(),
    toolbox: toolbox(),
    legend: { left: 64, top: 2, textStyle: { fontSize: 10, color: colors.text } },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: (params) => axisTooltip(params, "time") },
    xAxis: xAxis("t / s", range.time),
    yAxis: valueAxis(yName),
    dataZoom: dataZoom(),
    series
  };
}

function buildMagnitudeOption(entries, range) {
  const series = [];
  for (const entry of entries) {
    const sampled = entry.sampled;
    if (sampled.continuous) series.push(lineSeries(`${entry.label} |${entry.frequencySymbol}(jω)|`, sampled.continuous.magnitude, entry.color, entry.key === "transformed" ? "dashed" : "solid"));
    for (const distribution of sampled.distributions) {
      series.push(lineSeries(`${entry.label} PV 点外代表值（非分布幅度）`, distribution.magnitude, entry.color, entry.key === "transformed" ? "dashed" : "dotted"));
    }
    if (sampled.impulses.length) {
      series.push(impulseArrowSeries(`${entry.label} Dirac 系数幅值`, sampled.impulses, entry.color, sampled.impulses.length <= 9));
    }
  }
  return {
    animation: false,
    grid: commonGrid(),
    toolbox: toolbox(),
    legend: { left: 64, top: 2, textStyle: { fontSize: 10, color: colors.text } },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: (params) => axisTooltip(params, "frequency") },
    xAxis: xAxis("ω / (rad·s⁻¹)", range.frequency),
    yAxis: valueAxis("|X(jω)| / 冲激权重"),
    dataZoom: dataZoom(),
    series
  };
}

function phaseAxis() {
  if (state.phaseMode === "unwrapped") {
    return valueAxis(`展开相位 / ${state.phaseUnit === "deg" ? "°" : "rad"}`);
  }
  if (state.phaseUnit === "deg") {
    return valueAxis("arg[X(jω)] / °", { min: -180, max: 180, interval: 90 });
  }
  return valueAxis("arg[X(jω)] / rad", {
    min: -Math.PI,
    max: Math.PI,
    interval: Math.PI / 2,
    axisLabel: {
      color: colors.text,
      fontSize: 10,
      formatter(value) {
        if (Math.abs(value) < 1e-8) return "0";
        if (Math.abs(value - Math.PI) < 1e-8) return "π";
        if (Math.abs(value + Math.PI) < 1e-8) return "−π";
        if (Math.abs(value - Math.PI / 2) < 1e-8) return "π/2";
        if (Math.abs(value + Math.PI / 2) < 1e-8) return "−π/2";
        return formatNumber(value, 2);
      }
    }
  });
}

function buildPhaseOption(entries, range) {
  const series = [];
  for (const entry of entries) {
    const sampled = entry.sampled;
    if (sampled.continuous) series.push(lineSeries(`${entry.label} arg[${entry.frequencySymbol}(jω)]`, sampled.continuous.phase, entry.color, entry.key === "transformed" ? "dashed" : "solid"));
    for (const distribution of sampled.distributions) {
      series.push(lineSeries(`${entry.label} PV 点外代表相位`, distribution.phase, entry.color, entry.key === "transformed" ? "dashed" : "dotted"));
    }
    if (sampled.impulses.length) {
      const data = sampled.impulses.map((point) => [point[0], point[4], point[2], point[3], point[4], point[5]]);
      series.push(impulsePhaseSeries(`${entry.label}冲激系数相位`, data, entry.color));
    }
  }
  return {
    animation: false,
    grid: commonGrid(),
    toolbox: toolbox(),
    legend: { left: 64, top: 2, textStyle: { fontSize: 10, color: colors.text } },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: (params) => axisTooltip(params, "frequency") },
    xAxis: xAxis("ω / (rad·s⁻¹)", range.frequency),
    yAxis: phaseAxis(),
    dataZoom: dataZoom(),
    series
  };
}

function humanizeMathText(value) {
  return value
    .replaceAll("\\operatorname{Re}", "Re")
    .replaceAll("\\operatorname{Im}", "Im")
    .replaceAll("\\omega", "ω")
    .replaceAll("\\theta", "θ")
    .replaceAll("\\pi", "π")
    .replaceAll("\\infty", "∞")
    .replaceAll("\\ne", "≠")
    .replaceAll("\\le", "≤")
    .replaceAll("\\ge", "≥")
    .replaceAll("\\{", "{")
    .replaceAll("\\}", "}");
}

function renderPropertyReference() {
  const grid = elements["property-reference-grid"];
  grid.replaceChildren();
  for (const property of TRANSFORM_PROPERTIES.properties) {
    const item = document.createElement("div");
    item.className = "property-reference-item";
    const title = document.createElement("h4");
    title.textContent = property.nameZh;
    const formula = document.createElement("div");
    formula.className = "math-display";
    renderMath(formula, String.raw`${property.timeLatex}\;\longleftrightarrow\;${property.frequencyLatex}`);
    const conditions = document.createElement("p");
    conditions.textContent = property.conditions.length ? `条件：${property.conditions.map(humanizeMathText).join("；")}` : "按统一 CTFT 约定成立";
    item.append(title, formula, conditions);
    grid.append(item);
  }
}

function renderSignalOptions() {
  elements["signal-select"].replaceChildren();
  for (const category of SIGNAL_DATABASE.categories) {
    const group = document.createElement("optgroup");
    group.label = categoryLabels[category.id] ?? category.nameZh;
    for (const signal of category.signals) {
      const option = document.createElement("option");
      option.value = signal.id;
      option.textContent = `${signal.nameZh} · ${signal.nameEn}`;
      group.append(option);
    }
    elements["signal-select"].append(group);
  }
  elements["signal-select"].value = state.signalId;
}

function effectiveMin(parameter) {
  if (parameter.min === undefined) return undefined;
  return parameter.exclusiveMin ? parameter.min + (parameter.step ?? 0.001) : parameter.min;
}

function renderParameterControls() {
  const definition = getSignalDefinition(state.signalId);
  const container = elements["parameter-controls"];
  container.replaceChildren();
  if (!definition.parameters.length) {
    const empty = document.createElement("p");
    empty.className = "empty-parameters";
    empty.textContent = "该信号当前没有可调参数";
    container.append(empty);
    return;
  }
  for (const parameter of definition.parameters) {
    const wrapper = document.createElement("div");
    wrapper.className = "parameter-control";
    const label = document.createElement("div");
    label.className = "parameter-label";
    const title = document.createElement("strong");
    title.textContent = `${parameter.nameZh}  ${parameter.symbol.replaceAll("\\omega", "ω").replaceAll("_0", "₀")}`;
    const unit = document.createElement("span");
    unit.textContent = parameter.unit === "1" ? "无量纲" : parameter.unit;
    label.append(title, unit);
    const inputs = document.createElement("div");
    inputs.className = "parameter-inputs";
    const range = document.createElement("input");
    range.type = "range";
    range.dataset.parameter = parameter.id;
    range.min = effectiveMin(parameter);
    range.max = parameter.max;
    range.step = parameter.step;
    range.value = state.parameters[parameter.id];
    const number = document.createElement("input");
    number.type = "number";
    number.dataset.parameter = parameter.id;
    number.min = effectiveMin(parameter);
    number.max = parameter.max;
    number.step = parameter.step;
    number.value = state.parameters[parameter.id];
    range.addEventListener("input", () => commitParameter(parameter.id, Number(range.value)));
    number.addEventListener("input", () => {
      if (number.value !== "") commitParameter(parameter.id, Number(number.value));
    });
    inputs.append(range, number);
    wrapper.append(label, inputs);
    container.append(wrapper);
  }
}

function syncParameterInputs() {
  document.querySelectorAll("[data-parameter]").forEach((input) => {
    const value = state.parameters[input.dataset.parameter];
    if (Number(input.value) !== value) input.value = value;
  });
}

function currentOperation() {
  if (state.transformType === "shift") return createTransformOperation("shift", state.transformParameters.shift);
  if (state.transformType === "scale") return createTransformOperation("scale", state.transformParameters.scale);
  return createTransformOperation(state.transformType);
}

function renderTransformParameter() {
  const container = elements["transform-parameter"];
  container.replaceChildren();
  if (state.transformType !== "shift" && state.transformType !== "scale") return;
  const isShift = state.transformType === "shift";
  const id = isShift ? "shift" : "scale";
  const wrapper = document.createElement("div");
  wrapper.className = "parameter-control";
  const label = document.createElement("div");
  label.className = "parameter-label";
  const title = document.createElement("strong");
  title.textContent = isShift ? "平移量  t₀" : "尺度系数  a";
  const unit = document.createElement("span");
  unit.textContent = isShift ? "s" : "a ≠ 0";
  label.append(title, unit);
  const inputs = document.createElement("div");
  inputs.className = "parameter-inputs";
  const range = document.createElement("input");
  range.type = "range";
  range.min = isShift ? -10 : -4;
  range.max = isShift ? 10 : 4;
  range.step = 0.1;
  range.value = state.transformParameters[id];
  range.dataset.transformParameter = id;
  const number = document.createElement("input");
  number.type = "number";
  number.min = range.min;
  number.max = range.max;
  number.step = range.step;
  number.value = range.value;
  number.dataset.transformParameter = id;
  range.addEventListener("input", () => {
    let value = Number(range.value);
    if (!isShift && value === 0) value = state.transformParameters.scale < 0 ? -0.1 : 0.1;
    commitTransformParameter(id, value);
  });
  number.addEventListener("input", () => {
    if (number.value !== "") commitTransformParameter(id, Number(number.value));
  });
  inputs.append(range, number);
  wrapper.append(label, inputs);
  container.append(wrapper);
}

function syncTransformInputs() {
  document.querySelectorAll("[data-transform-parameter]").forEach((input) => {
    const value = state.transformParameters[input.dataset.transformParameter];
    if (Number(input.value) !== value) input.value = value;
  });
}

function commitTransformParameter(id, value) {
  try {
    if (id === "scale" && value === 0) throw new RangeError("尺度系数 a 不能为 0");
    const candidate = { ...state.transformParameters, [id]: value };
    if (id === "shift") createTransformOperation("shift", value);
    if (id === "scale") createTransformOperation("scale", value);
    state.transformParameters = candidate;
    elements["parameter-error"].hidden = true;
    syncTransformInputs();
    renderWorkspace();
  } catch (error) {
    elements["parameter-error"].textContent = `变换参数无效：${error.message}`;
    elements["parameter-error"].hidden = false;
  }
}

function commitParameter(id, value) {
  const candidate = { ...state.parameters, [id]: value };
  if (state.signalId === "periodic-rectangular-wave" && id === "T0" && candidate.T1 >= value / 2) {
    candidate.T1 = Math.max(0.001, value / 2 - 0.001);
  }
  try {
    createSignalModel(state.signalId, candidate);
    state.parameters = candidate;
    elements["parameter-error"].hidden = true;
    syncParameterInputs();
    renderWorkspace();
  } catch (error) {
    elements["parameter-error"].textContent = `参数无效：${error.message}`;
    elements["parameter-error"].hidden = false;
  }
}

function renderNotice(model, transformedModel) {
  const messages = [];
  if (model.timeKind.startsWith("distribution")) messages.push("时域含 Dirac 冲激：图中箭头表示冲激位置与权重，不表示有限高度。 ");
  if (model.definition.spectrumType === "impulse") messages.push("频域为冲激线谱：幅度图箭头高度编码复系数的模，悬停可查看完整复系数。 ");
  if (model.id === "unit-step") messages.push("ω=0 处包含 πδ(ω)，1/(jω) 按柯西主值解释；虚线只显示远离奇点的辅助值。 ");
  if (transformedModel.operation.type === "shift") messages.push("时间平移不改变连续谱幅度；相位增加 −ωt₀。冲激谱线的复系数在各自频率处乘 e^(−jωt₀)。 ");
  if (transformedModel.operation.type === "scale") messages.push("尺度变换使用 1/|a|，不是 1/a；a<0 时频谱同时镜像。 ");
  if (!transformedModel.supported) messages.push(`当前操作未启用：${transformedModel.supportReason} `);
  if (transformedModel.operation.type === "differentiate" && transformedModel.supported) messages.push("微分按解析性质 jωX(jω) 计算；跳变产生的 Dirac 冲激与普通导数分层显示，δ′ 使用带斜杠的冲激箭头。 ");
  if (transformedModel.operation.type === "integrate" && transformedModel.supported) messages.push("积分频谱保留 PV[X(jω)/(jω)] 与 πX(0)δ(ω)。PV 曲线仅是远离奇点的点外代表值，不能解释为分布整体的普通幅相。 ");
  if (messages.length) {
    elements["special-notice"].textContent = messages.join("");
    elements["special-notice"].hidden = false;
  } else {
    elements["special-notice"].hidden = true;
  }
}

function renderComponentSummary(transformedModel) {
  const box = elements["component-summary"];
  if (!transformedModel.supported || !transformedModel.timeRepresentation || transformedModel.operation.type === "none") {
    box.hidden = true;
    return;
  }
  const time = transformedModel.timeRepresentation;
  const spectrum = transformedModel.spectrum;
  const parts = [];
  if (time.continuous) parts.push("时域普通函数项");
  if (time.impulses.length || time.families.length) parts.push(`时域冲激项（${time.impulses.length + time.families.length} 类）`);
  if (time.distributions.length) parts.push("时域广义分布项");
  if (spectrum.continuous) parts.push("频域连续项");
  if (spectrum.distributions?.length) parts.push(`频域主值/分布项（${spectrum.distributions.length}）`);
  if (spectrum.impulses?.lines?.length) parts.push(`频域冲激项（${spectrum.impulses.lines.length}）`);
  box.textContent = `分量模型：${parts.join(" · ") || "零信号"}`;
  box.hidden = false;
}

function renderFormulas(model, transformedModel) {
  renderMath(elements["sidebar-time-formula"], `x(t)=${model.definition.timeExpressionLatex}`);
  renderMath(elements["time-formula"], `x(t)=${model.definition.timeExpressionLatex}`);
  renderMath(elements["frequency-formula"], `X(j\\omega)=${model.definition.frequencyExpressionLatex}`);
  renderMath(elements["transformed-time-formula"], transformedModel.metadata.timeLatex);
  renderMath(elements["transformed-frequency-formula"], transformedModel.metadata.frequencyLatex);
  renderMath(elements["property-formula"], transformedModel.metadata.propertyLatex);
  elements["property-title"].textContent = `${transformedModel.metadata.nameZh} · 解析性质`;
  elements["property-explanation"].textContent = transformedModel.metadata.explanation;
  elements["signal-description"].textContent = model.definition.description;
  elements["current-parameters"].replaceChildren();
  for (const parameter of model.definition.parameters) {
    const chip = document.createElement("span");
    chip.textContent = `${parameter.symbol.replaceAll("\\omega", "ω").replaceAll("_0", "₀")} = ${formatNumber(model.parameters[parameter.id])}${parameter.unit === "1" ? "" : ` ${parameter.unit}`}`;
    elements["current-parameters"].append(chip);
  }
  if (transformedModel.operation.type === "shift" || transformedModel.operation.type === "scale") {
    const chip = document.createElement("span");
    chip.className = "transform-chip";
    chip.textContent = transformedModel.operation.type === "shift"
      ? `t₀ = ${formatNumber(transformedModel.operation.t0)} s`
      : `a = ${formatNumber(transformedModel.operation.a)}`;
    elements["current-parameters"].append(chip);
  }
  elements["constraint-list"].replaceChildren();
  for (const constraint of model.definition.constraints) {
    const item = document.createElement("li");
    item.textContent = constraint.replaceAll("\\omega", "ω").replaceAll("\\pi", "π");
    elements["constraint-list"].append(item);
  }
}

function setStatus(message, isError = false) {
  elements["export-status"].textContent = message;
  elements["export-status"].style.color = isError ? "#a73636" : "#34745c";
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCsv(filename, headers, rows) {
  const content = rowsToCsv(headers, rows);
  downloadBlob(filename, content, "text/csv;charset=utf-8");
  setStatus(`已导出 ${filename}（${rows.length} 行）`);
}

function exportTimeCsv() {
  const snapshot = state.lastRender;
  if (!snapshot) return;
  const rows = [];
  for (const entry of snapshot.entries) {
    const sampled = sampleTimeSignal(entry.model, snapshot.ranges.time);
    for (const point of sampled.points ?? []) rows.push([entry.key, point[0], point[1], point[2]]);
  }
  downloadCsv("ctft-time-continuous.csv", ["series", "t", "real", "imag"], rows);
}

function exportFrequencyCsv() {
  const rows = [];
  for (const entry of state.lastRender?.entries ?? []) {
    for (const point of entry.sampled?.continuous?.magnitude ?? []) {
      rows.push([entry.key, point[0], point[2], point[3], point[1], point[4], state.phaseUnit]);
    }
  }
  downloadCsv("ctft-frequency-continuous.csv", ["series", "omega", "real", "imag", "magnitude", "phase", "phase_unit"], rows);
}

function exportImpulseCsv() {
  const rows = [];
  for (const entry of state.lastRender?.entries ?? []) {
    for (const point of entry.sampled?.impulses ?? []) {
      rows.push([entry.key, point[0], point[2], point[3], point[1], point[4], state.phaseUnit, point[5]]);
    }
  }
  if (!rows.length) {
    setStatus("当前显示内容没有频域冲激谱线", true);
    return;
  }
  downloadCsv("ctft-frequency-impulses.csv", ["series", "omega", "coefficient_real", "coefficient_imag", "coefficient_magnitude", "coefficient_phase", "phase_unit", "label"], rows);
}

function currentConfig() {
  return {
    schemaVersion: "1.0.0",
    convention: "angular-frequency-ctft",
    signalId: state.signalId,
    parameters: { ...state.parameters },
    transform: {
      type: state.transformType,
      parameter: state.transformType === "shift" ? state.transformParameters.shift : state.transformType === "scale" ? state.transformParameters.scale : null
    },
    display: {
      mode: state.displayMode,
      phaseUnit: state.phaseUnit,
      phaseMode: state.phaseMode,
      frequencyMax: state.frequencyMax
    }
  };
}

function exportConfig() {
  downloadBlob("ctft-configuration.json", JSON.stringify(currentConfig(), null, 2), "application/json;charset=utf-8");
  setStatus("已导出当前页面配置");
}

function importConfigObject(config) {
  if (config?.schemaVersion !== "1.0.0" || config.convention !== "angular-frequency-ctft") throw new TypeError("配置版本或 CTFT 约定不兼容");
  const definition = getSignalDefinition(config.signalId);
  const parameters = { ...definition.defaultValues, ...config.parameters };
  createSignalModel(config.signalId, parameters);
  const type = config.transform?.type ?? "none";
  const parameter = config.transform?.parameter;
  createTransformOperation(type, parameter);
  const displayModes = ["original", "transformed", "both"];
  const phaseUnits = ["rad", "deg"];
  const phaseModes = ["principal", "unwrapped"];
  if (!displayModes.includes(config.display?.mode) || !phaseUnits.includes(config.display?.phaseUnit) || !phaseModes.includes(config.display?.phaseMode)) throw new TypeError("显示设置无效");
  const frequencyMax = config.display.frequencyMax === null ? null : Number(config.display.frequencyMax);
  if (frequencyMax !== null && (!Number.isFinite(frequencyMax) || frequencyMax <= 0)) throw new TypeError("频率范围无效");
  state.signalId = config.signalId;
  state.parameters = parameters;
  state.transformType = type;
  if (type === "shift") state.transformParameters.shift = Number(parameter);
  if (type === "scale") state.transformParameters.scale = Number(parameter);
  state.displayMode = type === "none" ? "original" : config.display.mode;
  state.phaseUnit = config.display.phaseUnit;
  state.phaseMode = config.display.phaseMode;
  state.frequencyMax = frequencyMax;
  elements["signal-select"].value = state.signalId;
  elements["transform-select"].value = state.transformType;
  document.querySelectorAll("[data-display-mode]").forEach((button) => button.classList.toggle("active", button.dataset.displayMode === state.displayMode));
  document.querySelectorAll("[data-phase-unit]").forEach((button) => button.classList.toggle("active", button.dataset.phaseUnit === state.phaseUnit));
  document.querySelectorAll("[data-phase-mode]").forEach((button) => button.classList.toggle("active", button.dataset.phaseMode === state.phaseMode));
  renderParameterControls();
  renderTransformParameter();
  renderWorkspace();
}

function renderWorkspace() {
  const model = createSignalModel(state.signalId, state.parameters);
  const operation = currentOperation();
  const transformedModel = transformSignalModel(model, operation);
  state.model = model;
  state.transformedModel = transformedModel;
  const ranges = comparisonRanges(model, operation);
  const automaticFrequencyMax = Math.max(Math.abs(ranges.frequency.min), Math.abs(ranges.frequency.max));
  const displayedFrequencyMax = state.frequencyMax ?? automaticFrequencyMax;
  ranges.frequency = { min: -displayedFrequencyMax, max: displayedFrequencyMax };
  elements["frequency-range"].value = formatNumber(displayedFrequencyMax, 3);
  const allEntries = [
    {
      key: "original",
      label: "原始",
      timeSymbol: "x",
      frequencySymbol: "X",
      color: colors.blue,
      model,
      sampled: sampleSpectrum(model.spectrum, ranges.frequency, state.phaseUnit, undefined, state.phaseMode)
    },
    {
      key: "transformed",
      label: "变换后",
      timeSymbol: "y",
      frequencySymbol: "Y",
      color: colors.orange,
      model: transformedModel,
      sampled: transformedModel.supported ? sampleSpectrum(transformedModel.spectrum, ranges.frequency, state.phaseUnit, undefined, state.phaseMode) : null
    }
  ];
  const validEntries = transformedModel.supported ? allEntries : allEntries.filter((entry) => entry.key === "original");
  const entries = operation.type === "none"
    ? validEntries.filter((entry) => entry.key === "original")
    : state.displayMode === "transformed" && !transformedModel.supported
      ? validEntries
      : state.displayMode === "both" ? validEntries : validEntries.filter((entry) => entry.key === state.displayMode);
  elements["current-signal-title"].textContent = `${model.definition.nameZh} · ${transformedModel.metadata.nameZh}`;
  elements["spectrum-type-badge"].textContent = spectrumLabels[model.definition.spectrumType];
  elements["time-range-label"].textContent = `t ∈ [${formatNumber(ranges.time.min, 2)}, ${formatNumber(ranges.time.max, 2)}] s`;
  elements["phase-unit-label"].textContent = `${state.phaseMode === "unwrapped" ? "展开相位" : "主值相位"} · ${state.phaseUnit === "rad" ? "弧度" : "角度"} · 零幅值处未定义`;
  renderFormulas(model, transformedModel);
  renderNotice(model, transformedModel);
  renderComponentSummary(transformedModel);
  charts.time.setOption(buildTimeOption(entries, ranges), true);
  charts.magnitude.setOption(buildMagnitudeOption(entries, ranges), true);
  charts.phase.setOption(buildPhaseOption(entries, ranges), true);
  state.lastRender = { entries, ranges };
}

elements["signal-select"].addEventListener("change", (event) => {
  const definition = getSignalDefinition(event.target.value);
  state.signalId = definition.id;
  state.parameters = { ...definition.defaultValues };
  state.frequencyMax = null;
  elements["parameter-error"].hidden = true;
  renderParameterControls();
  renderWorkspace();
});

elements["transform-select"].addEventListener("change", (event) => {
  state.transformType = event.target.value;
  state.displayMode = state.transformType === "none" ? "original" : "both";
  document.querySelectorAll("[data-display-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.displayMode === state.displayMode);
  });
  elements["parameter-error"].hidden = true;
  renderTransformParameter();
  renderWorkspace();
});

document.querySelectorAll("[data-display-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.displayMode = button.dataset.displayMode;
    document.querySelectorAll("[data-display-mode]").forEach((item) => item.classList.toggle("active", item === button));
    renderWorkspace();
  });
});

document.querySelectorAll("[data-phase-unit]").forEach((button) => {
  button.addEventListener("click", () => {
    state.phaseUnit = button.dataset.phaseUnit;
    document.querySelectorAll("[data-phase-unit]").forEach((item) => item.classList.toggle("active", item === button));
    renderWorkspace();
  });
});

document.querySelectorAll("[data-phase-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.phaseMode = button.dataset.phaseMode;
    document.querySelectorAll("[data-phase-mode]").forEach((item) => item.classList.toggle("active", item === button));
    renderWorkspace();
  });
});

elements["restore-original"].addEventListener("click", () => {
  state.transformType = "none";
  state.displayMode = "original";
  elements["transform-select"].value = "none";
  document.querySelectorAll("[data-display-mode]").forEach((button) => button.classList.toggle("active", button.dataset.displayMode === "original"));
  renderTransformParameter();
  renderWorkspace();
});

elements["reset-transform"].addEventListener("click", () => {
  state.transformParameters = { shift: 1, scale: 2 };
  elements["parameter-error"].hidden = true;
  renderTransformParameter();
  renderWorkspace();
});

elements["frequency-range"].addEventListener("change", () => {
  const value = Number(elements["frequency-range"].value);
  if (!Number.isFinite(value) || value <= 0) {
    setStatus("频率显示范围必须是正数", true);
    renderWorkspace();
    return;
  }
  state.frequencyMax = value;
  renderWorkspace();
});

elements["frequency-auto"].addEventListener("click", () => {
  state.frequencyMax = null;
  renderWorkspace();
  setStatus("已恢复自动频率范围");
});

document.querySelectorAll("[data-export-png]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.exportPng;
    const dataUrl = charts[key].getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `ctft-${key}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setStatus(`已导出 ctft-${key}.png`);
  });
});

elements["export-time-csv"].addEventListener("click", exportTimeCsv);
elements["export-frequency-csv"].addEventListener("click", exportFrequencyCsv);
elements["export-impulse-csv"].addEventListener("click", exportImpulseCsv);
elements["export-config"].addEventListener("click", exportConfig);
elements["import-config"].addEventListener("click", () => elements["import-config-file"].click());
elements["import-config-file"].addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const config = JSON.parse(await file.text());
    importConfigObject(config);
    setStatus(`已导入 ${file.name}`);
  } catch (error) {
    setStatus(`导入失败：${error.message}`, true);
  } finally {
    event.target.value = "";
  }
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize()));
});

renderSignalOptions();
renderPropertyReference();
renderParameterControls();
renderTransformParameter();
renderWorkspace();
document.body.dataset.appReady = "true";
