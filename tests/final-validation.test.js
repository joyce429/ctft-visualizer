import test from "node:test";
import assert from "node:assert/strict";
import { Complex } from "../src/math/complex.js";
import { asComposite, ContinuousSpectrum } from "../src/math/spectrum.js";
import { createSignalModel, listSignalDefinitions } from "../src/signals/registry.js";
import { defaultRanges, phaseOf, sampleSpectrum } from "../src/plotting/sampling.js";
import { createTransformOperation, getTransformSupport, transformSignalModel } from "../src/transforms/signal-transform.js";

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Complex.from(actual).equals(expected, tolerance), `${JSON.stringify(Complex.from(actual))} != ${JSON.stringify(Complex.from(expected))}`);
};

const continuousOf = (spectrum) => spectrum instanceof ContinuousSpectrum ? spectrum : spectrum.continuous;

test("all 15 signals satisfy representative time-domain definitions", () => {
  const cases = [
    ["constant", { A: -2 }, [[-3, -2], [2, -2]]],
    ["unit-step", {}, [[-1, 0], [0, 0.5], [2, 1]]],
    ["rectangular-pulse", { A: 2, T: 4 }, [[-3, 0], [-2, 1], [0, 2], [2, 1], [3, 0]]],
    ["triangular-pulse", { A: 2, T: 2 }, [[-2, 0], [-1, 1], [0, 2], [1, 1], [2, 0]]],
    ["sinc-signal", { A: 2, W: 3 }, [[0, 2], [Math.PI / 3, 0]]],
    ["one-sided-exponential", { A: 2, a: 3 }, [[-1, 0], [0, 2], [1, 2 * Math.exp(-3)]]],
    ["two-sided-exponential", { A: 2, a: 3 }, [[-1, 2 * Math.exp(-3)], [0, 2], [1, 2 * Math.exp(-3)]]],
    ["t-times-exponential", { A: 2, a: 3 }, [[-1, 0], [0, 0], [1, 2 * Math.exp(-3)]]],
    ["complex-exponential", { A: 2, omega0: 3 }, [[0, new Complex(2, 0)], [Math.PI / 6, new Complex(0, 2)]]],
    ["cosine", { A: 2, omega0: 3 }, [[0, 2], [Math.PI / 3, -2]]],
    ["sine", { A: 2, omega0: 3 }, [[0, 0], [Math.PI / 6, 2]]],
    ["periodic-rectangular-wave", { A: 2, T0: 4, T1: 1, harmonics: 4 }, [[0, 2], [1.5, 0], [4, 2]]]
  ];
  for (const [id, parameters, points] of cases) {
    const model = createSignalModel(id, parameters);
    for (const [t, expected] of points) close(model.evaluateTime(t), expected);
  }
  assert.throws(() => createSignalModel("unit-impulse").evaluateTime(0), /no ordinary/);
  assert.throws(() => createSignalModel("shifted-impulse").evaluateTime(1), /no ordinary/);
  assert.throws(() => createSignalModel("periodic-impulse-train").evaluateTime(0), /no ordinary/);
});

test("all continuous transform pairs match independent closed-form checkpoints", () => {
  const checks = [
    ["unit-impulse", {}, 2.3, 1],
    ["shifted-impulse", { A: 2, t0: 0.5 }, Math.PI, new Complex(0, -2)],
    ["rectangular-pulse", { A: 2, T: 3 }, 0, 6],
    ["rectangular-pulse", { A: 2, T: 3 }, 2 * Math.PI / 3, 0],
    ["triangular-pulse", { A: 2, T: 3 }, 0, 6],
    ["triangular-pulse", { A: 2, T: 3 }, 2 * Math.PI / 3, 0],
    ["sinc-signal", { A: 2, W: 4 }, 0, Math.PI / 2],
    ["sinc-signal", { A: 2, W: 4 }, 4, Math.PI / 4],
    ["one-sided-exponential", { A: 2, a: 3 }, 4, new Complex(0.24, -0.32)],
    ["two-sided-exponential", { A: 2, a: 3 }, -4, 12 / 25],
    ["t-times-exponential", { A: 1, a: 1 }, 1, new Complex(0, -0.5)]
  ];
  for (const [id, parameters, omega, expected] of checks) close(createSignalModel(id, parameters).spectrum.evaluate(omega), expected);
});

