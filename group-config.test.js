import assert from "node:assert/strict";
import test from "node:test";

await import("./group-config.js");

const {
  GROUP_TYPES,
  canonicalGroupUrl,
  normalizeGroupIds,
  normalizeGroups,
  parseGroupId,
  parseGroupNotificationUrl,
  parseGroupPostUrl
} = globalThis.FbGroupConfig;

test("extracts numeric IDs from supported Facebook group URLs", () => {
  assert.equal(
    parseGroupId("https://www.facebook.com/groups/341298636779740/"),
    "341298636779740"
  );
  assert.equal(
    parseGroupId(
      "m.facebook.com/groups/341298636779740/posts/2166127504296835/"
    ),
    "341298636779740"
  );
  assert.equal(parseGroupId("341298636779740"), "341298636779740");
});

test("extracts normalized custom names from Facebook group URLs", () => {
  const examples = [
    "https://www.facebook.com/groups/ITJobsPilipinas/",
    "facebook.com/groups/itjobspilipinas/posts/2460010807735809/",
    "https://m.facebook.com/groups/ITJOBSPILIPINAS"
  ];

  for (const example of examples) {
    assert.equal(parseGroupId(example), "itjobspilipinas", example);
  }
});

test("rejects non-Facebook and reserved group URLs", () => {
  const examples = [
    "",
    "https://example.com/groups/341298636779740/",
    "https://www.facebook.com/groups/feed/",
    "https://www.facebook.com/groups/search/",
    "https://www.facebook.com/groups/invalid%2Fname/",
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
      { id: "ITJobsPilipinas", type: "job" },
      { id: "not/a/group", type: "job" }
    ]),
    [
      { id: "123", type: GROUP_TYPES.RENTAL },
      { id: "456", type: GROUP_TYPES.RENTAL },
      { id: "789", type: GROUP_TYPES.RENTAL },
      { id: "itjobspilipinas", type: GROUP_TYPES.JOB }
    ]
  );
});

test("creates a canonical Facebook group URL", () => {
  assert.equal(
    canonicalGroupUrl("341298636779740"),
    "https://www.facebook.com/groups/341298636779740/"
  );
  assert.equal(
    canonicalGroupUrl("itjobspilipinas"),
    "https://www.facebook.com/groups/itjobspilipinas/"
  );
});

test("extracts direct Facebook group post links", () => {
  assert.deepEqual(
    parseGroupPostUrl(
      "https://www.facebook.com/groups/ITJobsPilipinas/posts/2460010807735809/?ref=notif"
    ),
    {
      groupId: "itjobspilipinas",
      postId: "2460010807735809",
      postUrl:
        "https://www.facebook.com/groups/itjobspilipinas/posts/2460010807735809/"
    }
  );
  assert.deepEqual(
    parseGroupPostUrl(
      "/groups/341298636779740/permalink/2166127504296835/"
    ),
    {
      groupId: "341298636779740",
      postId: "2166127504296835",
      postUrl:
        "https://www.facebook.com/groups/341298636779740/posts/2166127504296835/"
    }
  );
});

test("unwraps group post links from Facebook notification redirects", () => {
  const target =
    "https://www.facebook.com/groups/ITJobsPilipinas/posts/2460010807735809/";
  const notificationUrl =
    "https://www.facebook.com/notifications/click/?href=" +
    encodeURIComponent(target);

  assert.deepEqual(
    parseGroupPostUrl(notificationUrl),
    {
      groupId: "itjobspilipinas",
      postId: "2460010807735809",
      postUrl:
        "https://www.facebook.com/groups/itjobspilipinas/posts/2460010807735809/"
    }
  );
});

test("extracts Facebook multi-permalink notification links", () => {
  const examples = [
    "https://www.facebook.com/groups/341298636779740/?multi_permalinks=2166127504296835&notif_t=group_activity",
    "https://www.facebook.com/groups/ITJobsPilipinas?multi_permalinks=2460010807735809&ref=notif"
  ];

  assert.deepEqual(
    parseGroupPostUrl(examples[0]),
    {
      groupId: "341298636779740",
      postId: "2166127504296835",
      postUrl:
        "https://www.facebook.com/groups/341298636779740/posts/2166127504296835/"
    }
  );
  assert.deepEqual(
    parseGroupPostUrl(examples[1]),
    {
      groupId: "itjobspilipinas",
      postId: "2460010807735809",
      postUrl:
        "https://www.facebook.com/groups/itjobspilipinas/posts/2460010807735809/"
    }
  );
});

test("extracts group notification links that contain only a notification ID", () => {
  assert.deepEqual(
    parseGroupNotificationUrl(
      "https://www.facebook.com/groups/341298636779740/?notif_id=178982153&notif_t=group_activity&ref=notif"
    ),
    {
      groupId: "341298636779740",
      notificationId: "178982153",
      notificationUrl:
        "https://www.facebook.com/groups/341298636779740/?notif_id=178982153&notif_t=group_activity&ref=notif"
    }
  );
  assert.deepEqual(
    parseGroupNotificationUrl(
      "https://www.facebook.com/groups/ITJobsPilipinas?notif_id=abc_123"
    ),
    {
      groupId: "itjobspilipinas",
      notificationId: "abc_123",
      notificationUrl:
        "https://www.facebook.com/groups/ITJobsPilipinas?notif_id=abc_123"
    }
  );
});

test("rejects notification links without a Facebook group post", () => {
  const examples = [
    "https://www.facebook.com/notifications/",
    "https://www.facebook.com/groups/123/",
    "https://example.com/groups/123/posts/456/",
    "https://www.facebook.com/notifications/click/?href=https%3A%2F%2Fexample.com%2Fgroups%2F123%2Fposts%2F456%2F"
  ];

  for (const example of examples) {
    assert.equal(parseGroupPostUrl(example), null, example);
  }
});
