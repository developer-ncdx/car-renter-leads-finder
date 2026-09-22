(() => {
  "use strict";

  const STORAGE_KEY = "monitoredGroupsV2";
  const LEGACY_STORAGE_KEY = "monitoredGroupIds";
  const GROUP_TYPES = Object.freeze({
    RENTAL: "rental",
    JOB: "job"
  });
  const GROUP_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
  const RESERVED_GROUP_ROUTES = new Set([
    "admin",
    "browse",
    "create",
    "discover",
    "feed",
    "joins",
    "notifications",
    "search",
    "your_groups"
  ]);
  const LEGACY_GROUP_IDS = Object.freeze([
    "341298636779740",
    "749875689751332",
    "1404224761913202"
  ]);

  function normalizeGroupIds(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    return [...new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value))
    )];
  }

  function normalizeGroups(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const groupsById = new Map();

    for (const value of values) {
      const requestedId = typeof value === "object" && value !== null
        ? String(value.id ?? value.groupId ?? "").trim()
        : String(value ?? "").trim();
      const id = normalizeGroupIdentifier(requestedId);
      const requestedType = typeof value === "object" && value !== null
        ? String(value.type ?? "").trim().toLowerCase()
        : GROUP_TYPES.RENTAL;
      const type = Object.values(GROUP_TYPES).includes(requestedType)
        ? requestedType
        : GROUP_TYPES.RENTAL;

      if (id) {
        groupsById.set(id, { id, type });
      }
    }

    return [...groupsById.values()];
  }

  function normalizeGroupIdentifier(value) {
    const identifier = String(value ?? "").trim();

    if (
      !GROUP_IDENTIFIER_PATTERN.test(identifier) ||
      RESERVED_GROUP_ROUTES.has(identifier.toLowerCase())
    ) {
      return null;
    }

    return /^\d+$/.test(identifier)
      ? identifier
      : identifier.toLowerCase();
  }

  function parseFacebookUrl(value) {
    const input = String(value ?? "").trim();

    if (!input) {
      return null;
    }

    try {
      const candidate = input.startsWith("/")
        ? new URL(input, "https://www.facebook.com")
        : new URL(
          /^https?:\/\//i.test(input) ? input : `https://${input}`
        );
      const hostname = candidate.hostname.toLowerCase();
      const isFacebook =
        hostname === "facebook.com" ||
        hostname === "www.facebook.com" ||
        hostname === "m.facebook.com";

      return isFacebook ? candidate : null;
    } catch {
      return null;
    }
  }

  function parseGroupId(value) {
    const input = String(value ?? "").trim();

    if (/^\d+$/.test(input)) {
      return input;
    }

    if (!input) {
      return null;
    }

    try {
      const url = parseFacebookUrl(input);
      const encodedIdentifier =
        url?.pathname.match(/^\/groups\/([^/]+)(?:\/|$)/)?.[1];

      if (!encodedIdentifier) {
        return null;
      }

      return normalizeGroupIdentifier(
        decodeURIComponent(encodedIdentifier)
      );
    } catch {
      return null;
    }
  }

  function parseGroupPostUrl(value) {
    let candidate = String(value ?? "").trim();

    for (let depth = 0; candidate && depth < 3; depth += 1) {
      const url = parseFacebookUrl(candidate);

      if (!url) {
        return null;
      }

      const match = url.pathname.match(
        /^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)(?:\/|$)/i
      );
      const groupRouteMatch = url.pathname.match(
        /^\/groups\/([^/]+)\/?$/i
      );
      const multiPermalinkPostId =
        url.searchParams.get("multi_permalinks")?.match(/^\d+/)?.[0] ??
        null;
      const matchedGroupIdentifier = match?.[1] ?? groupRouteMatch?.[1];
      const matchedPostId = match?.[2] ?? multiPermalinkPostId;

      if (matchedGroupIdentifier && matchedPostId) {
        const groupId = normalizeGroupIdentifier(
          decodeURIComponent(matchedGroupIdentifier)
        );

        if (!groupId) {
          return null;
        }

        const postId = matchedPostId;

        return {
          groupId,
          postId,
          postUrl:
            `${canonicalGroupUrl(groupId)}posts/${postId}/`
        };
      }

      const nestedUrl = ["href", "url", "u", "target"]
        .map((name) => url.searchParams.get(name))
        .find((nestedValue) => nestedValue);

      if (!nestedUrl || nestedUrl === candidate) {
        return null;
      }

      candidate = nestedUrl;
    }

    return null;
  }

  function parseGroupNotificationUrl(value) {
    let candidate = String(value ?? "").trim();

    for (let depth = 0; candidate && depth < 3; depth += 1) {
      const url = parseFacebookUrl(candidate);

      if (!url) {
        return null;
      }

      const groupRouteMatch = url.pathname.match(
        /^\/groups\/([^/]+)\/?$/i
      );
      const notificationId = url.searchParams.get("notif_id");

      if (
        groupRouteMatch &&
        notificationId &&
        /^[a-z0-9_-]{1,200}$/i.test(notificationId)
      ) {
        const groupId = normalizeGroupIdentifier(
          decodeURIComponent(groupRouteMatch[1])
        );

        if (!groupId) {
          return null;
        }

        url.protocol = "https:";
        url.hostname = "www.facebook.com";
        url.hash = "";

        return {
          groupId,
          notificationId,
          notificationUrl: url.toString()
        };
      }

      const nestedUrl = ["href", "url", "u", "target"]
        .map((name) => url.searchParams.get(name))
        .find((nestedValue) => nestedValue);

      if (!nestedUrl || nestedUrl === candidate) {
        return null;
      }

      candidate = nestedUrl;
    }

    return null;
  }

  function canonicalGroupUrl(groupId) {
    return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/`;
  }

  async function saveGroups(values) {
    const groups = normalizeGroups(values);
    await chrome.storage.local.set({ [STORAGE_KEY]: groups });
    return groups;
  }

  async function loadGroups() {
    const stored = await chrome.storage.local.get([
      STORAGE_KEY,
      LEGACY_STORAGE_KEY
    ]);

    if (Array.isArray(stored[STORAGE_KEY])) {
      return normalizeGroups(stored[STORAGE_KEY]);
    }

    if (Array.isArray(stored[LEGACY_STORAGE_KEY])) {
      return saveGroups(
        normalizeGroupIds(stored[LEGACY_STORAGE_KEY]).map((id) => ({
          id,
          type: GROUP_TYPES.RENTAL
        }))
      );
    }

    return [];
  }

  globalThis.FbGroupConfig = Object.freeze({
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    GROUP_TYPES,
    LEGACY_GROUP_IDS,
    normalizeGroupIds,
    normalizeGroups,
    parseGroupId,
    parseGroupPostUrl,
    parseGroupNotificationUrl,
    canonicalGroupUrl,
    loadGroups,
    saveGroups
  });
})();
