import { Complex } from "../math/complex.js";
import { CompositeSpectrum, ContinuousSpectrum, ImpulseSpectrum } from "../math/spectrum.js";

export const DEFAULT_SAMPLE_COUNT = 1201;

export function linspace(min, max, count = DEFAULT_SAMPLE_COUNT) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new RangeError("Sampling range must be finite and increasing");
  }
  if (!Number.isInteger(count) || count < 2) throw new RangeError("count must be an integer >= 2");
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + index * step);
}

export function phaseOf(value, epsilon = 1e-10) {
  const z = Complex.from(value);
  return z.abs() <= epsilon ? null : Math.atan2(z.im, z.re);
}

export function phaseInUnit(radians, unit = "rad") {
  if (radians === null) return null;
  return unit === "deg" ? radians * 180 / Math.PI : radians;
}

export function insertPhaseBreaks(points, unit = "rad") {
  const threshold = unit === "deg" ? 170 : 0.95 * Math.PI;
  let previous = null;
  return points.map((point) => {
    const phase = point[4];
    if (phase === null) {
      previous = null;
      return point;
    }
    if (previous !== null && Math.abs(phase - previous) >= threshold) {
      previous = phase;
      return [point[0], null, point[2], point[3], point[4]];
    }
    previous = phase;
    return point;
  });
}

export function unwrapPhasePoints(points, unit = "rad") {
  const fullTurn = unit === "deg" ? 360 : 2 * Math.PI;
  const halfTurn = fullTurn / 2;
  let previous = null;
  let offset = 0;
  return points.map((point) => {
    const phase = point[4];
    if (phase === null) return point;
    let adjusted = phase + offset;
    if (previous !== null) {
      while (adjusted - previous > halfTurn) { offset -= fullTurn; adjusted -= fullTurn; }
      while (adjusted - previous < -halfTurn) { offset += fullTurn; adjusted += fullTurn; }
    }
    previous = adjusted;
    return [point[0], adjusted, point[2], point[3], adjusted];
  });
}

export function sampleTimeSignal(model, range, count = DEFAULT_SAMPLE_COUNT) {
  const x = linspace(range.min, range.max, count);
  if (model.timeRepresentation) {
    const points = model.timeRepresentation.continuous
      ? x.map((t) => {
        const z = model.timeRepresentation.evaluateRegular(t);
        return [t, z.re, z.im];
      })
      : [];
    const impulses = model.timeRepresentation.impulsesInRange(range).map((impulse) => [
      impulse.position, impulse.coefficient.re, impulse.coefficient.re, impulse.coefficient.im,
      phaseOf(impulse.coefficient), impulse.label, impulse.derivativeOrder
    ]);
    return { kind: model.timeKind, points, impulses, distributions: model.timeRepresentation.distributions };
  }
  if (model.timeKind.startsWith("distribution")) return { kind: "distribution", points: [] };
  const points = x.map((t) => {
    const z = model.evaluateTime(t);
    return [t, z.re, z.im];
  });
  return { kind: model.timeKind, points, impulses: [], distributions: [] };
}

function sampleContinuous(spectrum, omegas, phaseUnit, phaseMode) {
  const raw = omegas.map((omega) => {
    const z = spectrum.evaluate(omega);
    const magnitude = z.abs();
    return { omega, z, magnitude };
  });
  const maxMagnitude = Math.max(0, ...raw.map((entry) => entry.magnitude));
  const epsilon = Math.max(1e-12, maxMagnitude * 1e-8);
  const magnitude = raw.map(({ omega, z, magnitude: mag }) => [omega, mag, z.re, z.im, phaseInUnit(phaseOf(z, epsilon), phaseUnit)]);
  const phasePoints = magnitude.map((point) => [point[0], point[4], point[2], point[3], point[4]]);
  const phase = phaseMode === "unwrapped"
    ? unwrapPhasePoints(phasePoints, phaseUnit)
    : insertPhaseBreaks(phasePoints, phaseUnit);
  return { magnitude, phase, maxMagnitude };
}

function sampleDistributions(distributions, omegas, phaseUnit, phaseMode) {
  return distributions.map((term) => {
    const raw = [];
    for (const omega of omegas) {
      const nearSingularity = term.singularities.some((point) => Math.abs(omega - point) < (omegas[1] - omegas[0]) * 1.5);
      if (nearSingularity) {
        raw.push([omega, null, null, null, null]);
        continue;
      }
      const z = term.evaluateAway(omega);
      raw.push([omega, z.abs(), z.re, z.im, phaseInUnit(phaseOf(z), phaseUnit)]);
    }
    return {
      term,
      magnitude: raw,
      phase: phaseMode === "unwrapped"
        ? unwrapPhasePoints(raw.map((point) => [point[0], point[4], point[2], point[3], point[4]]), phaseUnit)
        : insertPhaseBreaks(raw.map((point) => [point[0], point[4], point[2], point[3], point[4]]), phaseUnit)
    };
  });
}

