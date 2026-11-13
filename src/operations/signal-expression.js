import { Complex, ZERO } from "../math/complex.js";
import {
  asComposite,
  CompositeSpectrum,
  ContinuousSpectrum,
  DistributionTerm,
  ImpulseLine,
  ImpulseSpectrum
} from "../math/spectrum.js";
import { createSignalModel } from "../signals/registry.js";
import { defaultRanges } from "../plotting/sampling.js";
import { timeScale, timeShift } from "../transforms/properties.js";

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
};

const NUMERIC_CONVOLUTION_UNSAFE = new Set([
  "constant", "unit-step", "complex-exponential", "cosine", "sine",
  "periodic-rectangular-wave", "periodic-impulse-train"
]);

export function leaf(signalId, parameters = {}) {
  return { type: "leaf", signalId, parameters: { ...parameters } };
}

export function amplitude(factor, child) {
  return { type: "scale", factor: finite(factor, "amplitude factor"), child };
}

export function shift(t0, child) {
  return { type: "shift", t0: finite(t0, "time shift"), child };
}

export function stretch(a, child) {
  const value = finite(a, "time scale");
  if (value === 0) throw new RangeError("time scale cannot be zero");
  return { type: "timeScale", a: value, child };
}

export function sum(children) {
  if (!Array.isArray(children) || children.length === 0) throw new RangeError("sum requires at least one child");
  return { type: "sum", children: [...children] };
}

export function convolution(left, right, options = {}) {
  return { type: "convolution", left, right, options: { ...options } };
}

export function termNode({ signalId, parameters = {}, coefficient = 1, shift: t0 = 0, scale = 1 }) {
  let node = leaf(signalId, parameters);
  if (scale !== 1) node = stretch(scale, node);
  if (t0 !== 0) node = shift(t0, node);
  if (coefficient !== 1) node = amplitude(coefficient, node);
  return node;
}

function scaledDistribution(term, factor) {
  return new DistributionTerm({
    distributionKind: term.distributionKind,
    latex: `${factor}[${term.latex}]`,
    singularities: term.singularities,
    evaluateAway: term.evaluateAwayFunction ? (w) => term.evaluateAway(w).scale(factor) : null,
    order: term.order,
    frequency: term.frequency,
    coefficient: term.coefficient ? term.coefficient.scale(factor) : null
  });
}

export function scaleSpectrum(source, factor, latex = null) {
  const value = finite(factor, "spectrum factor");
  const input = asComposite(source);
  const expression = latex ?? `${value}[${source.latex}]`;
  return new CompositeSpectrum({
    continuous: input.continuous ? new ContinuousSpectrum({
      latex: expression,
      specialPoints: input.continuous.specialPoints,
      evaluate: (w) => input.continuous.evaluate(w).scale(value)
    }) : null,
    impulses: input.impulses ? new ImpulseSpectrum({
      latex: expression,
      lines: input.impulses.lines.map((line) => new ImpulseLine(line.frequency, line.coefficient.scale(value), line.label)),
      infiniteFamily: input.impulses.infiniteFamily
    }) : null,
    distributions: input.distributions.map((term) => scaledDistribution(term, value)),
    latex: expression
  });
}

function mergeImpulseLines(spectra, epsilon = 1e-9) {
  const merged = [];
  for (const spectrum of spectra) {
    if (!spectrum) continue;
    for (const line of spectrum.lines) {
      const existing = merged.find((item) => Math.abs(item.frequency - line.frequency) <= epsilon);
      if (existing) existing.coefficient = existing.coefficient.add(line.coefficient);
      else merged.push({ frequency: line.frequency, coefficient: line.coefficient, label: line.label });
    }
  }
  return merged
    .filter((item) => item.coefficient.abs() > 1e-12)
    .sort((a, b) => a.frequency - b.frequency)
    .map((item) => new ImpulseLine(item.frequency, item.coefficient, item.label));
}

export function addSpectra(sources, latex = null) {
  const inputs = sources.map(asComposite);
  const continuousParts = inputs.map((item) => item.continuous).filter(Boolean);
  const impulseParts = inputs.map((item) => item.impulses).filter(Boolean);
  const expression = latex ?? sources.map((item) => `[${item.latex}]`).join("+");
  return new CompositeSpectrum({
    continuous: continuousParts.length ? new ContinuousSpectrum({
      latex: expression,
      specialPoints: [...new Set(continuousParts.flatMap((item) => item.specialPoints))],
      evaluate: (w) => continuousParts.reduce((total, item) => total.add(item.evaluate(w)), ZERO)
    }) : null,
    impulses: impulseParts.length ? new ImpulseSpectrum({
      latex: expression,
      lines: mergeImpulseLines(impulseParts)
    }) : null,
    distributions: inputs.flatMap((item) => item.distributions),
    latex: expression
  });
}

