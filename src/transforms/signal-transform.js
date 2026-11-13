import { Complex } from "../math/complex.js";
import { ContinuousSpectrum } from "../math/spectrum.js";
import {
  CompositeTimeSignal,
  ContinuousTimeComponent,
  TimeDistributionTerm,
  TimeImpulse,
  TimeImpulseFamily
} from "../math/time-signal.js";
import {
  differentiateInTime,
  integrateFromNegativeInfinity,
  timeReverse,
  timeScale,
  timeShift
} from "./properties.js";

export const TRANSFORM_TYPES = Object.freeze(["none", "reverse", "shift", "scale", "differentiate", "integrate"]);

const INTEGRATION_SUPPORT = Object.freeze({
  "unit-impulse": true,
  "shifted-impulse": true,
  "rectangular-pulse": true,
  "triangular-pulse": true,
  "one-sided-exponential": true,
  "two-sided-exponential": true,
  "t-times-exponential": true
});

export function createTransformOperation(type = "none", parameter = null) {
  if (!TRANSFORM_TYPES.includes(type)) throw new RangeError(`Unsupported transform type: ${type}`);
  if (type === "shift") {
    const t0 = Number(parameter ?? 1);
    if (!Number.isFinite(t0)) throw new TypeError("Time shift t0 must be finite");
    return Object.freeze({ type, t0 });
  }
  if (type === "scale") {
    const a = Number(parameter ?? 2);
    if (!Number.isFinite(a) || a === 0) throw new RangeError("Time scale a must be finite and nonzero");
    return Object.freeze({ type, a });
  }
  return Object.freeze({ type });
}

function sourceIdentity(model) {
  return { id: model.sourceId ?? model.id, source: model.sourceModel ?? model };
}

export function getTransformSupport(sourceModel, operationInput) {
  const operation = operationInput?.type ? operationInput : createTransformOperation("none");
  const { id } = sourceIdentity(sourceModel);
  if (operation.type !== "integrate") return Object.freeze({ supported: true, reason: null });
  if (INTEGRATION_SUPPORT[id]) return Object.freeze({ supported: true, reason: null });
  const reasons = {
    constant: "常数信号从负无穷开始的累积积分发散；当前版本不引入任意积分常数或 δ′(ω) 频谱。",
    "unit-step": "阶跃已含主值与零频冲激，再次除以 jω 涉及更高阶分布；当前版本明确禁用。",
    "sinc-signal": "sinc 的累积积分需要正弦积分 Si 及条件收敛约定，当前解析时域引擎尚未实现。",
    sine: "周期正弦从负无穷起的普通积分不收敛；当前版本未启用零均值原函数模式。",
    cosine: "周期余弦从负无穷起的普通积分不收敛；当前版本未启用零均值原函数模式。",
    "complex-exponential": "周期复指数从负无穷起的普通积分不收敛。",
    "periodic-rectangular-wave": "该周期信号含非零直流分量，从负无穷起的累积积分发散。",
    "periodic-impulse-train": "周期冲激串含非零平均值，累积积分无界且需要周期分布约定。"
  };
  return Object.freeze({ supported: false, reason: reasons[id] ?? "当前信号的广义积分尚未由解析引擎支持。" });
}

