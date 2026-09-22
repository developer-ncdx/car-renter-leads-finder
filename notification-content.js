(() => {
  "use strict";

  const GroupConfig = globalThis.FbGroupConfig;
  const NotificationUtils = globalThis.FbNotificationUtils;

  if (!GroupConfig || !NotificationUtils) {
    console.error(
      "[Lead Notifications] Required extension modules failed to load."
    );
    return;
  }

  const CONFIG = Object.freeze({
    storageKey: "processedNotificationPosts:v3",
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

      const observedAt = Date.now();
      const metadata = NotificationUtils.notificationMetadataFor(
        anchor,
        observedAt
      );
      const candidate = {
        ...parsed,
        notificationText: metadata.notificationText,
        isNewPostNotification: metadata.isNewPostNotification,
        notificationFreshnessStatus: metadata.freshness.status,
        notificationAgeMs: metadata.freshness.ageMs,
        detectedAt:
          metadata.freshness.publishedAt ??
          new Date(observedAt).toISOString()
      };
      const key = postKey(candidate);

      candidates.set(
        key,
        NotificationUtils.selectBetterNotificationCandidate(
          candidates.get(key),
          candidate
        )
      );
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

  async function forwardCandidate(candidate, { isStartup = false } = {}) {
    const key = postKey(candidate);
    const retryAt = retryNotBefore.get(key) ?? 0;

    if (
      pendingPosts.has(key) ||
      retryAt > Date.now()
    ) {
      return;
    }

    const decision = NotificationUtils.decideNotificationCandidate({
      isProcessed: processedPosts.has(key),
      isMonitored: monitoredGroupIds.has(candidate.groupId),
      isNewPostNotification: candidate.isNewPostNotification,
      freshnessStatus: candidate.notificationFreshnessStatus,
      isStartup
    });

    if (decision === "duplicate") {
      return;
    }

    if (decision === "unmonitored") {
      console.info(
        `${LOG_PREFIX} Ignored notification ${
          candidate.postId ?? candidate.notificationId
        }; group ` +
        `${candidate.groupId} is not in the monitored list.`
      );
      markProcessed(key);
      return;
    }

    if (decision === "not_new_post") {
      console.info(
        `${LOG_PREFIX} Ignored notification ${
          candidate.postId ?? candidate.notificationId
        }; it is not a new-post alert. Text: ` +
        `"${candidate.notificationText.slice(0, 180)}"`
      );
      markProcessed(key);
      return;
    }

    if (decision === "stale") {
      const ageMinutes = Number.isFinite(candidate.notificationAgeMs)
        ? Math.floor(candidate.notificationAgeMs / 60_000)
        : "at least 50";
      console.info(
        `${LOG_PREFIX} Ignored notification ${
          candidate.postId ?? candidate.notificationId
        }; it is ${ageMinutes} minutes old.`
      );
      markProcessed(key);
      return;
    }

    if (decision === "startup_timestamp_unknown") {
      console.info(
        `${LOG_PREFIX} Ignored existing notification ${
          candidate.postId ?? candidate.notificationId
        }; its Facebook timestamp could not be verified.`
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

  function scanNotifications(root = document, options = {}) {
    for (const candidate of collectCandidates(root)) {
      forwardCandidate(candidate, options);
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
      `${monitoredGroupIds.size === 1 ? "group" : "groups"}. Fresh visible ` +
      "new-post notifications will be checked."
    );

    scanNotifications(document, { isStartup: true });
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
