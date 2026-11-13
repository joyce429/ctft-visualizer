import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (name) => JSON.parse(await readFile(resolve(root, "data", name), "utf8"));

test("signal database follows the required maintainable schema", async () => {
  const database = await readJson("signals.json");
  const required = [
    "id", "category", "nameZh", "nameEn", "timeExpressionLatex",
    "frequencyExpressionLatex", "parameters", "defaultValues", "constraints",
    "spectrumType", "description", "references", "implementationId"
  ];
  const signals = database.categories.flatMap((category) => category.signals);
  assert.equal(signals.length, 15);
  assert.equal(new Set(signals.map((signal) => signal.id)).size, signals.length);
  for (const signal of signals) {
    for (const field of required) assert.ok(field in signal, `${signal.id} missing ${field}`);
    assert.equal(signal.category, database.categories.find((c) => c.id === signal.category).id);
    for (const parameter of signal.parameters) {
      for (const field of ["id", "nameZh", "symbol", "type", "default", "unit"]) {
        assert.ok(field in parameter, `${signal.id}.${parameter.id} missing ${field}`);
      }
      assert.equal(signal.defaultValues[parameter.id], parameter.default);
    }
  }
  assert.match(database.conventions.analysisLatex, /e\^\{-j/);
  assert.match(database.conventions.synthesisLatex, /1\}\in\{2\\pi\}|frac\{1\}\{2\\pi\}/);
});

test("every signal and transform property reference resolves", async () => {
  const [database, references, properties] = await Promise.all([
    readJson("signals.json"), readJson("references.json"), readJson("transform-properties.json")
  ]);
  const ids = new Set(references.references.map((reference) => reference.id));
  assert.equal(ids.size, references.references.length);
  for (const reference of references.references) {
    assert.match(reference.url, /^https:\/\//);
    assert.ok(reference.verification.length > 20);
  }
  const owners = [
    ...database.categories.flatMap((category) => category.signals),
    ...properties.properties
  ];
  for (const owner of owners) {
    assert.ok(owner.references.length > 0, `${owner.id} has no reference`);
    for (const id of owner.references) assert.ok(ids.has(id), `${owner.id} has unresolved reference ${id}`);
  }
});
