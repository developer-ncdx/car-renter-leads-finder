import assert from "node:assert/strict";
import test from "node:test";

await import("./group-config.js");

const {
  canonicalGroupUrl,
  normalizeGroupIds,
  parseGroupId
} = globalThis.FbGroupConfig;

test("extracts numeric IDs from supported Facebook group URLs", () => {
  const examples = [
    "https://www.facebook.com/groups/341298636779740/",
    "https://facebook.com/groups/341298636779740",
    "m.facebook.com/groups/341298636779740/posts/2166127504296835/",
    "341298636779740"
  ];

  for (const example of examples) {
    assert.equal(parseGroupId(example), "341298636779740", example);
  }
});

test("rejects non-Facebook and nonnumeric group URLs", () => {
  const examples = [
    "",
    "https://example.com/groups/341298636779740/",
    "https://www.facebook.com/groups/car-rentals/",
    "not a URL"
  ];

  for (const example of examples) {
    assert.equal(parseGroupId(example), null, example);
  }
});

test("normalizes and deduplicates stored group IDs", () => {
  assert.deepEqual(
    normalizeGroupIds(["123", 123, " 456 ", "", "group-name"]),
    ["123", "456"]
  );
});

test("creates a canonical Facebook group URL", () => {
  assert.equal(
    canonicalGroupUrl("341298636779740"),
    "https://www.facebook.com/groups/341298636779740/"
  );
});