function impulsePoints(spectrum, phaseUnit) {
  return spectrum.lines.map((line) => {
    const phase = phaseInUnit(phaseOf(line.coefficient), phaseUnit);
    return [line.frequency, line.coefficient.abs(), line.coefficient.re, line.coefficient.im, phase, line.label ?? ""];
  });
}

export function sampleSpectrum(spectrum, range, phaseUnit = "rad", count = DEFAULT_SAMPLE_COUNT, phaseMode = "principal") {
  const omegas = linspace(range.min, range.max, count);
  const output = { continuous: null, impulses: [], distributions: [] };
  if (spectrum instanceof ContinuousSpectrum) output.continuous = sampleContinuous(spectrum, omegas, phaseUnit, phaseMode);
  if (spectrum instanceof ImpulseSpectrum) output.impulses = impulsePoints(spectrum, phaseUnit);
  if (spectrum instanceof CompositeSpectrum) {
    if (spectrum.continuous) output.continuous = sampleContinuous(spectrum.continuous, omegas, phaseUnit, phaseMode);
    if (spectrum.impulses) output.impulses = impulsePoints(spectrum.impulses, phaseUnit);
    output.distributions = sampleDistributions(spectrum.distributions, omegas, phaseUnit, phaseMode);
  }
  return output;
}

export function comparisonRanges(sourceModel, operation) {
  const base = defaultRanges(sourceModel);
  const normalize = (a, b) => ({ min: Math.min(a, b), max: Math.max(a, b) });
  let transformedTime = { ...base.time };
  let transformedFrequency = { ...base.frequency };
  if (operation.type === "reverse") {
    transformedTime = normalize(-base.time.max, -base.time.min);
    transformedFrequency = normalize(-base.frequency.max, -base.frequency.min);
  } else if (operation.type === "shift") {
    transformedTime = { min: base.time.min + operation.t0, max: base.time.max + operation.t0 };
  } else if (operation.type === "scale") {
    transformedTime = normalize(base.time.min / operation.a, base.time.max / operation.a);
    transformedFrequency = normalize(base.frequency.min * operation.a, base.frequency.max * operation.a);
  }
  const union = (first, second) => {
    const min = Math.min(first.min, second.min);
    const max = Math.max(first.max, second.max);
    const pad = Math.max((max - min) * 0.06, 1e-6);
    return { min: min - pad, max: max + pad };
  };
  return { time: union(base.time, transformedTime), frequency: union(base.frequency, transformedFrequency) };
}

export function defaultRanges(model) {
  const p = model.parameters;
  const symmetric = (half) => ({ min: -half, max: half });
  switch (model.id) {
    case "rectangular-pulse": return { time: symmetric(1.5 * p.T), frequency: symmetric(6 * Math.PI / p.T) };
    case "triangular-pulse": return { time: symmetric(1.5 * p.T), frequency: symmetric(8 * Math.PI / p.T) };
    case "sinc-signal": return { time: symmetric(6 * Math.PI / p.W), frequency: symmetric(1.6 * p.W) };
    case "one-sided-exponential": return { time: { min: -1 / p.a, max: 6 / p.a }, frequency: symmetric(6 * p.a) };
    case "two-sided-exponential": return { time: symmetric(6 / p.a), frequency: symmetric(6 * p.a) };
    case "t-times-exponential": return { time: { min: -1 / p.a, max: 8 / p.a }, frequency: symmetric(6 * p.a) };
    case "sine":
    case "cosine": return { time: symmetric(2 * 2 * Math.PI / p.omega0), frequency: symmetric(1.6 * p.omega0) };
    case "complex-exponential": {
      const frequency = Math.max(Math.abs(p.omega0), 1);
      return { time: symmetric(2 * 2 * Math.PI / frequency), frequency: symmetric(1.6 * frequency) };
    }
    case "periodic-rectangular-wave": return { time: symmetric(1.5 * p.T0), frequency: symmetric((p.harmonics + 1) * 2 * Math.PI / p.T0) };
    case "periodic-impulse-train": return { time: symmetric(1.5 * p.T0), frequency: symmetric((p.harmonics + 1) * 2 * Math.PI / p.T0) };
    case "shifted-impulse": return { time: { min: p.t0 - 5, max: p.t0 + 5 }, frequency: symmetric(12) };
    default: return { time: symmetric(5), frequency: symmetric(12) };
  }
}
