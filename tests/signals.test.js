import test from "node:test";
import assert from "node:assert/strict";
import { Complex } from "../src/math/complex.js";
import { CompositeSpectrum, ContinuousSpectrum, ImpulseSpectrum } from "../src/math/spectrum.js";
import { createSignalModel, listSignalDefinitions } from "../src/signals/registry.js";

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Complex.from(actual).equals(expected, tolerance),
    `expected ${JSON.stringify(Complex.from(expected))}, got ${JSON.stringify(Complex.from(actual))}`);
};

test("all 15 database records have executable implementations", () => {
  for (const definition of listSignalDefinitions()) {
    assert.doesNotThrow(() => createSignalModel(definition.id));
  }
});

test("impulse pairs and 2π DC coefficient are correct", () => {
  close(createSignalModel("unit-impulse").spectrum.evaluate(123), 1);
  close(createSignalModel("shifted-impulse", { A: 2, t0: 0.5 }).spectrum.evaluate(Math.PI), new Complex(0, -2));
  const constant = createSignalModel("constant", { A: 3 }).spectrum;
  assert.ok(constant instanceof ImpulseSpectrum);
  assert.equal(constant.lines[0].frequency, 0);
  close(constant.lines[0].coefficient, 6 * Math.PI);
});

test("unit step keeps PV and impulse components separate", () => {
  const spectrum = createSignalModel("unit-step").spectrum;
  assert.ok(spectrum instanceof CompositeSpectrum);
  assert.equal(spectrum.distributions[0].distributionKind, "principal-value");
  close(spectrum.distributions[0].evaluateAway(2), new Complex(0, -0.5));
  assert.throws(() => spectrum.distributions[0].evaluateAway(0), /not pointwise-defined/);
  close(spectrum.impulses.lines[0].coefficient, Math.PI);
});

test("pulse transforms use removable zero-frequency limits", () => {
  const rectangle = createSignalModel("rectangular-pulse", { A: 2, T: 3 }).spectrum;
  const triangle = createSignalModel("triangular-pulse", { A: 2, T: 3 }).spectrum;
  assert.ok(rectangle instanceof ContinuousSpectrum);
  close(rectangle.evaluate(0), 6);
  close(rectangle.evaluate(2 * Math.PI / 3), 0, 1e-9);
  close(triangle.evaluate(0), 6);
  assert.ok(triangle.evaluate(1).re >= 0);
});

test("exponential transform pairs match direct formulas at positive and negative frequencies", () => {
  const one = createSignalModel("one-sided-exponential", { A: 2, a: 3 }).spectrum;
  close(one.evaluate(4), new Complex(0.24, -0.32));
  close(one.evaluate(-4), new Complex(0.24, 0.32));
  const two = createSignalModel("two-sided-exponential", { A: 2, a: 3 }).spectrum;
  close(two.evaluate(4), 12 / 25);
  close(two.evaluate(-4), 12 / 25);
  const weighted = createSignalModel("t-times-exponential", { A: 1, a: 1 }).spectrum;
  close(weighted.evaluate(1), new Complex(0, -0.5));
});

test("sinusoidal line locations and complex weights preserve signs", () => {
  const cosine = createSignalModel("cosine", { A: 2, omega0: 5 }).spectrum;
  assert.deepEqual(cosine.lines.map((line) => line.frequency), [-5, 5]);
  cosine.lines.forEach((line) => close(line.coefficient, 2 * Math.PI));
  const sine = createSignalModel("sine", { A: 2, omega0: 5 }).spectrum;
  close(sine.lines[0].coefficient, new Complex(0, 2 * Math.PI));
  close(sine.lines[1].coefficient, new Complex(0, -2 * Math.PI));
  const exponential = createSignalModel("complex-exponential", { A: 2, omega0: -5 }).spectrum;
  assert.equal(exponential.lines[0].frequency, -5);
  close(exponential.lines[0].coefficient, 4 * Math.PI);
});

test("sinc convention and symmetric band-edge values are explicit", () => {
  const model = createSignalModel("sinc-signal", { A: 2, W: 4 });
  close(model.evaluateTime(0), 2);
  close(model.spectrum.evaluate(0), Math.PI / 2);
  close(model.spectrum.evaluate(4), Math.PI / 4);
  close(model.spectrum.evaluate(4.001), 0);
});

test("periodic extension records create correct finite display windows", () => {
  const square = createSignalModel("periodic-rectangular-wave", { A: 1, T0: 4, T1: 1, harmonics: 2 }).spectrum;
  assert.equal(square.lines.length, 5);
  close(square.lines.find((line) => line.frequency === 0).coefficient, Math.PI);
  const train = createSignalModel("periodic-impulse-train", { A: 2, T0: 4, harmonics: 2 }).spectrum;
  assert.equal(train.lines.length, 5);
  train.lines.forEach((line) => close(line.coefficient, Math.PI));
});

test("parameter and cross-parameter constraints reject invalid models", () => {
  assert.throws(() => createSignalModel("one-sided-exponential", { a: 0 }), /allowed range/);
  assert.throws(() => createSignalModel("periodic-impulse-train", { harmonics: 2.5 }), /integer/);
  assert.throws(() => createSignalModel("periodic-rectangular-wave", { T0: 4, T1: 2 }), /T1 must/);
});