test("all impulse and distribution spectra preserve exact positions and coefficients", () => {
  const constant = createSignalModel("constant", { A: 3 }).spectrum;
  assert.deepEqual(constant.lines.map((line) => [line.frequency, line.coefficient.re]), [[0, 6 * Math.PI]]);
  const exponential = createSignalModel("complex-exponential", { A: 2, omega0: -5 }).spectrum;
  assert.deepEqual(exponential.lines.map((line) => [line.frequency, line.coefficient.re]), [[-5, 4 * Math.PI]]);
  const cosine = createSignalModel("cosine", { A: 2, omega0: 5 }).spectrum;
  assert.deepEqual(cosine.lines.map((line) => [line.frequency, line.coefficient.re]), [[-5, 2 * Math.PI], [5, 2 * Math.PI]]);
  const sine = createSignalModel("sine", { A: 2, omega0: 5 }).spectrum;
  close(sine.lines[0].coefficient, new Complex(0, 2 * Math.PI));
  close(sine.lines[1].coefficient, new Complex(0, -2 * Math.PI));
  const square = createSignalModel("periodic-rectangular-wave", { A: 1, T0: 4, T1: 1, harmonics: 2 }).spectrum;
  close(square.lines.find((line) => line.frequency === 0).coefficient, Math.PI);
  const train = createSignalModel("periodic-impulse-train", { A: 2, T0: 4, harmonics: 2 }).spectrum;
  train.lines.forEach((line) => close(line.coefficient, Math.PI));
  const step = createSignalModel("unit-step").spectrum;
  assert.equal(step.distributions[0].latex, "\\operatorname{PV}(1/(j\\omega))");
  close(step.distributions[0].evaluateAway(-2), new Complex(0, 0.5));
  close(step.impulses.lines[0].coefficient, Math.PI);
});

test("reversal, shift, and positive/negative scaling hold for every database spectrum type", () => {
  const frequencies = [-2.3, -0.7, 0.9, 2.1];
  for (const definition of listSignalDefinitions()) {
    const source = createSignalModel(definition.id);
    const input = asComposite(source.spectrum);
    const operations = [createTransformOperation("reverse"), createTransformOperation("shift", 0.7), createTransformOperation("scale", 1.8), createTransformOperation("scale", -1.4)];
    for (const operation of operations) {
      const output = asComposite(transformSignalModel(source, operation).spectrum);
      if (input.continuous) {
        for (const omega of frequencies) {
          const expected = operation.type === "reverse" ? input.continuous.evaluate(-omega)
            : operation.type === "shift" ? input.continuous.evaluate(omega).mul(Complex.polar(1, -omega * operation.t0))
              : input.continuous.evaluate(omega / operation.a).scale(1 / Math.abs(operation.a));
          close(output.continuous.evaluate(omega), expected);
        }
      }
      if (input.impulses) {
        assert.equal(output.impulses.lines.length, input.impulses.lines.length);
        input.impulses.lines.forEach((line, index) => {
          const actual = output.impulses.lines[index];
          const expectedFrequency = operation.type === "reverse" ? -line.frequency : operation.type === "scale" ? operation.a * line.frequency : line.frequency;
          const expectedCoefficient = operation.type === "shift" ? line.coefficient.mul(Complex.polar(1, -line.frequency * operation.t0)) : line.coefficient;
          close(actual.frequency, expectedFrequency);
          close(actual.coefficient, expectedCoefficient);
        });
      }
      input.distributions.forEach((term, index) => {
        for (const omega of frequencies) {
          const expected = operation.type === "reverse" ? term.evaluateAway(-omega)
            : operation.type === "shift" ? term.evaluateAway(omega).mul(Complex.polar(1, -omega * operation.t0))
              : term.evaluateAway(omega / operation.a).scale(1 / Math.abs(operation.a));
          close(output.distributions[index].evaluateAway(omega), expected);
        }
      });
    }
  }
});