export function multiplySpectra(first, second, latex = null) {
  const left = asComposite(first);
  const right = asComposite(second);
  if (left.distributions.length || right.distributions.length) {
    throw new TypeError("包含主值或其他广义函数的频谱乘积当前不定义");
  }
  if (left.impulses && right.impulses) {
    throw new TypeError("两个冲激频谱的逐点乘积通常不定义");
  }
  const expression = latex ?? `[${first.latex}][${second.latex}]`;
  let continuous = null;
  let impulses = null;
  if (left.continuous && right.continuous) {
    continuous = new ContinuousSpectrum({
      latex: expression,
      specialPoints: [...new Set([...left.continuous.specialPoints, ...right.continuous.specialPoints])],
      evaluate: (w) => left.continuous.evaluate(w).mul(right.continuous.evaluate(w))
    });
  }
  const lines = [];
  if (left.impulses && right.continuous) {
    for (const line of left.impulses.lines) {
      lines.push(new ImpulseLine(line.frequency, line.coefficient.mul(right.continuous.evaluate(line.frequency)), line.label));
    }
  }
  if (right.impulses && left.continuous) {
    for (const line of right.impulses.lines) {
      lines.push(new ImpulseLine(line.frequency, line.coefficient.mul(left.continuous.evaluate(line.frequency)), line.label));
    }
  }
  if (lines.length) impulses = new ImpulseSpectrum({ latex: expression, lines: mergeImpulseLines([new ImpulseSpectrum({ latex: expression, lines })]) });
  return new CompositeSpectrum({ continuous, impulses, latex: expression });
}

function leafImpulse(node) {
  if (node.type === "leaf") {
    if (node.signalId === "unit-impulse") return { position: 0, coefficient: 1 };
    if (node.signalId === "shifted-impulse") {
      const model = createSignalModel(node.signalId, node.parameters);
      return { position: model.parameters.t0, coefficient: model.parameters.A };
    }
    return null;
  }
  if (node.type === "scale") {
    const impulse = leafImpulse(node.child);
    return impulse ? { ...impulse, coefficient: impulse.coefficient * node.factor } : null;
  }
  if (node.type === "shift") {
    const impulse = leafImpulse(node.child);
    return impulse ? { ...impulse, position: impulse.position + node.t0 } : null;
  }
  if (node.type === "timeScale") {
    const impulse = leafImpulse(node.child);
    return impulse ? { position: impulse.position / node.a, coefficient: impulse.coefficient / Math.abs(node.a) } : null;
  }
  return null;
}

function windowFor(node) {
  switch (node.type) {
    case "leaf": {
      const model = createSignalModel(node.signalId, node.parameters);
      const range = defaultRanges(model).time;
      if (node.signalId === "rectangular-pulse") return { min: -model.parameters.T / 2, max: model.parameters.T / 2 };
      if (node.signalId === "triangular-pulse") return { min: -model.parameters.T, max: model.parameters.T };
      if (node.signalId === "one-sided-exponential" || node.signalId === "t-times-exponential") {
        return { min: -0.25 / model.parameters.a, max: 12 / model.parameters.a };
      }
      if (node.signalId === "two-sided-exponential") return { min: -12 / model.parameters.a, max: 12 / model.parameters.a };
      return range;
    }
    case "scale": return windowFor(node.child);
    case "shift": {
      const range = windowFor(node.child);
      return { min: range.min + node.t0, max: range.max + node.t0 };
    }
    case "timeScale": {
      const range = windowFor(node.child);
      const first = range.min / node.a;
      const last = range.max / node.a;
      return { min: Math.min(first, last), max: Math.max(first, last) };
    }
    case "sum": {
      const ranges = node.children.map(windowFor);
      return { min: Math.min(...ranges.map((item) => item.min)), max: Math.max(...ranges.map((item) => item.max)) };
    }
    case "convolution": {
      const left = windowFor(node.left);
      const right = windowFor(node.right);
      return { min: left.min + right.min, max: left.max + right.max };
    }
    default: throw new RangeError(`Unknown expression node: ${node.type}`);
  }
}

export function expressionWindow(node) {
  return windowFor(node);
}

function numericalConvolution(leftModel, rightModel, t, options = {}) {
  const leftRange = leftModel.window;
  const rightRange = rightModel.window;
  const min = Math.max(leftRange.min, t - rightRange.max);
  const max = Math.min(leftRange.max, t - rightRange.min);
  if (!(max > min)) return ZERO;
  const samples = Math.max(100, Math.min(2400, Math.trunc(options.samples ?? 800)));
  const step = (max - min) / samples;
  let total = ZERO;
  for (let index = 0; index < samples; index += 1) {
    const tau = min + (index + 0.5) * step;
    total = total.add(leftModel.evaluate(tau).mul(rightModel.evaluate(t - tau)));
  }
  return total.scale(step);
}

