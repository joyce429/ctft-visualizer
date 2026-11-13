import { Complex, J } from "../math/complex.js";
import {
  asComposite,
  CompositeSpectrum,
  ContinuousSpectrum,
  DistributionTerm,
  ImpulseLine,
  ImpulseSpectrum
} from "../math/spectrum.js";

const mapComposite = (source, { continuous, impulseLine, distribution, latex }) => {
  const input = asComposite(source);
  return new CompositeSpectrum({
    continuous: input.continuous ? continuous(input.continuous) : null,
    impulses: input.impulses ? new ImpulseSpectrum({
      lines: input.impulses.lines.map(impulseLine),
      latex,
      infiniteFamily: input.impulses.infiniteFamily
    }) : null,
    distributions: input.distributions.map(distribution),
    latex
  });
};

export function timeShift(source, t0) {
  if (!Number.isFinite(t0)) throw new TypeError("t0 must be finite");
  const latex = `e^{-j\\omega(${t0})}X(j\\omega)`;
  return mapComposite(source, {
    latex,
    continuous: (s) => new ContinuousSpectrum({
      latex,
      specialPoints: s.specialPoints,
      evaluate: (w) => s.evaluate(w).mul(Complex.polar(1, -w * t0))
    }),
    impulseLine: (line) => new ImpulseLine(line.frequency, line.coefficient.mul(Complex.polar(1, -line.frequency * t0)), line.label),
    distribution: (term) => new DistributionTerm({
      distributionKind: term.distributionKind,
      latex: `e^{-j\\omega(${t0})}[${term.latex}]`,
      singularities: term.singularities,
      evaluateAway: (w) => term.evaluateAway(w).mul(Complex.polar(1, -w * t0))
    })
  });
}

export function timeReverse(source) {
  const latex = "X(-j\\omega)";
  return mapComposite(source, {
    latex,
    continuous: (s) => new ContinuousSpectrum({
      latex,
      specialPoints: s.specialPoints.map((point) => -point),
      evaluate: (w) => s.evaluate(-w)
    }),
    impulseLine: (line) => new ImpulseLine(-line.frequency, line.coefficient, line.label),
    distribution: (term) => new DistributionTerm({
      distributionKind: term.distributionKind,
      latex: `[${term.latex}]_{\\omega\\mapsto-\\omega}`,
      singularities: term.singularities.map((point) => -point),
      evaluateAway: (w) => term.evaluateAway(-w)
    })
  });
}

export function timeScale(source, a) {
  if (!Number.isFinite(a) || a === 0) throw new RangeError("Scale a must be finite and nonzero");
  const factor = Math.abs(a);
  const latex = `\\frac{1}{|${a}|}X(j\\omega/${a})`;
  return mapComposite(source, {
    latex,
    continuous: (s) => new ContinuousSpectrum({
      latex,
      specialPoints: s.specialPoints.map((point) => a * point),
      evaluate: (w) => s.evaluate(w / a).scale(1 / factor)
    }),
    impulseLine: (line) => new ImpulseLine(a * line.frequency, line.coefficient, line.label),
    distribution: (term) => new DistributionTerm({
      distributionKind: term.distributionKind,
      latex: `\\frac{1}{|${a}|}[${term.latex}]_{\\omega\\mapsto\\omega/${a}}`,
      singularities: term.singularities.map((point) => a * point),
      evaluateAway: (w) => term.evaluateAway(w / a).scale(1 / factor)
    })
  });
}

export function differentiateInTime(source) {
  const latex = "j\\omega X(j\\omega)";
  return mapComposite(source, {
    latex,
    continuous: (s) => new ContinuousSpectrum({
      latex,
      specialPoints: s.specialPoints,
      evaluate: (w) => s.evaluate(w).mul(J.scale(w))
    }),
    impulseLine: (line) => new ImpulseLine(line.frequency, line.coefficient.mul(J.scale(line.frequency)), line.label),
    distribution: (term) => new DistributionTerm({
      distributionKind: "symbolic-product",
      latex: `j\\omega[${term.latex}]`,
      singularities: term.singularities,
      evaluateAway: (w) => term.evaluateAway(w).mul(J.scale(w))
    })
  });
}

export function integrateFromNegativeInfinity(source) {
  const input = asComposite(source);
  if (!input.continuous || input.impulses || input.distributions.length > 0) {
    throw new TypeError("Integration currently requires a finite ordinary continuous spectrum at ω=0");
  }
  const x0 = input.continuous.evaluate(0);
  const pv = new DistributionTerm({
    distributionKind: "principal-value",
    latex: "\\operatorname{PV}[X(j\\omega)/(j\\omega)]",
    singularities: [0],
    evaluateAway: (w) => input.continuous.evaluate(w).div(J.scale(w))
  });
  const impulse = new ImpulseSpectrum({
    lines: [new ImpulseLine(0, x0.scale(Math.PI), "πX(0)δ(ω)")],
    latex: "\\pi X(0)\\delta(\\omega)"
  });
  return new CompositeSpectrum({
    impulses: impulse,
    distributions: [pv],
    latex: "\\operatorname{PV}[X(j\\omega)/(j\\omega)]+\\pi X(0)\\delta(\\omega)"
  });
}