function operationMetadata(operation) {
  switch (operation.type) {
    case "reverse":
      return {
        nameZh: "时间翻转",
        propertyLatex: "x(-t)\\longleftrightarrow X(-j\\omega)",
        timeLatex: "y(t)=x(-t)",
        frequencyLatex: "Y(j\\omega)=X(-j\\omega)",
        explanation: "时域关于 t=0 镜像；频谱关于 ω=0 镜像，冲激谱线位置改变符号。"
      };
    case "shift":
      return {
        nameZh: "时间平移",
        propertyLatex: "x(t-t_0)\\longleftrightarrow e^{-j\\omega t_0}X(j\\omega)",
        timeLatex: `y(t)=x(t-(${operation.t0}))`,
        frequencyLatex: `Y(j\\omega)=e^{-j\\omega(${operation.t0})}X(j\\omega)`,
        explanation: `时域平移 ${operation.t0} s；频谱幅度保持不变，相位增加 −ωt₀。正 t₀ 向右平移，负 t₀ 向左平移。`
      };
    case "scale":
      return {
        nameZh: "时间尺度变换",
        propertyLatex: "x(at)\\longleftrightarrow \\frac{1}{|a|}X\\!\\left(j\\frac{\\omega}{a}\\right)",
        timeLatex: `y(t)=x((${operation.a})t)`,
        frequencyLatex: `Y(j\\omega)=\\frac{1}{|${operation.a}|}X\\!\\left(j\\frac{\\omega}{${operation.a}}\\right)`,
        explanation: `|a|=${Math.abs(operation.a)}：时域${Math.abs(operation.a) > 1 ? "压缩" : Math.abs(operation.a) < 1 ? "扩展" : "宽度不变"}，频域反向变化并乘 1/|a|；${operation.a < 0 ? "a<0 同时包含时间翻转。" : "a>0 不引入额外翻转。"}`
      };
    case "differentiate":
      return {
        nameZh: "时域微分",
        propertyLatex: "\\frac{d}{dt}x(t)\\longleftrightarrow j\\omega X(j\\omega)",
        timeLatex: "y(t)=\\frac{d}{dt}x(t)",
        frequencyLatex: "Y(j\\omega)=j\\omega X(j\\omega)",
        explanation: "普通导数与跳变产生的 Dirac 冲激分别建模；冲激导数使用 δ′ 专用标记，不采用采样差分。"
      };
    case "integrate":
      return {
        nameZh: "从负无穷累积积分",
        propertyLatex: "\\int_{-\\infty}^{t}x(\\tau)d\\tau\\longleftrightarrow \\operatorname{PV}\\!\\left[\\frac{X(j\\omega)}{j\\omega}\\right]+\\pi X(0)\\delta(\\omega)",
        timeLatex: "y(t)=\\int_{-\\infty}^{t}x(\\tau)d\\tau",
        frequencyLatex: "Y(j\\omega)=\\operatorname{PV}\\!\\left[\\frac{X(j\\omega)}{j\\omega}\\right]+\\pi X(0)\\delta(\\omega)",
        explanation: "零频不能直接设为零：连续部分按主值分布解释，并保留系数为 πX(0) 的零频冲激。"
      };
    default:
      return {
        nameZh: "无变换",
        propertyLatex: "y(t)=x(t)\\longleftrightarrow Y(j\\omega)=X(j\\omega)",
        timeLatex: "y(t)=x(t)",
        frequencyLatex: "Y(j\\omega)=X(j\\omega)",
        explanation: "当前显示原始信号；请选择一种变换观察时域与频域的对应变化。"
      };
  }
}

function continuous(evaluate, latex) {
  return new ContinuousTimeComponent({ evaluate, latex });
}