test("differentiation is defined for all 15 signals and obeys jωX away from singularities", () => {
  for (const definition of listSignalDefinitions()) {
    const source = createSignalModel(definition.id);
    const result = transformSignalModel(source, createTransformOperation("differentiate"));
    assert.equal(result.supported, true, definition.id);
    const input = asComposite(source.spectrum);
    const output = asComposite(result.spectrum);
    if (definition.id === "constant") {
      close(output.continuous.evaluate(2), 0);
      continue;
    }
    if (definition.id === "unit-step") {
      close(output.continuous.evaluate(2), 1);
      continue;
    }
    if (input.continuous) {
      for (const omega of [-2, 0, 1.5]) close(output.continuous.evaluate(omega), input.continuous.evaluate(omega).mul(new Complex(0, omega)));
    }
    if (input.impulses) input.impulses.lines.forEach((line, index) => close(output.impulses.lines[index].coefficient, line.coefficient.mul(new Complex(0, line.frequency))));
  }
});

test("integration support matrix is explicit and every enabled case keeps PV and πX(0)δ", () => {
  const enabled = new Set(["unit-impulse", "shifted-impulse", "rectangular-pulse", "triangular-pulse", "one-sided-exponential", "two-sided-exponential", "t-times-exponential"]);
  for (const definition of listSignalDefinitions()) {
    const source = createSignalModel(definition.id);
    const support = getTransformSupport(source, createTransformOperation("integrate"));
    assert.equal(support.supported, enabled.has(definition.id), definition.id);
    const result = transformSignalModel(source, createTransformOperation("integrate"));
    if (!enabled.has(definition.id)) {
      assert.equal(result.supported, false);
      assert.ok(result.supportReason.length > 10);
      continue;
    }
    const x0 = source.spectrum.evaluate(0);
    close(result.spectrum.impulses.lines[0].coefficient, x0.scale(Math.PI));
    for (const omega of [-2, 1.3]) close(result.spectrum.distributions[0].evaluateAway(omega), source.spectrum.evaluate(omega).div(new Complex(0, omega)));
  }
});

test("magnitude and phase sampling never emit NaN or Infinity for any signal", () => {
  for (const definition of listSignalDefinitions()) {
    const model = createSignalModel(definition.id);
    const range = defaultRanges(model).frequency;
    const sampled = sampleSpectrum(model.spectrum, range, "rad", 301);
    const pointSets = [sampled.continuous?.magnitude ?? [], sampled.continuous?.phase ?? [], ...sampled.distributions.flatMap((item) => [item.magnitude, item.phase]), sampled.impulses];
    for (const point of pointSets.flat()) {
      for (const value of point.slice(0, 5)) assert.ok(value === null || Number.isFinite(value), `${definition.id} emitted ${value}`);
    }
    for (const point of sampled.continuous?.magnitude ?? []) if (point[1] === 0) assert.equal(point[4], null);
    for (const point of sampled.impulses) {
      const expectedPhase = phaseOf(new Complex(point[2], point[3]));
      if (expectedPhase === null) assert.equal(point[4], null);
      else close(point[4], expectedPhase);
    }
  }
});

test("all declared default values and UI parameter ranges create finite models", () => {
  for (const definition of listSignalDefinitions()) {
    assert.doesNotThrow(() => createSignalModel(definition.id, definition.defaultValues));
    for (const parameter of definition.parameters) {
      assert.equal(definition.defaultValues[parameter.id], parameter.default);
      assert.ok(parameter.step > 0);
      assert.ok(parameter.min <= parameter.default && parameter.default <= parameter.max);
    }
  }
});
