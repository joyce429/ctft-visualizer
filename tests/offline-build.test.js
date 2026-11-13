import test from "node:test";
import assert from "node:assert/strict";
import { SIGNAL_DATABASE, REFERENCE_DATABASE, TRANSFORM_PROPERTIES } from "../src/data/generated/signals.generated.js";

test("generated offline module embeds all JSON databases", () => {
  assert.equal(SIGNAL_DATABASE.categories.flatMap((category) => category.signals).length, 15);
  assert.equal(REFERENCE_DATABASE.references.length, 6);
  assert.ok(TRANSFORM_PROPERTIES.properties.length >= 10);
});
