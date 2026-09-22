import assert from "node:assert/strict";
import test from "node:test";

await import("./post-freshness.js");
await import("./notification-utils.js");

const {
  decideNotificationCandidate,
  notificationMetadataFor,
  selectBetterNotificationCandidate
} = globalThis.FbNotificationUtils;

const NOW = Date.parse("2026-09-23T02:25:00.000Z");

function mockElement(text, attributes = {}) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attributes[name] ?? null;
    }
  };
}

function notificationFixture(
  notificationText,
  timestampText,
  extraTimestampTexts = []
) {
  const timestamps = [
    timestampText,
    ...extraTimestampTexts
  ].map((value) => mockElement(value));
  const container = {
    innerText: `${notificationText}\n${timestampText}`,
    textContent: `${notificationText}\n${timestampText}`,
    parentElement: null,
    querySelectorAll() {
      return timestamps;
    }
  };
  const anchor = {
    ...mockElement(notificationText, {
      href: "/groups/341298636779740/?notif_id=test"
    }),
    parentElement: container,
    closest() {
      return null;
    }
  };

  return anchor;
}

test("reads a fresh visible rental notification fixture", () => {
  const metadata = notificationMetadataFor(
    notificationFixture(
      'Ngayon sa CAR FOR RENT: "Price starts at 999"',
      "9m"
    ),
    NOW
  );

  assert.equal(metadata.isNewPostNotification, true);
  assert.deepEqual(metadata.freshness, {
    status: "fresh",
    publishedAt: "2026-09-23T02:16:00.000Z",
    ageMs: 9 * 60 * 1000
  });
});

test("reads a fresh visible job notification fixture", () => {
  const metadata = notificationMetadataFor(
    notificationFixture(
      "Ang IT and Web Developers Job Openings ay may bagong post.",
      "17m"
    ),
    NOW
  );

  assert.equal(metadata.isNewPostNotification, true);
  assert.equal(metadata.freshness.status, "fresh");
});

test("marks a notification beyond fifty minutes as stale", () => {
  const metadata = notificationMetadataFor(
    notificationFixture(
      "Ang CAR FOR RENT ay may bagong post.",
      "1h"
    ),
    NOW
  );

  assert.equal(metadata.freshness.status, "stale");
});

test("uses the newest timestamp when Facebook exposes stale metadata", () => {
  const metadata = notificationMetadataFor(
    notificationFixture(
      "Ang IT and Web Developers Job Openings ay may bagong post.",
      "1m",
      ["208972 minutes ago"]
    ),
    NOW
  );

  assert.deepEqual(metadata.freshness, {
    status: "fresh",
    publishedAt: "2026-09-23T02:24:00.000Z",
    ageMs: 60 * 1000
  });
});

test("does not treat comment activity as a new-post notification", () => {
  const metadata = notificationMetadataFor(
    notificationFixture(
      "Nag-comment si Chlarenz Terrones sa iyong post.",
      "2m"
    ),
    NOW
  );

  assert.equal(metadata.isNewPostNotification, false);
});

test("processes fresh startup and newly inserted notifications", () => {
  const common = {
    isProcessed: false,
    isMonitored: true,
    isNewPostNotification: true
  };

  assert.equal(
    decideNotificationCandidate({
      ...common,
      freshnessStatus: "fresh",
      isStartup: true
    }),
    "process"
  );
  assert.equal(
    decideNotificationCandidate({
      ...common,
      freshnessStatus: "unknown",
      isStartup: false
    }),
    "process"
  );
});

test("skips stale, comment, duplicate, and unverifiable startup items", () => {
  const common = {
    isProcessed: false,
    isMonitored: true,
    isNewPostNotification: true
  };

  assert.equal(
    decideNotificationCandidate({
      ...common,
      freshnessStatus: "stale"
    }),
    "stale"
  );
  assert.equal(
    decideNotificationCandidate({
      ...common,
      isNewPostNotification: false,
      freshnessStatus: "fresh"
    }),
    "not_new_post"
  );
  assert.equal(
    decideNotificationCandidate({
      ...common,
      isProcessed: true,
      freshnessStatus: "fresh"
    }),
    "duplicate"
  );
  assert.equal(
    decideNotificationCandidate({
      ...common,
      freshnessStatus: "unknown",
      isStartup: true
    }),
    "startup_timestamp_unknown"
  );
});

test("keeps the best DOM candidate when duplicate links describe one post", () => {
  const staleCandidate = {
    notificationText: "Ang group ay may bagong post.",
    isNewPostNotification: true,
    notificationFreshnessStatus: "stale"
  };
  const freshCandidate = {
    notificationText:
      "Ang IT and Web Developers Job Openings ay may bagong post.",
    isNewPostNotification: true,
    notificationFreshnessStatus: "fresh"
  };

  assert.equal(
    selectBetterNotificationCandidate(staleCandidate, freshCandidate),
    freshCandidate
  );
  assert.equal(
    selectBetterNotificationCandidate(freshCandidate, staleCandidate),
    freshCandidate
  );
});