function differentiatedTime(sourceModel) {
  const { id, source } = sourceIdentity(sourceModel);
  const p = source.parameters;
  const impulses = [];
  const families = [];
  const distributions = [];
  let ordinary = null;
  let latex = `\\frac{d}{dt}\\left[${source.definition.timeExpressionLatex}\\right]`;

  switch (id) {
    case "unit-impulse":
      impulses.push(new TimeImpulse(0, 1, { derivativeOrder: 1, label: "δ′(t)" }));
      latex = "\\delta'(t)";
      break;
    case "shifted-impulse":
      impulses.push(new TimeImpulse(p.t0, p.A, { derivativeOrder: 1, label: "Aδ′(t−t₀)" }));
      latex = "A\\delta'(t-t_0)";
      break;
    case "constant":
      ordinary = continuous(() => 0, "0");
      latex = "0";
      break;
    case "unit-step":
      impulses.push(new TimeImpulse(0, 1, { label: "δ(t)" }));
      latex = "\\delta(t)";
      break;
    case "rectangular-pulse":
      impulses.push(
        new TimeImpulse(-p.T / 2, p.A, { label: "+Aδ(t+T/2)" }),
        new TimeImpulse(p.T / 2, -p.A, { label: "−Aδ(t−T/2)" })
      );
      latex = "A[\\delta(t+T/2)-\\delta(t-T/2)]";
      break;
    case "triangular-pulse":
      ordinary = continuous((t) => t > -p.T && t < 0 ? p.A / p.T : t > 0 && t < p.T ? -p.A / p.T : 0, "\\frac{A}{T}\\operatorname{sgn}(-t)\\,\\mathbf{1}_{|t|<T}");
      break;
    case "sinc-signal":
      ordinary = continuous((t) => {
        const z = p.W * t;
        return Math.abs(z) < 1e-6 ? 0 : p.A * p.W * (z * Math.cos(z) - Math.sin(z)) / (z * z);
      }, "AW\\frac{Wt\\cos(Wt)-\\sin(Wt)}{(Wt)^2}");
      latex = "AW\\frac{Wt\\cos(Wt)-\\sin(Wt)}{(Wt)^2}";
      break;
    case "one-sided-exponential":
      ordinary = continuous((t) => t > 0 ? -p.a * p.A * Math.exp(-p.a * t) : 0, "-aAe^{-at}u(t)");
      impulses.push(new TimeImpulse(0, p.A, { label: "Aδ(t)" }));
      latex = "A\\delta(t)-aAe^{-at}u(t)";
      break;
    case "two-sided-exponential":
      ordinary = continuous((t) => t < 0 ? p.a * p.A * Math.exp(p.a * t) : t > 0 ? -p.a * p.A * Math.exp(-p.a * t) : 0, "-aA\\operatorname{sgn}(t)e^{-a|t|}");
      latex = "-aA\\operatorname{sgn}(t)e^{-a|t|}";
      break;
    case "t-times-exponential":
      ordinary = continuous((t) => t >= 0 ? p.A * (1 - p.a * t) * Math.exp(-p.a * t) : 0, "A(1-at)e^{-at}u(t)");
      latex = "A(1-at)e^{-at}u(t)";
      break;
    case "complex-exponential":
      ordinary = continuous((t) => source.evaluateTime(t).mul(new Complex(0, p.omega0)), "j\\omega_0Ae^{j\\omega_0t}");
      latex = "j\\omega_0Ae^{j\\omega_0t}";
      break;
    case "cosine":
      ordinary = continuous((t) => -p.A * p.omega0 * Math.sin(p.omega0 * t), "-A\\omega_0\\sin(\\omega_0t)");
      latex = "-A\\omega_0\\sin(\\omega_0t)";
      break;
    case "sine":
      ordinary = continuous((t) => p.A * p.omega0 * Math.cos(p.omega0 * t), "A\\omega_0\\cos(\\omega_0t)");
      latex = "A\\omega_0\\cos(\\omega_0t)";
      break;
    case "periodic-rectangular-wave":
      families.push(new TimeImpulseFamily({
        derivativeOrder: 0,
        latex: "A\\sum_n[\\delta(t-nT_0+T_1)-\\delta(t-nT_0-T_1)]",
        generate: (range) => {
          const from = Math.floor(range.min / p.T0) - 2;
          const to = Math.ceil(range.max / p.T0) + 2;
          const result = [];
          for (let n = from; n <= to; n += 1) {
            const left = n * p.T0 - p.T1;
            const right = n * p.T0 + p.T1;
            if (left >= range.min && left <= range.max) result.push(new TimeImpulse(left, p.A, { label: `+A, n=${n}` }));
            if (right >= range.min && right <= range.max) result.push(new TimeImpulse(right, -p.A, { label: `−A, n=${n}` }));
          }
          return result;
        }
      }));
      latex = "A\\sum_n[\\delta(t-nT_0+T_1)-\\delta(t-nT_0-T_1)]";
      break;
    case "periodic-impulse-train":
      families.push(new TimeImpulseFamily({
        derivativeOrder: 1,
        latex: "A\\sum_n\\delta'(t-nT_0)",
        generate: (range) => {
          const from = Math.ceil(range.min / p.T0);
          const to = Math.floor(range.max / p.T0);
          const result = [];
          for (let n = from; n <= to; n += 1) result.push(new TimeImpulse(n * p.T0, p.A, { derivativeOrder: 1, label: `Aδ′, n=${n}` }));
          return result;
        }
      }));
      latex = "A\\sum_n\\delta'(t-nT_0)";
      break;
    default:
      distributions.push(new TimeDistributionTerm({ distributionKind: "symbolic-derivative", latex, description: "仅保留符号导数" }));
  }
  return new CompositeTimeSignal({ continuous: ordinary, impulses, families, distributions, latex });
}