export function buildExpression(node) {
  if (!node || typeof node !== "object") throw new TypeError("expression node is required");
  switch (node.type) {
    case "leaf": {
      const source = createSignalModel(node.signalId, node.parameters);
      return {
        node,
        latex: source.definition.timeExpressionLatex,
        frequencyLatex: source.definition.frequencyExpressionLatex,
        spectrum: source.spectrum,
        window: windowFor(node),
        pointwise: !source.timeKind.startsWith("distribution"),
        numericalSafe: !NUMERIC_CONVOLUTION_UNSAFE.has(node.signalId),
        evaluate: (t) => source.evaluateTime(t)
      };
    }
    case "scale": {
      const child = buildExpression(node.child);
      return {
        node,
        latex: String.raw`${node.factor}\left[${child.latex}\right]`,
        frequencyLatex: String.raw`${node.factor}\left[${child.frequencyLatex}\right]`,
        spectrum: scaleSpectrum(child.spectrum, node.factor),
        window: child.window,
        pointwise: child.pointwise,
        numericalSafe: child.numericalSafe,
        evaluate: (t) => child.evaluate(t).scale(node.factor)
      };
    }
    case "shift": {
      const child = buildExpression(node.child);
      return {
        node,
        latex: String.raw`\left[${child.latex}\right]_{t\mapsto t-${node.t0}}`,
        frequencyLatex: String.raw`e^{-j\omega(${node.t0})}\left[${child.frequencyLatex}\right]`,
        spectrum: timeShift(child.spectrum, node.t0),
        window: windowFor(node),
        pointwise: child.pointwise,
        numericalSafe: child.numericalSafe,
        evaluate: (t) => child.evaluate(t - node.t0)
      };
    }
    case "timeScale": {
      const child = buildExpression(node.child);
      return {
        node,
        latex: String.raw`\left[${child.latex}\right]_{t\mapsto ${node.a}t}`,
        frequencyLatex: String.raw`\frac{1}{|${node.a}|}\left[${child.frequencyLatex}\right]_{\omega\mapsto\omega/${node.a}}`,
        spectrum: timeScale(child.spectrum, node.a),
        window: windowFor(node),
        pointwise: child.pointwise,
        numericalSafe: child.numericalSafe,
        evaluate: (t) => child.evaluate(node.a * t)
      };
    }
    case "sum": {
      const children = node.children.map(buildExpression);
      return {
        node,
        latex: children.map((item) => String.raw`\left(${item.latex}\right)`).join("+"),
        frequencyLatex: children.map((item) => String.raw`\left(${item.frequencyLatex}\right)`).join("+"),
        spectrum: addSpectra(children.map((item) => item.spectrum)),
        window: windowFor(node),
        pointwise: children.every((item) => item.pointwise),
        numericalSafe: children.every((item) => item.numericalSafe),
        evaluate: (t) => children.reduce((total, item) => total.add(item.evaluate(t)), ZERO)
      };
    }
    case "convolution": {
      const leftModel = buildExpression(node.left);
      const rightModel = buildExpression(node.right);
      const leftImpulse = leafImpulse(node.left);
      const rightImpulse = leafImpulse(node.right);
      const spectrum = multiplySpectra(leftModel.spectrum, rightModel.spectrum);
      let evaluate;
      let method;
      if (leftImpulse && rightModel.pointwise) {
        evaluate = (t) => rightModel.evaluate(t - leftImpulse.position).scale(leftImpulse.coefficient);
        method = "impulse-analytic";
      } else if (rightImpulse && leftModel.pointwise) {
        evaluate = (t) => leftModel.evaluate(t - rightImpulse.position).scale(rightImpulse.coefficient);
        method = "impulse-analytic";
      } else if (leftModel.pointwise && rightModel.pointwise && leftModel.numericalSafe && rightModel.numericalSafe) {
        evaluate = (t) => numericalConvolution(leftModel, rightModel, t, node.options);
        method = "numeric-trapezoid";
      } else {
        throw new TypeError("当前数值卷积只支持有限支撑或充分衰减的普通信号，或一个单冲激与普通信号");
      }
      return {
        node,
        latex: String.raw`\int_{-\infty}^{\infty}x_1(\tau)x_2(t-\tau)d\tau`,
        frequencyLatex: String.raw`\left[${leftModel.frequencyLatex}\right]\left[${rightModel.frequencyLatex}\right]`,
        spectrum,
        window: windowFor(node),
        pointwise: true,
        numericalSafe: true,
        method,
        leftModel,
        rightModel,
        evaluate
      };
    }
    default: throw new RangeError(`Unknown expression node: ${node.type}`);
  }
}

export function makeLinearCombination(first, second, a = 1, b = 1) {
  return sum([amplitude(a, first), amplitude(b, second)]);
}

export function expressionToJSON(node) {
  return JSON.parse(JSON.stringify(node));
}

export function convolutionAt(first, second, t, options = {}) {
  return buildExpression(convolution(first, second, options)).evaluate(finite(t, "convolution time"));
}
