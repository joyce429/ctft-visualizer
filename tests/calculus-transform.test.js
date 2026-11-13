import test from "node:test";
import assert from "node:assert/strict";
import { createSignalModel } from "../src/signals/registry.js";
import { CompositeSpectrum, ContinuousSpectrum } from "../src/math/spectrum.js";
import { createTransformOperation, transformSignalModel } from "../src/transforms/signal-transform.js";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const calculus = (id, parameters, type) => transformSignalModel(createSignalModel(id, parameters), createTransformOperation(type));
const continuousPart = (spectrum) => spectrum instanceof ContinuousSpectrum ? spectrum : spectrum.continuous;

test("unit step differentiates analytically to a unit impulse and flat spectrum", () => {
  const result = calculus("unit-step", {}, "differentiate");
  assert.equal(result.supported, true);
  assert.equal(result.timeRepresentation.impulses.length, 1);
  assert.equal(result.timeRepresentation.impulses[0].position, 0);
  close(result.timeRepresentation.impulses[0].coefficient.re, 1);
  assert.ok(result.spectrum instanceof ContinuousSpectrum);
  close(result.spectrum.evaluate(-7).re, 1);
  close(result.spectrum.evaluate(0).re, 1);
});

test("rectangular pulse derivative has opposite signed edge impulses", () => {
  const result = calculus("rectangular-pulse", { A: 2, T: 4 }, "differentiate");
  const [left, right] = result.timeRepresentation.impulses;
  close(left.position, -2); close(left.coefficient.re, 2);
  close(right.position, 2); close(right.coefficient.re, -2);
  const source = createSignalModel("rectangular-pulse", { A: 2, T: 4 });
  for (const omega of [-3.2, -0.7, 0, 1.4]) {
    const expected = source.spectrum.evaluate(omega).mul({ re: 0, im: omega });
    const actual = continuousPart(result.spectrum).evaluate(omega);
    close(actual.re, expected.re); close(actual.im, expected.im);
  }
});

test("one-sided exponential derivative separates jump impulse from regular derivative", () => {
  const result = calculus("one-sided-exponential", { A: 3, a: 2 }, "differentiate");
  close(result.timeRepresentation.impulses[0].coefficient.re, 3);
  close(result.timeRepresentation.evaluateRegular(-1).re, 0);
  close(result.timeRepresentation.evaluateRegular(1).re, -6 * Math.exp(-2));
  const source = createSignalModel("one-sided-exponential", { A: 3, a: 2 });
  for (const omega of [-4, 0, 2.5]) {
    const expected = source.spectrum.evaluate(omega).mul({ re: 0, im: omega });
    const actual = continuousPart(result.spectrum).evaluate(omega);
    close(actual.re, expected.re); close(actual.im, expected.im);
  }
});

test("impulse derivative keeps δ-prime metadata and jω spectrum", () => {
  const result = calculus("unit-impulse", {}, "differentiate");
  assert.equal(result.timeRepresentation.impulses[0].derivativeOrder, 1);
  close(continuousPart(result.spectrum).evaluate(-3).im, -3);
  close(continuousPart(result.spectrum).evaluate(0).abs(), 0);
});

test("rectangular pulse integral is piecewise linear with PV and πX(0)δ", () => {
  const result = calculus("rectangular-pulse", { A: 2, T: 4 }, "integrate");
  close(result.evaluateTime(-3).re, 0);
  close(result.evaluateTime(0).re, 4);
  close(result.evaluateTime(3).re, 8);
  assert.ok(result.spectrum instanceof CompositeSpectrum);
  assert.equal(result.spectrum.distributions[0].distributionKind, "principal-value");
  close(result.spectrum.impulses.lines[0].coefficient.re, 8 * Math.PI);
  const omega = 1.3;
  const x = createSignalModel("rectangular-pulse", { A: 2, T: 4 }).spectrum.evaluate(omega);
  const pv = result.spectrum.distributions[0].evaluateAway(omega);
  const expected = x.div({ re: 0, im: omega });
  close(pv.re, expected.re); close(pv.im, expected.im);
});

test("one-sided exponential integral saturates and preserves the zero-frequency impulse", () => {
  const result = calculus("one-sided-exponential", { A: 3, a: 2 }, "integrate");
  close(result.evaluateTime(-1).re, 0);
  close(result.evaluateTime(1).re, 1.5 * (1 - Math.exp(-2)));
  close(result.evaluateTime(100).re, 1.5, 1e-8);
  close(result.spectrum.impulses.lines[0].coefficient.re, 1.5 * Math.PI);
});

test("divergent or higher-distribution integrations are explicitly disabled", () => {
  for (const [id, parameters] of [["constant", { A: 1 }], ["unit-step", {}], ["sine", { A: 1, omega0: 2 }]]) {
    const result = calculus(id, parameters, "integrate");
    assert.equal(result.supported, false);
    assert.ok(result.supportReason.length > 10);
  }
});

test("calculus results update when source parameters change", () => {
  const first = calculus("rectangular-pulse", { A: 1, T: 2 }, "integrate");
  const second = calculus("rectangular-pulse", { A: 3, T: 4 }, "integrate");
  close(first.evaluateTime(5).re, 2);
  close(second.evaluateTime(5).re, 12);
  close(first.spectrum.impulses.lines[0].coefficient.re, 2 * Math.PI);
  close(second.spectrum.impulses.lines[0].coefficient.re, 12 * Math.PI);
});
