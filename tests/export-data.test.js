import test from "node:test";
import assert from "node:assert/strict";
import { rowsToCsv } from "../src/io/export-data.js";

test("CSV export preserves headers, complex columns, Unicode, and quoting", () => {
  const csv = rowsToCsv(
    ["series", "omega", "real", "imag", "magnitude", "phase", "label"],
    [["transformed", 3, 0, -Math.PI, Math.PI, -Math.PI / 2, "冲激, +ω₀"]]
  );
  assert.ok(csv.startsWith("\uFEFFseries,omega,real,imag,magnitude,phase,label\r\n"));
  assert.match(csv, /"冲激, \+ω₀"/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("CSV export rejects rows whose width does not match the declared format", () => {
  assert.throws(() => rowsToCsv(["t", "real", "imag"], [[0, 1]]), /row width/);
});
