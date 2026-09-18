import assert from "node:assert/strict";
import test from "node:test";

await import("./group-config.js");

const {
  GROUP_TYPES,
  canonicalGroupUrl,
  normalizeGroupIds,
  normalizeGroups,
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

test("normalizes typed groups and migrates bare IDs to rental", () => {
  assert.deepEqual(
    normalizeGroups([
      "123",
      { id: "456", type: "job" },
      { groupId: " 789 ", type: "unknown" },
      { id: "456", type: "rental" },
      { id: "not-numeric", type: "job" }
    ]),
    [
      { id: "123", type: GROUP_TYPES.RENTAL },
      { id: "456", type: GROUP_TYPES.RENTAL },
      { id: "789", type: GROUP_TYPES.RENTAL }
    ]
  );
});

test("creates a canonical Facebook group URL", () => {
  assert.equal(
    canonicalGroupUrl("341298636779740"),
    "https://www.facebook.com/groups/341298636779740/"
  );
});