function integratedTime(sourceModel) {
  const { id, source } = sourceIdentity(sourceModel);
  const p = source.parameters;
  let ordinary;
  let latex;
  switch (id) {
    case "unit-impulse":
      ordinary = continuous((t) => t < 0 ? 0 : t > 0 ? 1 : 0.5, "u(t)");
      latex = "u(t)";
      break;
    case "shifted-impulse":
      ordinary = continuous((t) => t < p.t0 ? 0 : t > p.t0 ? p.A : p.A / 2, "Au(t-t_0)");
      latex = "Au(t-t_0)";
      break;
    case "rectangular-pulse":
      ordinary = continuous((t) => t <= -p.T / 2 ? 0 : t < p.T / 2 ? p.A * (t + p.T / 2) : p.A * p.T, "A(t+T/2)[u(t+T/2)-u(t-T/2)]+ATu(t-T/2)");
      latex = "\\begin{cases}0,&t\\le -T/2\\\\A(t+T/2),&-T/2<t<T/2\\\\AT,&t\\ge T/2\\end{cases}";
      break;
    case "triangular-pulse":
      ordinary = continuous((t) => {
        if (t <= -p.T) return 0;
        if (t < 0) return p.A * (t + p.T) ** 2 / (2 * p.T);
        if (t < p.T) return p.A * p.T / 2 + p.A * (t - t * t / (2 * p.T));
        return p.A * p.T;
      }, "\\int_{-\\infty}^{t}A\\operatorname{tri}(\\tau/T)d\\tau");
      latex = "\\int_{-\\infty}^{t}A\\operatorname{tri}(\\tau/T)d\\tau";
      break;
    case "one-sided-exponential":
      ordinary = continuous((t) => t < 0 ? 0 : p.A / p.a * (1 - Math.exp(-p.a * t)), "\\frac{A}{a}(1-e^{-at})u(t)");
      latex = "\\frac{A}{a}(1-e^{-at})u(t)";
      break;
    case "two-sided-exponential":
      ordinary = continuous((t) => t < 0 ? p.A / p.a * Math.exp(p.a * t) : 2 * p.A / p.a - p.A / p.a * Math.exp(-p.a * t), "\\int_{-\\infty}^{t}Ae^{-a|\\tau|}d\\tau");
      latex = "\\begin{cases}\\frac{A}{a}e^{at},&t<0\\\\\\frac{2A}{a}-\\frac{A}{a}e^{-at},&t\\ge0\\end{cases}";
      break;
    case "t-times-exponential":
      ordinary = continuous((t) => t < 0 ? 0 : p.A / (p.a * p.a) * (1 - (1 + p.a * t) * Math.exp(-p.a * t)), "\\frac{A}{a^2}[1-(1+at)e^{-at}]u(t)");
      latex = "\\frac{A}{a^2}[1-(1+at)e^{-at}]u(t)";
      break;
    default:
      throw new RangeError("Unsupported integration time model");
  }
  return new CompositeTimeSignal({ continuous: ordinary, latex });
}

function differentiatedSpectrum(sourceModel) {
  const { id, source } = sourceIdentity(sourceModel);
  if (id === "unit-step") return new ContinuousSpectrum({ evaluate: () => 1, latex: "1" });
  if (id === "constant") return new ContinuousSpectrum({ evaluate: () => 0, latex: "0" });
  return differentiateInTime(source.spectrum);
}

function transformSpectrum(spectrum, operation) {
  if (operation.type === "reverse") return timeReverse(spectrum);
  if (operation.type === "shift") return timeShift(spectrum, operation.t0);
  if (operation.type === "scale") return timeScale(spectrum, operation.a);
  return spectrum;
}

