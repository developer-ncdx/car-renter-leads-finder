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

  function parseGroupId(value) {
    const input = String(value ?? "").trim();

    if (/^\d+$/.test(input)) {
      return input;
    }

    if (!input) {
      return null;
    }

    try {
      const candidate = /^https?:\/\//i.test(input)
        ? input
        : `https://${input}`;
      const url = new URL(candidate);
      const hostname = url.hostname.toLowerCase();
      const isFacebook =
        hostname === "facebook.com" ||
        hostname === "www.facebook.com" ||
        hostname === "m.facebook.com";

      if (!isFacebook) {
        return null;
      }

      const encodedIdentifier =
        url.pathname.match(/^\/groups\/([^/]+)(?:\/|$)/)?.[1];

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
    canonicalGroupUrl,
    loadGroups,
    saveGroups
  });
})();
