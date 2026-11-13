import { Complex, ZERO } from "./complex.js";

const requireFinite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
};

export class ContinuousSpectrum {
  constructor({ evaluate, latex, specialPoints = [] }) {
    if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
    this.kind = "continuous";
    this.evaluateFunction = evaluate;
    this.latex = latex;
    this.specialPoints = Object.freeze([...specialPoints]);
    Object.freeze(this);
  }

  evaluate(omega) {
    return Complex.from(this.evaluateFunction(requireFinite(omega, "omega")));
  }
}

export class ImpulseLine {
  constructor(frequency, coefficient, label = null) {
    this.frequency = requireFinite(frequency, "impulse frequency");
    this.coefficient = Complex.from(coefficient);
    this.label = label;
    Object.freeze(this);
  }
}

export class ImpulseSpectrum {
  constructor({ lines, latex, infiniteFamily = null }) {
    this.kind = "impulse";
    this.lines = Object.freeze(lines.map((line) => line instanceof ImpulseLine
      ? line
      : new ImpulseLine(line.frequency, line.coefficient, line.label)));
    this.latex = latex;
    this.infiniteFamily = infiniteFamily ? Object.freeze({ ...infiniteFamily }) : null;
    Object.freeze(this);
  }
}

export class DistributionTerm {
  constructor({ distributionKind, latex, singularities = [], evaluateAway = null, order = null, frequency = null, coefficient = null }) {
    if (!distributionKind || !latex) throw new TypeError("Distribution kind and LaTeX are required");
    this.kind = "distribution";
    this.distributionKind = distributionKind;
    this.latex = latex;
    this.singularities = Object.freeze(singularities.map((x) => requireFinite(x, "singularity")));
    this.evaluateAwayFunction = evaluateAway;
    this.order = order;
    this.frequency = frequency === null ? null : requireFinite(frequency, "distribution frequency");
    this.coefficient = coefficient === null ? null : Complex.from(coefficient);
    Object.freeze(this);
  }

  evaluateAway(omega) {
    const value = requireFinite(omega, "omega");
    if (this.singularities.includes(value)) {
      throw new RangeError("Distribution is not pointwise-defined at this frequency");
    }
    if (!this.evaluateAwayFunction) {
      throw new TypeError("This symbolic distribution has no pointwise evaluator");
    }
    return Complex.from(this.evaluateAwayFunction(value));
  }
}

export class CompositeSpectrum {
  constructor({ continuous = null, impulses = null, distributions = [], latex = null }) {
    if (continuous && !(continuous instanceof ContinuousSpectrum)) {
      throw new TypeError("continuous must be a ContinuousSpectrum");
    }
    if (impulses && !(impulses instanceof ImpulseSpectrum)) {
      throw new TypeError("impulses must be an ImpulseSpectrum");
    }
    if (!distributions.every((term) => term instanceof DistributionTerm)) {
      throw new TypeError("distributions must contain DistributionTerm values");
    }
    this.kind = "composite";
    this.continuous = continuous;
    this.impulses = impulses;
    this.distributions = Object.freeze([...distributions]);
    this.latex = latex;
    Object.freeze(this);
  }

  regularValueAt(omega) {
    let result = this.continuous ? this.continuous.evaluate(omega) : ZERO;
    for (const term of this.distributions) result = result.add(term.evaluateAway(omega));
    return result;
  }
}

export function asComposite(spectrum) {
  if (spectrum instanceof CompositeSpectrum) return spectrum;
  if (spectrum instanceof ContinuousSpectrum) return new CompositeSpectrum({ continuous: spectrum, latex: spectrum.latex });
  if (spectrum instanceof ImpulseSpectrum) return new CompositeSpectrum({ impulses: spectrum, latex: spectrum.latex });
  throw new TypeError("Unknown spectrum model");
}
