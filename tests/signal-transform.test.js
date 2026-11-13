import test from "node:test";
import assert from "node:assert/strict";
import { Complex } from "../src/math/complex.js";
import { createSignalModel } from "../src/signals/registry.js";
import {
  applyTransformQueue,
  createTransformOperation,
  mapTimeImpulse,
  transformSignalModel
} from "../src/transforms/signal-transform.js";

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Complex.from(actual).equals(expected, tolerance), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};

test("time reversal evaluates x(-t) and mirrors a one-sided exponential", () => {
  const source = createSignalModel("one-sided-exponential", { A: 1, a: 1 });
  const reversed = transformSignalModel(source, createTransformOperation("reverse"));
  close(reversed.evaluateTime(-1), Math.exp(-1));
  close(reversed.evaluateTime(1), 0);
  close(reversed.spectrum.continuous.evaluate(2), source.spectrum.evaluate(-2));
});

test("time shift moves the waveform right and applies the negative phase factor", () => {
  const source = createSignalModel("one-sided-exponential", { A: 1, a: 1 });
  const shifted = transformSignalModel(source, createTransformOperation("shift", 2));
  close(shifted.evaluateTime(1), 0);
  close(shifted.evaluateTime(3), Math.exp(-1));
  const expected = source.spectrum.evaluate(1).mul(Complex.polar(1, -2));
  close(shifted.spectrum.continuous.evaluate(1), expected);
  close(shifted.spectrum.continuous.evaluate(1).abs(), source.spectrum.evaluate(1).abs());
});

test("negative time scaling combines reversal with 1/|a| spectral scaling", () => {
  const source = createSignalModel("one-sided-exponential", { A: 1, a: 1 });
  const scaled = transformSignalModel(source, createTransformOperation("scale", -2));
  close(scaled.evaluateTime(-1), Math.exp(-2));
  close(scaled.evaluateTime(1), 0);
  close(scaled.spectrum.continuous.evaluate(0), 0.5);
  close(scaled.spectrum.continuous.evaluate(4), source.spectrum.evaluate(-2).scale(0.5));
});

test("time-domain impulse positions and weights follow distribution scaling", () => {
  assert.deepEqual(mapTimeImpulse(3, 2, createTransformOperation("reverse")), { position: -3, coefficient: 2 });
  assert.deepEqual(mapTimeImpulse(3, 2, createTransformOperation("shift", -1)), { position: 2, coefficient: 2 });
  assert.deepEqual(mapTimeImpulse(3, 2, createTransformOperation("scale", -2)), { position: -1.5, coefficient: 1 });
});

test("cosine impulse lines move and retain coefficients under negative scaling", () => {
  const source = createSignalModel("cosine", { A: 2, omega0: 3 });
  const scaled = transformSignalModel(source, createTransformOperation("scale", -2));
  assert.deepEqual(scaled.spectrum.impulses.lines.map((line) => line.frequency), [6, -6]);
  scaled.spectrum.impulses.lines.forEach((line) => close(line.coefficient, 2 * Math.PI));
});

test("shifted sine impulse coefficients receive frequency-dependent phase", () => {
  const source = createSignalModel("sine", { A: 1, omega0: 2 });
  const shifted = transformSignalModel(source, createTransformOperation("shift", Math.PI / 4));
  const [negative, positive] = shifted.spectrum.impulses.lines;
  close(negative.coefficient, source.spectrum.lines[0].coefficient.mul(Complex.polar(1, Math.PI / 2)));
  close(positive.coefficient, source.spectrum.lines[1].coefficient.mul(Complex.polar(1, -Math.PI / 2)));
});

test("continuous canonical signals satisfy all three transform identities", () => {
  const ids = ["rectangular-pulse", "one-sided-exponential", "two-sided-exponential"];
  for (const id of ids) {
    const source = createSignalModel(id);
    const reversed = transformSignalModel(source, createTransformOperation("reverse"));
    const shifted = transformSignalModel(source, createTransformOperation("shift", -1.25));
    const scaled = transformSignalModel(source, createTransformOperation("scale", 0.5));
    for (const omega of [-2, -0.75, 0, 1.5]) {
      close(reversed.spectrum.continuous.evaluate(omega), source.spectrum.evaluate(-omega));
      close(shifted.spectrum.continuous.evaluate(omega).abs(), source.spectrum.evaluate(omega).abs());
      close(scaled.spectrum.continuous.evaluate(omega), source.spectrum.evaluate(omega / 0.5).scale(2));
    }
  }
});

test("time reversal mirrors cosine and sine lines without corrupting weights", () => {
  for (const id of ["cosine", "sine"]) {
    const source = createSignalModel(id, { A: 1, omega0: 5 });
    const reversed = transformSignalModel(source, createTransformOperation("reverse"));
    assert.deepEqual(reversed.spectrum.impulses.lines.map((line) => line.frequency), [5, -5]);
    close(reversed.spectrum.impulses.lines[0].coefficient, source.spectrum.lines[0].coefficient);
    close(reversed.spectrum.impulses.lines[1].coefficient, source.spectrum.lines[1].coefficient);
  }
});

test("scale rejects zero and queue interface composes operations", () => {
  assert.throws(() => createTransformOperation("scale", 0), /nonzero/);
  const source = createSignalModel("rectangular-pulse", { A: 1, T: 2 });
  const queued = applyTransformQueue(source, [
    createTransformOperation("shift", 1),
    createTransformOperation("reverse")
  ]);
  close(queued.evaluateTime(-1), 1);
  close(queued.evaluateTime(1), 0);
});
