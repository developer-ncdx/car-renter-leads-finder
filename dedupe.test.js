import assert from "node:assert/strict";
import test from "node:test";

import {
  createLeadContentKey,
  normalizeFingerprintPart
} from "./dedupe.js";

test("normalizes case, spacing, and decorative Unicode", () => {
  assert.equal(
    normalizeFingerprintPart("  Ｎｅｅｄ   A\nCAR  "),
    "need a car"
  );
});

test("matches repeated content even when formatting changes", () => {
  const first = createLeadContentKey({
    leadType: "rental",
    authorName: "Juan Dela Cruz",
    postText: "Need a car for three months"
  });
  const repeated = createLeadContentKey({
    leadType: "RENTAL",
    authorName: "  JUAN   DELA CRUZ ",
    postText: "Ｎｅｅｄ a car\nfor three months"
  });

  assert.equal(first, repeated);
});

test("keeps different authors, text, and lead types distinct", () => {
  const original = {
    leadType: "rental",
    authorName: "Juan Dela Cruz",
    postText: "Need a car"
  };

  assert.notEqual(
    createLeadContentKey(original),
    createLeadContentKey({ ...original, authorName: "Maria Santos" })
  );
  assert.notEqual(
    createLeadContentKey(original),
    createLeadContentKey({ ...original, postText: "Need a van" })
  );
  assert.notEqual(
    createLeadContentKey(original),
    createLeadContentKey({ ...original, leadType: "job" })
  );
});
