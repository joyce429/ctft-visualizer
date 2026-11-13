import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("offline web build contains local HTML, CSS, and classic bundled JavaScript", async () => {
  const html = await readFile(resolve(root, "dist/index.html"), "utf8");
  const script = await readFile(resolve(root, "dist/assets/app.js"), "utf8");
  await stat(resolve(root, "dist/assets/styles.css"));
  await stat(resolve(root, "dist/assets/app.css"));
  assert.match(html, /Fourier Transform Lab/);
  assert.match(html, /id="transform-select"/);
  assert.match(html, /data-phase-mode="unwrapped"/);
  assert.match(html, /id="transformed-frequency-formula"/);
  assert.match(html, /value="differentiate"/);
  assert.match(html, /value="integrate"/);
  assert.match(html, /id="component-summary"/);
  assert.match(html, /id="quick-reference"/);
  assert.match(html, /id="export-time-csv"/);
  assert.match(html, /id="export-frequency-csv"/);
  assert.match(html, /id="export-impulse-csv"/);
  assert.match(html, /id="import-config-file"/);
  assert.match(html, /id="dual-signal-lab"/);
  assert.match(html, /data-dual-operation="linear"/);
  assert.match(html, /data-dual-operation="convolution"/);
  assert.match(html, /id="dual-process-chart"/);
  assert.match(html, /id="dual-export-config"/);
  assert.doesNotMatch(html, /id="guided-experiments"/);
  assert.doesNotMatch(html, /id="lesson-panel"/);
  assert.doesNotMatch(html, /id="user-guide"/);
  assert.match(html, /assets\/app\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(script.slice(0, 500), /^\s*import\s/m);
  assert.ok(script.length > 100_000, "ECharts and application code should be bundled locally");
});
