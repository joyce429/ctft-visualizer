import test from "node:test";
import assert from "node:assert/strict";
import { Complex } from "../src/math/complex.js";
import { createSignalModel } from "../src/signals/registry.js";
import {
  comparisonRanges,
  defaultRanges,
  insertPhaseBreaks,
  phaseInUnit,
  phaseOf,
  sampleSpectrum,
  sampleTimeSignal,
  unwrapPhasePoints
} from "../src/plotting/sampling.js";
import { createTransformOperation } from "../src/transforms/signal-transform.js";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("phase uses atan2 quadrants and is undefined at zero magnitude", () => {
  close(phaseOf(new Complex(-1, 1)), 3 * Math.PI / 4);
  close(phaseOf(new Complex(-1, -1)), -3 * Math.PI / 4);
  assert.equal(phaseOf(new Complex(0, 0)), null);
  close(phaseInUnit(Math.PI / 2, "deg"), 90);
});

test("phase jumps are broken rather than connected across ±π", () => {
  const points = [[-1, 3.1, 0, 0, 3.1], [0, -3.1, 0, 0, -3.1], [1, -3, 0, 0, -3]];
  const broken = insertPhaseBreaks(points, "rad");
  assert.equal(broken[1][1], null);
  assert.equal(broken[2][1], -3);
});

test("unwrapped phase removes 2π wrapping while preserving undefined samples", () => {
  const points = [[-1, 3, 0, 0, 3], [0, null, 0, 0, null], [1, -3, 0, 0, -3], [2, -2.8, 0, 0, -2.8]];
  const unwrapped = unwrapPhasePoints(points, "rad");
  assert.equal(unwrapped[1][1], null);
  assert.ok(unwrapped[2][1] > 3);
  assert.ok(unwrapped[3][1] > unwrapped[2][1]);
});

test("rectangular pulse sampling preserves zero-frequency limit and spectral zeros", () => {
  const spectrum = createSignalModel("rectangular-pulse", { A: 1, T: 2 }).spectrum;
  const sampled = sampleSpectrum(spectrum, { min: -2 * Math.PI, max: 2 * Math.PI }, "rad", 5);
  close(sampled.continuous.magnitude[2][1], 2);
  close(sampled.continuous.magnitude[1][1], 0, 1e-8);
  assert.equal(sampled.continuous.phase[1][1], null);
});

test("one-sided exponential exposes complex phase at signed frequencies", () => {
  const spectrum = createSignalModel("one-sided-exponential", { A: 1, a: 1 }).spectrum;
  const sampled = sampleSpectrum(spectrum, { min: -1, max: 1 }, "rad", 3);
  close(sampled.continuous.phase[0][1], Math.PI / 4);
  close(sampled.continuous.phase[2][1], -Math.PI / 4);
});

test("sine and cosine retain impulse locations, weights, and coefficient phases", () => {
  const cosine = sampleSpectrum(createSignalModel("cosine", { A: 2, omega0: 4 }).spectrum, { min: -6, max: 6 });
  assert.deepEqual(cosine.impulses.map((point) => point[0]), [-4, 4]);
  cosine.impulses.forEach((point) => close(point[1], 2 * Math.PI));
  const sine = sampleSpectrum(createSignalModel("sine", { A: 1, omega0: 4 }).spectrum, { min: -6, max: 6 });
  close(sine.impulses[0][4], Math.PI / 2);
  close(sine.impulses[1][4], -Math.PI / 2);
});

test("step sampling omits the PV singularity while preserving the zero impulse", () => {
  const sampled = sampleSpectrum(createSignalModel("unit-step").spectrum, { min: -2, max: 2 }, "rad", 5);
  assert.equal(sampled.distributions.length, 1);
  assert.equal(sampled.distributions[0].magnitude[2][1], null);
  close(sampled.impulses[0][0], 0);
  close(sampled.impulses[0][1], Math.PI);
});

test("time sampling and automatic ranges respond to parameters", () => {
  const model = createSignalModel("two-sided-exponential", { A: 2, a: 2 });
  const ranges = defaultRanges(model);
  close(ranges.time.max, 3);
  const sampled = sampleTimeSignal(model, { min: -1, max: 1 }, 3);
  close(sampled.points[1][1], 2);
});

test("comparison ranges contain both shifted and scaled views", () => {
  const source = createSignalModel("rectangular-pulse", { A: 1, T: 2 });
  const shifted = comparisonRanges(source, createTransformOperation("shift", 5));
  assert.ok(shifted.time.min < -3 && shifted.time.max > 8);
  const scaled = comparisonRanges(source, createTransformOperation("scale", 2));
  assert.ok(scaled.frequency.max > defaultRanges(source).frequency.max * 1.9);
});
