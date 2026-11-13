import { Complex, ZERO } from "./complex.js";

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
};

export class ContinuousTimeComponent {
  constructor({ evaluate, latex }) {
    if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
    this.kind = "continuous-time";
    this.evaluateFunction = evaluate;
    this.latex = latex;
    Object.freeze(this);
  }

  evaluate(t) {
    return Complex.from(this.evaluateFunction(finite(t, "t")));
  }
}

export class TimeImpulse {
  constructor(position, coefficient, { derivativeOrder = 0, label = null } = {}) {
    if (!Number.isInteger(derivativeOrder) || derivativeOrder < 0) {
      throw new RangeError("derivativeOrder must be a nonnegative integer");
    }
    this.kind = derivativeOrder === 0 ? "time-impulse" : "time-impulse-derivative";
    this.position = finite(position, "impulse position");
    this.coefficient = Complex.from(coefficient);
    this.derivativeOrder = derivativeOrder;
    this.label = label;
    Object.freeze(this);
  }
}

export class TimeImpulseFamily {
  constructor({ generate, latex, derivativeOrder = 0 }) {
    if (typeof generate !== "function") throw new TypeError("generate must be a function");
    this.kind = "time-impulse-family";
    this.generateFunction = generate;
    this.latex = latex;
    this.derivativeOrder = derivativeOrder;
    Object.freeze(this);
  }

  generate(range) {
    const impulses = this.generateFunction(range);
    if (!impulses.every((item) => item instanceof TimeImpulse)) {
      throw new TypeError("Impulse family must generate TimeImpulse values");
    }
    return impulses;
  }
}

export class TimeDistributionTerm {
  constructor({ distributionKind, latex, description }) {
    this.kind = "time-distribution";
    this.distributionKind = distributionKind;
    this.latex = latex;
    this.description = description;
    Object.freeze(this);
  }
}

export class CompositeTimeSignal {
  constructor({ continuous = null, impulses = [], families = [], distributions = [], latex }) {
    if (continuous && !(continuous instanceof ContinuousTimeComponent)) {
      throw new TypeError("continuous must be a ContinuousTimeComponent");
    }
    if (!impulses.every((item) => item instanceof TimeImpulse)) throw new TypeError("Invalid time impulse");
    if (!families.every((item) => item instanceof TimeImpulseFamily)) throw new TypeError("Invalid impulse family");
    if (!distributions.every((item) => item instanceof TimeDistributionTerm)) throw new TypeError("Invalid time distribution");
    this.kind = "composite-time";
    this.continuous = continuous;
    this.impulses = Object.freeze([...impulses]);
    this.families = Object.freeze([...families]);
    this.distributions = Object.freeze([...distributions]);
    this.latex = latex;
    Object.freeze(this);
  }

  evaluateRegular(t) {
    return this.continuous ? this.continuous.evaluate(t) : ZERO;
  }

  impulsesInRange(range) {
    const fixed = this.impulses.filter((item) => item.position >= range.min && item.position <= range.max);
    return [...fixed, ...this.families.flatMap((family) => family.generate(range))];
  }
}