function transformTimeArgument(t, operation) {
  if (operation.type === "reverse") return -t;
  if (operation.type === "shift") return t - operation.t0;
  if (operation.type === "scale") return operation.a * t;
  return t;
}

export function mapTimeImpulse(position, coefficient, operation) {
  if (operation.type === "reverse") return { position: -position, coefficient };
  if (operation.type === "shift") return { position: position + operation.t0, coefficient };
  if (operation.type === "scale") return { position: position / operation.a, coefficient: coefficient / Math.abs(operation.a) };
  return { position, coefficient };
}

function unsupportedModel(sourceModel, operation, reason) {
  const metadata = operationMetadata(operation);
  return Object.freeze({
    ...sourceModel,
    id: `${sourceModel.id}--${operation.type}-unsupported`,
    sourceId: sourceModel.sourceId ?? sourceModel.id,
    sourceModel: sourceModel.sourceModel ?? sourceModel,
    operation,
    supported: false,
    supportReason: reason,
    metadata: Object.freeze({
      ...metadata,
      timeLatex: "y(t)=\\text{当前模式不支持}",
      frequencyLatex: "Y(j\\omega)=\\text{未定义}",
      explanation: reason
    })
  });
}

export function transformSignalModel(sourceModel, operationInput) {
  const operation = operationInput?.type ? createTransformOperation(
    operationInput.type,
    operationInput.type === "shift" ? operationInput.t0 : operationInput.type === "scale" ? operationInput.a : null
  ) : createTransformOperation("none");
  const support = getTransformSupport(sourceModel, operation);
  if (!support.supported) return unsupportedModel(sourceModel, operation, support.reason);
  const metadata = operationMetadata(operation);
  const base = {
    ...sourceModel,
    id: `${sourceModel.id}--${operation.type}`,
    sourceId: sourceModel.sourceId ?? sourceModel.id,
    sourceModel: sourceModel.sourceModel ?? sourceModel,
    operation,
    supported: true,
    supportReason: null
  };

  if (operation.type === "differentiate" || operation.type === "integrate") {
    const timeRepresentation = operation.type === "differentiate"
      ? differentiatedTime(sourceModel)
      : integratedTime(sourceModel);
    const spectrum = operation.type === "differentiate"
      ? differentiatedSpectrum(sourceModel)
      : integrateFromNegativeInfinity(sourceIdentity(sourceModel).source.spectrum);
    return Object.freeze({
      ...base,
      metadata: Object.freeze({ ...metadata, timeLatex: `y(t)=${timeRepresentation.latex}` }),
      timeKind: timeRepresentation.impulses.length || timeRepresentation.families.length || timeRepresentation.distributions.length
        ? "composite-time"
        : "ordinary",
      timeRepresentation,
      spectrum,
      evaluateTime(t) { return timeRepresentation.evaluateRegular(t); },
      mapTimeImpulse(position, coefficient) { return { position, coefficient }; }
    });
  }

  return Object.freeze({
    ...base,
    metadata,
    timeKind: sourceModel.timeKind,
    spectrum: transformSpectrum(sourceModel.spectrum, operation),
    evaluateTime(t) { return sourceModel.evaluateTime(transformTimeArgument(t, operation)); },
    mapTimeImpulse(position, coefficient) {
      const previous = sourceModel.mapTimeImpulse
        ? sourceModel.mapTimeImpulse(position, coefficient)
        : { position, coefficient };
      return mapTimeImpulse(previous.position, previous.coefficient, operation);
    }
  });
}

export function applyTransformQueue(sourceModel, operations = []) {
  if (!Array.isArray(operations)) throw new TypeError("operations must be an array");
  if (operations.filter((operation) => operation.type === "differentiate" || operation.type === "integrate").length > 1) {
    throw new RangeError("The current queue supports at most one calculus operation");
  }
  return operations.reduce((model, operation) => {
    const next = transformSignalModel(model, operation);
    if (!next.supported) throw new RangeError(next.supportReason);
    return next;
  }, sourceModel);
}
