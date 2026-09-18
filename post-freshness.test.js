import assert from "node:assert/strict";
import test from "node:test";

await import("./post-freshness.js");

const {
  extractTimestampTokens,
  getUnverifiedRetry,
  parseTimestamp,
  evaluateTimestampValues
} = globalThis.FbPostFreshness;

const NOW = Date.parse("2026-09-18T14:00:00.000Z");

test("extracts relative timestamps from anonymous-post headers", () => {
  assert.deepEqual(
    extractTimestampTokens(
      "ProficientChipmunk2752 2m · Shared with Public 12 HOURS ONLY"
    ),
    ["2m", "12 HOURS"]
  );
});

test("parses Facebook relative timestamps", () => {
  assert.equal(parseTimestamp("Just now", NOW), NOW);
  assert.equal(parseTimestamp("19m", NOW), NOW - 19 * 60 * 1000);
  assert.equal(
    parseTimestamp("20 minutes ago", NOW),
    NOW - 20 * 60 * 1000
  );
  assert.equal(parseTimestamp("1 hr", NOW), NOW - 60 * 60 * 1000);
});

test("parses Unix and absolute Facebook timestamps", () => {
  assert.equal(
    parseTimestamp(String(NOW / 1000), NOW),
    NOW
  );
  assert.equal(
    parseTimestamp("Friday, September 18, 2026 at 9:48 PM", NOW),
    Date.parse("2026-09-18T21:48:00")
  );
});

test("accepts posts younger than twenty minutes", () => {
  assert.deepEqual(
    evaluateTimestampValues(["19m"], NOW),
    {
      status: "fresh",
      publishedAt: "2026-09-18T13:41:00.000Z",
      ageMs: 19 * 60 * 1000
    }
  );
});

test("rejects posts at or beyond twenty minutes", () => {
  assert.equal(evaluateTimestampValues(["20m"], NOW).status, "stale");
  assert.equal(evaluateTimestampValues(["1h"], NOW).status, "stale");
});

test("does not treat an unknown timestamp as fresh", () => {
  assert.deepEqual(
    evaluateTimestampValues(["Public", "Edited"]),
    {
      status: "unknown",
      publishedAt: null,
      ageMs: null
    }
  );
});

test("uses the oldest timestamp when evidence differs", () => {
  assert.equal(
    evaluateTimestampValues(["19m", "21 minutes ago"], NOW).status,
    "stale"
  );
});

test("retries an unverified timestamp only within its retry window", () => {
  assert.deepEqual(
    getUnverifiedRetry(NOW - 19 * 60 * 1000, NOW),
    {
      shouldRetry: true,
      delayMs: 30_000
    }
  );
  assert.deepEqual(
    getUnverifiedRetry(NOW - 20 * 60 * 1000, NOW),
    {
      shouldRetry: false,
      delayMs: 0
    }
  );
});
