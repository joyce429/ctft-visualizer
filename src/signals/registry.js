import { SIGNAL_DATABASE } from "../data/generated/signals.generated.js";
import { Complex, J, ONE } from "../math/complex.js";
import {
  CompositeSpectrum,
  ContinuousSpectrum,
  DistributionTerm,
  ImpulseLine,
  ImpulseSpectrum
} from "../math/spectrum.js";

export const sinc = (z) => Math.abs(z) < 1e-8
  ? 1 - z * z / 6 + z ** 4 / 120
  : Math.sin(z) / z;

const definitions = SIGNAL_DATABASE.categories.flatMap((category) => category.signals);
const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

export function listSignalDefinitions() { return [...definitions]; }
export function getSignalDefinition(id) {
  const definition = definitionsById.get(id);
  if (!definition) throw new RangeError(`Unknown signal id: ${id}`);
  return definition;
}

function resolveParameters(definition, overrides) {
  const result = { ...definition.defaultValues, ...overrides };
  for (const parameter of definition.parameters) {
    const value = result[parameter.id];
    if (parameter.type === "integer" && !Number.isInteger(value)) {
      throw new RangeError(`${parameter.id} must be an integer`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${parameter.id} must be a finite number`);
    }
    if (parameter.min !== undefined) {
      if (parameter.exclusiveMin ? value <= parameter.min : value < parameter.min) {
        throw new RangeError(`${parameter.id} is below its allowed range`);
      }
    }
    if (parameter.max !== undefined && value > parameter.max) {
      throw new RangeError(`${parameter.id} is above its allowed range`);
    }
  }
  if (definition.id === "periodic-rectangular-wave" && !(result.T1 < result.T0 / 2)) {
    throw new RangeError("T1 must be less than T0/2");
  }
  return Object.freeze(result);
}

const continuous = (definition, evaluate, specialPoints = []) => new ContinuousSpectrum({
  evaluate,
  latex: definition.frequencyExpressionLatex,
  specialPoints
});

const impulses = (definition, lines, infiniteFamily = null) => new ImpulseSpectrum({
  lines,
  latex: definition.frequencyExpressionLatex,
  infiniteFamily
});

const implementations = {
  unitImpulse: (d) => ({
    timeKind: "distribution",
    evaluateTime: null,
    spectrum: continuous(d, () => ONE)
  }),
  shiftedImpulse: (d, p) => ({
    timeKind: "distribution",
    evaluateTime: null,
    spectrum: continuous(d, (w) => Complex.polar(p.A, -w * p.t0))
  }),
  constant: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: () => new Complex(p.A),
    spectrum: impulses(d, [new ImpulseLine(0, 2 * Math.PI * p.A, "DC")])
  }),
  unitStep: (d) => {
    const pv = new DistributionTerm({
      distributionKind: "principal-value",
      latex: "\\operatorname{PV}(1/(j\\omega))",
      singularities: [0],
      evaluateAway: (w) => new Complex(0, -1 / w)
    });
    return {
      timeKind: "ordinary-with-jump",
      evaluateTime: (t) => new Complex(t < 0 ? 0 : t > 0 ? 1 : 0.5),
      spectrum: new CompositeSpectrum({
        distributions: [pv],
        impulses: impulses(d, [new ImpulseLine(0, Math.PI, "πδ(ω)")]),
        latex: d.frequencyExpressionLatex
      })
    };
  },
  rectangularPulse: (d, p) => ({
    timeKind: "ordinary-with-jumps",
    evaluateTime: (t) => new Complex(Math.abs(t) < p.T / 2 ? p.A : Math.abs(t) === p.T / 2 ? p.A / 2 : 0),
    spectrum: continuous(d, (w) => new Complex(p.A * p.T * sinc(w * p.T / 2)), [0])
  }),
  triangularPulse: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(p.A * Math.max(1 - Math.abs(t) / p.T, 0)),
    spectrum: continuous(d, (w) => new Complex(p.A * p.T * sinc(w * p.T / 2) ** 2), [0])
  }),
  sincSignal: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(p.A * sinc(p.W * t)),
    spectrum: continuous(d, (w) => {
      const abs = Math.abs(w);
      const height = p.A * Math.PI / p.W;
      return new Complex(abs < p.W ? height : abs === p.W ? height / 2 : 0);
    }, [-p.W, p.W])
  }),
  oneSidedExponential: (d, p) => ({
    timeKind: "ordinary-with-jump",
    evaluateTime: (t) => new Complex(t < 0 ? 0 : p.A * Math.exp(-p.a * t)),
    spectrum: continuous(d, (w) => new Complex(p.A).div(new Complex(p.a, w)))
  }),
  twoSidedExponential: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(p.A * Math.exp(-p.a * Math.abs(t))),
    spectrum: continuous(d, (w) => new Complex(2 * p.A * p.a / (p.a ** 2 + w ** 2)))
  }),
  tTimesExponential: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(t < 0 ? 0 : p.A * t * Math.exp(-p.a * t)),
    spectrum: continuous(d, (w) => new Complex(p.A).div(new Complex(p.a, w).mul(new Complex(p.a, w))))
  }),
  complexExponential: (d, p) => ({
    timeKind: "ordinary-complex",
    evaluateTime: (t) => Complex.polar(p.A, p.omega0 * t),
    spectrum: impulses(d, [new ImpulseLine(p.omega0, 2 * Math.PI * p.A, "+ω₀")])
  }),
  cosine: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(p.A * Math.cos(p.omega0 * t)),
    spectrum: impulses(d, [
      new ImpulseLine(-p.omega0, Math.PI * p.A, "−ω₀"),
      new ImpulseLine(p.omega0, Math.PI * p.A, "+ω₀")
    ])
  }),
  sine: (d, p) => ({
    timeKind: "ordinary",
    evaluateTime: (t) => new Complex(p.A * Math.sin(p.omega0 * t)),
    spectrum: impulses(d, [
      new ImpulseLine(-p.omega0, new Complex(0, Math.PI * p.A), "−ω₀"),
      new ImpulseLine(p.omega0, new Complex(0, -Math.PI * p.A), "+ω₀")
    ])
  }),
  periodicRectangularWave: (d, p) => {
    const omega0 = 2 * Math.PI / p.T0;
    const lines = [];
    for (let k = -p.harmonics; k <= p.harmonics; k += 1) {
      const coefficient = k === 0
        ? 2 * p.A * omega0 * p.T1
        : 2 * p.A * Math.sin(k * omega0 * p.T1) / k;
      lines.push(new ImpulseLine(k * omega0, coefficient, `k=${k}`));
    }
    return {
      timeKind: "ordinary-periodic-with-jumps",
      evaluateTime: (t) => {
        const centered = ((t + p.T0 / 2) % p.T0 + p.T0) % p.T0 - p.T0 / 2;
        return new Complex(Math.abs(centered) < p.T1 ? p.A : 0);
      },
      spectrum: impulses(d, lines, { index: "k", from: -Infinity, to: Infinity, displayFrom: -p.harmonics, displayTo: p.harmonics })
    };
  },
  periodicImpulseTrain: (d, p) => {
    const omega0 = 2 * Math.PI / p.T0;
    const lines = [];
    for (let k = -p.harmonics; k <= p.harmonics; k += 1) {
      lines.push(new ImpulseLine(k * omega0, 2 * Math.PI * p.A / p.T0, `k=${k}`));
    }
    return {
      timeKind: "distribution-periodic",
      evaluateTime: null,
      spectrum: impulses(d, lines, { index: "k", from: -Infinity, to: Infinity, displayFrom: -p.harmonics, displayTo: p.harmonics })
    };
  }
};

export function createSignalModel(id, overrides = {}) {
  const definition = getSignalDefinition(id);
  const parameters = resolveParameters(definition, overrides);
  const implementation = implementations[definition.implementationId];
  if (!implementation) throw new Error(`Missing implementation: ${definition.implementationId}`);
  const result = implementation(definition, parameters);
  return Object.freeze({
    id,
    definition,
    parameters,
    timeKind: result.timeKind,
    evaluateTime(t) {
      if (!result.evaluateTime) throw new TypeError(`${id} has no ordinary pointwise time evaluator`);
      if (!Number.isFinite(t)) throw new TypeError("t must be finite");
      return Complex.from(result.evaluateTime(t));
    },
    spectrum: result.spectrum
  });
}
