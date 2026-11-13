import test from "node:test";
import assert from "node:assert/strict";
import { Complex } from "../src/math/complex.js";
import { createSignalModel } from "../src/signals/registry.js";
import {
  differentiateInTime,
  integrateFromNegativeInfinity,
  timeReverse,
  timeScale,
  timeShift
} from "../src/transforms/properties.js";

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Complex.from(actual).equals(expected, tolerance));

test("time shift phases impulse lines at their own signed frequencies", () => {
  const shifted = timeShift(createSignalModel("cosine", { A: 1, omega0: 2 }).spectrum, Math.PI / 4);
  const [negative, positive] = shifted.impulses.lines;
  close(negative.coefficient, new Complex(0, Math.PI));
  close(positive.coefficient, new Complex(0, -Math.PI));
});

test("time reversal mirrors signed line locations without losing coefficients", () => {
  const source = createSignalModel("sine", { A: 1, omega0: 3 }).spectrum;
  const reversed = timeReverse(source);
  assert.deepEqual(reversed.impulses.lines.map((line) => line.frequency), [3, -3]);
  close(reversed.impulses.lines[0].coefficient, new Complex(0, Math.PI));
});

test("time scaling applies 1/|a| to continuous spectra and moves line locations", () => {
  const rectangle = createSignalModel("rectangular-pulse", { A: 2, T: 3 }).spectrum;
  close(timeScale(rectangle, 2).continuous.evaluate(0), 3);
  close(timeScale(rectangle, -2).continuous.evaluate(0), 3);
  const line = timeScale(createSignalModel("complex-exponential", { omega0: 3 }).spectrum, -2).impulses.lines[0];
  assert.equal(line.frequency, -6);
  close(line.coefficient, 2 * Math.PI);
});

test("differentiation multiplies ordinary and impulse components by jω", () => {
  const exponential = createSignalModel("one-sided-exponential", { A: 1, a: 2 }).spectrum;
  close(differentiateInTime(exponential).continuous.evaluate(3), exponential.evaluate(3).mul(new Complex(0, 3)));
  const dcDerivative = differentiateInTime(createSignalModel("constant", { A: 4 }).spectrum);
  close(dcDerivative.impulses.lines[0].coefficient, 0);
});

test("integration of unit impulse spectrum reproduces step distribution coefficients", () => {
  const integrated = integrateFromNegativeInfinity(createSignalModel("unit-impulse").spectrum);
  close(integrated.impulses.lines[0].coefficient, Math.PI);
  close(integrated.distributions[0].evaluateAway(2), new Complex(0, -0.5));
  assert.equal(integrated.distributions[0].distributionKind, "principal-value");
});

test("integration refuses spectra already containing singular distributions", () => {
  assert.throws(() => integrateFromNegativeInfinity(createSignalModel("unit-step").spectrum), /requires/);
});
