import test from "node:test";
import assert from "node:assert/strict";
import {
  amplitude,
  buildExpression,
  convolution,
  convolutionAt,
  leaf,
  makeLinearCombination,
  shift,
  sum,
  termNode
} from "../src/operations/signal-expression.js";
import { asComposite } from "../src/math/spectrum.js";

const close = (actual, expected, tolerance = 5e-3) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
};

test("linear combination adds complex spectra instead of magnitudes", () => {
  const x = leaf("one-sided-exponential", { A: 1, a: 1 });
  const y = leaf("one-sided-exponential", { A: 2, a: 2 });
  const model = buildExpression(makeLinearCombination(x, y, 3, -0.5));
  const omega = 1.25;
  const expected = asComposite(buildExpression(x).spectrum).regularValueAt(omega).scale(3)
    .add(asComposite(buildExpression(y).spectrum).regularValueAt(omega).scale(-0.5));
  assert.ok(model.spectrum.regularValueAt(omega).equals(expected, 1e-12));
});

test("equal impulse lines merge and exact cancellation removes the line", () => {
  const cosine = leaf("cosine", { A: 1, omega0: 3 });
  const model = buildExpression(sum([cosine, amplitude(-1, cosine)]));
  assert.equal(model.spectrum.impulses.lines.length, 0);
});

test("two centered rectangles convolve to a triangle", () => {
  const rectangle = leaf("rectangular-pulse", { A: 1, T: 2 });
  close(convolutionAt(rectangle, rectangle, 0, { samples: 1201 }).re, 2, 2e-3);
  close(convolutionAt(rectangle, rectangle, 1, { samples: 1201 }).re, 1, 2e-3);
  close(convolutionAt(rectangle, rectangle, 1.5, { samples: 1201 }).re, 0.5, 2e-3);
  close(convolutionAt(rectangle, rectangle, 2.1, { samples: 1201 }).re, 0, 1e-12);
});

test("rectangles of different widths cover full, partial, and zero overlap", () => {
  const wide = leaf("rectangular-pulse", { A: 1, T: 2 });
  const narrow = leaf("rectangular-pulse", { A: 1, T: 1 });
  close(convolutionAt(wide, narrow, 0, { samples: 1200 }).re, 1, 2e-3);
  close(convolutionAt(wide, narrow, 0.75, { samples: 1200 }).re, 0.75, 2e-3);
  close(convolutionAt(wide, narrow, 1.5, { samples: 1200 }).re, 0, 2e-3);
  close(convolutionAt(wide, narrow, 2, { samples: 1200 }).re, 0, 1e-12);
});

test("two equal one-sided exponentials produce t exp(-at) u(t)", () => {
  const exponential = leaf("one-sided-exponential", { A: 1, a: 1 });
  for (const t of [0.5, 1, 2, 4]) {
    close(convolutionAt(exponential, exponential, t, { samples: 1601 }).re, t * Math.exp(-t), 3e-3);
  }
  close(convolutionAt(exponential, exponential, -1).re, 0, 1e-12);
});

test("convolution with a shifted impulse uses the sifting property", () => {
  const rectangle = leaf("rectangular-pulse", { A: 2, T: 2 });
  const impulse = leaf("shifted-impulse", { A: 3, t0: 1 });
  const result = buildExpression(convolution(rectangle, impulse));
  close(result.evaluate(1).re, 6, 1e-12);
  close(result.evaluate(3).re, 0, 1e-12);
  assert.equal(result.method, "impulse-analytic");
});

test("numerical convolution is commutative at representative points", () => {
  const rectangle = termNode({ signalId: "rectangular-pulse", parameters: { A: 1, T: 2 }, shift: 0.5 });
  const exponential = leaf("one-sided-exponential", { A: 1, a: 1 });
  for (const t of [-1, 0, 1, 2, 4]) {
    const first = convolutionAt(rectangle, exponential, t, { samples: 1001 });
    const second = convolutionAt(exponential, rectangle, t, { samples: 1001 });
    assert.ok(first.equals(second, 4e-3));
  }
});

test("convolution is linear for finite signal sums", () => {
  const x = leaf("rectangular-pulse", { A: 1, T: 2 });
  const y = shift(0.5, leaf("triangular-pulse", { A: 0.75, T: 1 }));
  const h = leaf("one-sided-exponential", { A: 1, a: 1.2 });
  const combined = sum([x, amplitude(2, y)]);
  for (const t of [-0.5, 0.5, 1.5, 3]) {
    const actual = convolutionAt(combined, h, t, { samples: 1600 });
    const expected = convolutionAt(x, h, t, { samples: 1600 })
      .add(convolutionAt(y, h, t, { samples: 1600 }).scale(2));
    assert.ok(actual.equals(expected, 5e-3));
  }
});

test("time shift of an input shifts the convolution output", () => {
  const rectangle = leaf("rectangular-pulse", { A: 1, T: 2 });
  const exponential = leaf("one-sided-exponential", { A: 1, a: 1 });
  const shifted = shift(1.25, rectangle);
  for (const t of [0, 1, 2.5, 4]) {
    const actual = convolutionAt(shifted, exponential, t, { samples: 1201 });
    const expected = convolutionAt(rectangle, exponential, t - 1.25, { samples: 1201 });
    assert.ok(actual.equals(expected, 4e-3));
  }
});

test("convolution spectrum equals the complex product at signed frequencies", () => {
  const first = leaf("rectangular-pulse", { A: 2, T: 1.5 });
  const second = leaf("one-sided-exponential", { A: 1, a: 0.8 });
  const result = buildExpression(convolution(first, second));
  for (const omega of [-3, -0.5, 0, 1.25, 4]) {
    const expected = asComposite(buildExpression(first).spectrum).regularValueAt(omega)
      .mul(asComposite(buildExpression(second).spectrum).regularValueAt(omega));
    assert.ok(result.spectrum.regularValueAt(omega).equals(expected, 1e-12));
  }
});

test("undefined generalized-function spectral products are rejected", () => {
  const step = leaf("unit-step");
  const rectangle = leaf("rectangular-pulse", { A: 1, T: 2 });
  assert.throws(() => buildExpression(convolution(step, rectangle)), /广义函数/);
});

test("nondecaying periodic inputs are not truncated into a fake convolution", () => {
  const cosine = leaf("cosine", { A: 1, omega0: 2 });
  const rectangle = leaf("rectangular-pulse", { A: 1, T: 2 });
  assert.throws(() => buildExpression(convolution(cosine, rectangle)), /有限支撑或充分衰减/);
});
