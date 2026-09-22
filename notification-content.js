(() => {
  "use strict";

  const GroupConfig = globalThis.FbGroupConfig;

  if (!GroupConfig) {
    console.error(
      "[Lead Notifications] Group configuration failed to load."
    );
    return;
  }

  const CONFIG = Object.freeze({
    storageKey: "processedNotificationPosts:v1",
    processedTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxStoredPostIds: 3000,
    scanThrottleMs: 500,
    reconciliationScanMs: 5000,
    retryDelayMs: 30_000
  });
  const LOG_PREFIX = "[Lead Notifications]";

  const processedPosts = new Map();
  const pendingPosts = new Set();
  const retryNotBefore = new Map();
  const unrecognizedGroupLinks = new Set();

  let monitoredGroupIds = new Set();
  let scanTimer = null;
  let persistTimer = null;
  let observer = null;

  function postKey(candidate) {
    return candidate.postId
      ? `${candidate.groupId}:post:${candidate.postId}`
      : `${candidate.groupId}:notification:${candidate.notificationId}`;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function notificationTextFor(anchor) {
    const container = anchor.closest(
      '[role="listitem"], [role="article"], li'
    ) ?? anchor.parentElement;

    return normalizeText(
      container?.innerText || container?.textContent
    ).slice(0, 1000);
  }

  function isNewPostNotificationText(value) {
    return /\b(?:new (?:group )?(?:post|photo)|added (?:a )?new (?:post|photo)|posted (?:anonymously )?(?:in|to)|shared (?:a )?(?:new )?post (?:in|to)|has a new post|may bagong post|bagong post|ngayon sa|nag-post si|nagdagdag (?:si )?.*?\b(?:bagong post|bagong larawan))\b/i
      .test(normalizeText(value));
  }

  function collectCandidates(root = document) {
    const anchors = [];

    if (root instanceof HTMLAnchorElement && root.hasAttribute("href")) {
      anchors.push(root);
    }

    if (
      root instanceof Document ||
      root instanceof DocumentFragment ||
      root instanceof Element
    ) {
      anchors.push(...root.querySelectorAll("a[href]"));
    }

    const candidates = new Map();

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute("href");
      const parsedPost = GroupConfig.parseGroupPostUrl(rawHref);
      const parsedNotification = parsedPost
        ? null
        : GroupConfig.parseGroupNotificationUrl(rawHref);
      const parsed = parsedPost ?? parsedNotification;

      if (!parsed) {
        if (
          /\/groups\//i.test(rawHref ?? "") &&
          /(?:multi_permalinks|notif_t=group_activity|ref=notif)/i
            .test(rawHref ?? "") &&
          !unrecognizedGroupLinks.has(rawHref)
        ) {
          unrecognizedGroupLinks.add(rawHref);
          console.warn(
            `${LOG_PREFIX} Facebook exposed a group notification link ` +
            `whose post ID could not be read: ${rawHref}`
          );
        }

        continue;
      }

      const notificationText = notificationTextFor(anchor);
      const candidate = {
        ...parsed,
        notificationText,
        isNewPostNotification:
          isNewPostNotificationText(notificationText),
        detectedAt: new Date().toISOString()
      };

      candidates.set(postKey(candidate), candidate);
    }

    return [...candidates.values()];
  }

  async function loadProcessedPosts() {
    const stored = await chrome.storage.local.get(CONFIG.storageKey);
    const entries = stored?.[CONFIG.storageKey];

    if (!entries || typeof entries !== "object") {
      return;
    }

    const cutoff = Date.now() - CONFIG.processedTtlMs;

    for (const [key, processedAt] of Object.entries(entries)) {
      if (typeof processedAt === "number" && processedAt >= cutoff) {
        processedPosts.set(key, processedAt);
      }
    }
  }

  function persistProcessedPosts() {
    if (persistTimer !== null) {
      return;
    }

    persistTimer = window.setTimeout(() => {
      persistTimer = null;

      const cutoff = Date.now() - CONFIG.processedTtlMs;
      const fresh = [...processedPosts]
        .filter(([, processedAt]) => processedAt >= cutoff)
        .slice(-CONFIG.maxStoredPostIds);

      chrome.storage.local
        .set({ [CONFIG.storageKey]: Object.fromEntries(fresh) })
        .catch((error) => {
          console.warn(
            `${LOG_PREFIX} Could not save notification history: ` +
            error.message
          );
        });
    }, 500);
  }

  function markProcessed(key) {
    processedPosts.set(key, Date.now());
    pendingPosts.delete(key);
    retryNotBefore.delete(key);
    persistProcessedPosts();
  }

  async function forwardCandidate(candidate) {
    const key = postKey(candidate);
    const retryAt = retryNotBefore.get(key) ?? 0;

    if (
      processedPosts.has(key) ||
      pendingPosts.has(key) ||
      retryAt > Date.now()
    ) {
      return;
    }

    if (!monitoredGroupIds.has(candidate.groupId)) {
      console.info(
        `${LOG_PREFIX} Ignored notification ${
          candidate.postId ?? candidate.notificationId
        }; group ` +
        `${candidate.groupId} is not in the monitored list.`
      );
      markProcessed(key);
      return;
    }

    if (!candidate.isNewPostNotification) {
      console.info(
        `${LOG_PREFIX} Ignored notification ${
          candidate.postId ?? candidate.notificationId
        }; it is not a new-post alert. Text: ` +
        `"${candidate.notificationText.slice(0, 180)}"`
      );
      markProcessed(key);
      return;
    }

    pendingPosts.add(key);
    console.info(
      `${LOG_PREFIX} Detected a new group notification ${
        candidate.postId
          ? `for post ${candidate.postId}`
          : `(ID ${candidate.notificationId})`
      } in group ${candidate.groupId}.`
    );

    try {
      const response = await chrome.runtime.sendMessage({
        type: "NEW_POST_NOTIFICATION",
        payload: candidate
      });

      if (!response?.ok) {
        throw new Error(response?.error || "notification bridge unavailable");
      }

      markProcessed(key);
      console.info(
        `${LOG_PREFIX} Opened monitored ${
          candidate.postId
            ? `post ${candidate.postId}`
            : `notification ${candidate.notificationId}`
        } from group ${candidate.groupId} for extraction.`
      );
    } catch (error) {
      pendingPosts.delete(key);
      retryNotBefore.set(key, Date.now() + CONFIG.retryDelayMs);
      console.warn(
        `${LOG_PREFIX} Could not process notification ${
          candidate.postId ?? candidate.notificationId
        }; it will be retried: ${error.message}`
      );
    }
  }

  function scanNotifications(root = document) {
    for (const candidate of collectCandidates(root)) {
      forwardCandidate(candidate);
    }
  }

  function scheduleScan() {
    if (scanTimer !== null) {
      return;
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scanNotifications();
    }, CONFIG.scanThrottleMs);
  }

  function updateMonitoredGroups(groups) {
    monitoredGroupIds = new Set(
      GroupConfig.normalizeGroups(groups).map((group) => group.id)
    );
  }

  function logExtractionResult(payload) {
    const postLabel = payload.postId
      ? `post ${payload.postId}`
      : `notification ${payload.notificationId || "unknown"}`;

    if (payload.status === "timed_out") {
      console.warn(
        `${LOG_PREFIX} ${postLabel} timed out before its content could be ` +
        "extracted."
      );
      return;
    }

    if (payload.status === "failed") {
      console.error(
        `${LOG_PREFIX} ${postLabel} failed during processing: ` +
        `${payload.error || "unknown error"}`
      );
      return;
    }

    if (payload.status === "stale") {
      console.info(
        `${LOG_PREFIX} ${postLabel} was skipped because it is ` +
        `${payload.ageMinutes ?? "at least 50"} minutes old.`
      );
      return;
    }

    if (payload.telegramSent) {
      console.info(
        `${LOG_PREFIX} ${postLabel} was sent to the ${
          payload.leadType === GroupConfig.GROUP_TYPES.JOB
            ? "job"
            : "rental"
        } Telegram group.`
      );
    } else if (payload.duplicate) {
      console.info(
        `${LOG_PREFIX} ${postLabel} was already processed.`
      );
    } else if (payload.isLead === false) {
      console.info(
        `${LOG_PREFIX} ${postLabel} was rejected (` +
        `${payload.rejectionReason || "not a lead"}).`
      );
    } else {
      console.info(
        `${LOG_PREFIX} ${postLabel} finished without a Telegram alert.`
      );
    }
  }

  async function initialize() {
    const [groups] = await Promise.all([
      GroupConfig.loadGroups(),
      loadProcessedPosts()
    ]);

    updateMonitoredGroups(groups);

    const baselineCandidates = collectCandidates();

    for (const candidate of baselineCandidates) {
      processedPosts.set(postKey(candidate), Date.now());
    }

    persistProcessedPosts();

    observer = new MutationObserver(() => {
      scheduleScan();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href"]
    });

    window.setInterval(
      scheduleScan,
      CONFIG.reconciliationScanMs
    );

    console.info(
      `${LOG_PREFIX} Ready with ${monitoredGroupIds.size} monitored ` +
      `${monitoredGroupIds.size === 1 ? "group" : "groups"}. Existing ` +
      "notifications were used as the baseline."
    );
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const groupChange = changes[GroupConfig.STORAGE_KEY];

    if (areaName === "local" && groupChange) {
      updateMonitoredGroups(groupChange.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "NOTIFICATION_EXTRACTION_RESULT") {
      return false;
    }

    logExtractionResult(message.payload ?? {});
    return false;
  });

  initialize().catch((error) => {
    console.error(
      `${LOG_PREFIX} Could not start notification monitoring: ${error.message}`
    );
  });
})();
