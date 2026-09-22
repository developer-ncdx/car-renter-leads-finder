importScripts("group-config.js");

const LOCAL_SERVICE_URL = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = 45_000;
const NOTIFICATION_EXTRACTION_TIMEOUT_MINUTES = 3;
const MAX_NOTIFICATION_EXTRACTION_TABS = 2;
const NOTIFICATION_DEDUPE_TTL_MS = 30 * 60 * 1000;
const NOTIFICATION_ALARM_PREFIX = "notification-extraction:";
const NOTIFICATION_SESSION_PREFIX = "notificationExtractionTab:";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const GroupConfig = globalThis.FbGroupConfig;
const notificationExtractionTabs = new Map();
const recentlyOpenedNotificationPosts = new Map();

let notificationOpenChain = Promise.resolve();

async function readResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Local service returned an invalid response");
  }
}

async function forwardLead(payload) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const result = await readResponse(response);

  if (!response.ok || result.ok !== true) {
    throw new Error(
      result.error || `Local service returned HTTP ${response.status}`
    );
  }

  return result;
}

async function handleNewPost(message, sender) {
  const senderGroupId = GroupConfig.parseGroupId(sender.tab?.url);
  const payloadGroupId = String(message.payload?.groupId ?? "");

  if (!senderGroupId || senderGroupId !== payloadGroupId) {
    return {
      ok: false,
      error: "Rejected message from an unexpected Facebook group page"
    };
  }

  const monitoredGroups = await GroupConfig.loadGroups();
  const monitoredGroup = monitoredGroups.find(
    (group) => group.id === senderGroupId
  );

  if (!monitoredGroup) {
    return {
      ok: false,
      error: `Facebook group ${senderGroupId} is not in the monitored list`
    };
  }

  if (message.payload?.leadType !== monitoredGroup.type) {
    return {
      ok: false,
      error: `Facebook group ${senderGroupId} has a mismatched lead type`
    };
  }

  const extractionState = sender.tab?.id
    ? await getNotificationExtractionState(sender.tab.id)
    : null;
  const extractionUrlDetails = notificationExtractionDetails(sender.tab?.url);
  const isNotificationExtraction = Boolean(
    extractionState || extractionUrlDetails
  );
  const expectedNotificationPostId =
    extractionState?.postId ?? extractionUrlDetails?.postId ?? null;

  if (
    expectedNotificationPostId &&
    expectedNotificationPostId !== String(message.payload?.postId ?? "")
  ) {
    return {
      ok: false,
      error: "Temporary tab returned an unexpected Facebook post"
    };
  }

  if (extractionState && !extractionState.postId) {
    extractionState.postId = String(message.payload?.postId ?? "");
    await saveNotificationExtractionState(sender.tab.id, extractionState);
  }

  let result;

  try {
    result = await forwardLead(message.payload);
  } catch (error) {
    if (isNotificationExtraction) {
      await sendNotificationResult({
        status: "failed",
        groupId: payloadGroupId,
        postId: String(message.payload?.postId ?? ""),
        leadType: String(message.payload?.leadType ?? ""),
        error: error.message
      });

      if (sender.tab?.id) {
        setTimeout(() => {
          closeNotificationExtractionTab(sender.tab.id).catch(() => {});
        }, 2000);
      }
    }

    throw error;
  }

  if (isNotificationExtraction) {
    await sendNotificationResult({
      status: "completed",
      groupId: payloadGroupId,
      postId: String(message.payload?.postId ?? ""),
      leadType: String(message.payload?.leadType ?? ""),
      authorName: String(message.payload?.authorName ?? ""),
      ...result
    });
  }

  if (
    sender.tab?.id &&
    isNotificationExtraction
  ) {
    setTimeout(() => {
      closeNotificationExtractionTab(sender.tab.id).catch(() => {});
    }, 2000);
  }

  return result;
}

function isFacebookNotificationsUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (
        hostname === "facebook.com" ||
        hostname === "www.facebook.com"
      ) &&
      /^\/notifications(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isNotificationExtractionUrl(value) {
  return Boolean(notificationExtractionDetails(value));
}

function notificationExtractionDetails(value) {
  try {
    const url = new URL(value);
    const postId = url.searchParams.get("lead_observer_post");
    const notificationId = url.searchParams.get(
      "lead_observer_notification"
    );
    const detectedAt = url.searchParams.get("lead_observer_detected_at");
    const detectedAtMs = Date.parse(detectedAt ?? "");

    if (
      url.hostname === "www.facebook.com" &&
      url.searchParams.get("lead_observer_source") === "notification" &&
      (
        /^\d+$/.test(postId ?? "") ||
        /^[a-z0-9_-]{1,200}$/i.test(notificationId ?? "")
      )
    ) {
      return {
        postId: /^\d+$/.test(postId ?? "") ? postId : null,
        notificationId:
          /^[a-z0-9_-]{1,200}$/i.test(notificationId ?? "")
            ? notificationId
            : null,
        notificationDetectedAt:
          Number.isFinite(detectedAtMs)
            ? new Date(detectedAtMs).toISOString()
            : null,
        allowFreshnessFallback:
          url.searchParams.get("lead_observer_fresh") === "1"
      };
    }

    return null;
  } catch {
    return null;
  }
}

function notificationAlarmName(tabId) {
  return `${NOTIFICATION_ALARM_PREFIX}${tabId}`;
}

function notificationSessionKey(tabId) {
  return `${NOTIFICATION_SESSION_PREFIX}${tabId}`;
}

async function saveNotificationExtractionState(tabId, state) {
  const versionedState = {
    ...state,
    extensionVersion: EXTENSION_VERSION
  };

  notificationExtractionTabs.set(tabId, versionedState);

  try {
    await chrome.storage.session.set({
      [notificationSessionKey(tabId)]: versionedState
    });
  } catch {
    // The in-memory map remains available if session storage is unavailable.
  }
}

async function getNotificationExtractionState(tabId) {
  const inMemoryState = notificationExtractionTabs.get(tabId);

  if (inMemoryState) {
    return inMemoryState;
  }

  try {
    const key = notificationSessionKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const state = stored?.[key];

    if (
      state &&
      typeof state === "object" &&
      state.extensionVersion === EXTENSION_VERSION
    ) {
      notificationExtractionTabs.set(tabId, state);
      return state;
    }

    if (state) {
      await chrome.storage.session.remove(key);
    }
  } catch {
    // Fall through when session storage is unavailable.
  }

  return null;
}

async function removeNotificationExtractionState(tabId) {
  notificationExtractionTabs.delete(tabId);

  try {
    await chrome.storage.session.remove(notificationSessionKey(tabId));
  } catch {
    // The state was already removed from memory.
  }
}

async function closeNotificationExtractionTab(tabId) {
  await removeNotificationExtractionState(tabId);
  await chrome.alarms.clear(notificationAlarmName(tabId));

  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The user or browser may already have closed the temporary tab.
  }
}

async function sendNotificationResult(payload) {
  try {
    const notificationTabs = await chrome.tabs.query({
      url: "https://www.facebook.com/notifications*"
    });

    await Promise.allSettled(
      notificationTabs
        .filter((tab) => Number.isInteger(tab.id))
        .map((tab) =>
          chrome.tabs.sendMessage(tab.id, {
            type: "NOTIFICATION_EXTRACTION_RESULT",
            payload
          })
        )
    );
  } catch {
    // Result reporting is informational and must not interrupt processing.
  }
}

function pruneNotificationDedupe() {
  const cutoff = Date.now() - NOTIFICATION_DEDUPE_TTL_MS;

  for (const [key, openedAt] of recentlyOpenedNotificationPosts) {
    if (openedAt < cutoff) {
      recentlyOpenedNotificationPosts.delete(key);
    }
  }
}

async function openNotificationTarget(target) {
  pruneNotificationDedupe();

  const key = target.postId
    ? `${target.groupId}:post:${target.postId}`
    : `${target.groupId}:notification:${target.notificationId}`;

  if (recentlyOpenedNotificationPosts.has(key)) {
    return {
      ok: true,
      duplicate: true
    };
  }

  const extractionTabs = await chrome.tabs.query({
    url: "https://www.facebook.com/groups/*"
  });
  let activeExtractionCount = 0;

  for (const tab of extractionTabs) {
    if (
      !Number.isInteger(tab.id) ||
      (
        !notificationExtractionTabs.has(tab.id) &&
        !isNotificationExtractionUrl(tab.url)
      )
    ) {
      continue;
    }

    const state = await getNotificationExtractionState(tab.id);

    if (state) {
      activeExtractionCount += 1;
    } else {
      await closeNotificationExtractionTab(tab.id);
    }
  }

  if (activeExtractionCount >= MAX_NOTIFICATION_EXTRACTION_TABS) {
    throw new Error(
      "Notification extraction is busy; this post will be retried"
    );
  }

  const extractionUrl = new URL(
    target.postUrl ?? target.notificationUrl
  );
  extractionUrl.searchParams.set(
    "lead_observer_source",
    "notification"
  );

  if (target.postId) {
    extractionUrl.searchParams.set(
      "lead_observer_post",
      target.postId
    );
  } else {
    extractionUrl.searchParams.set(
      "lead_observer_notification",
      target.notificationId
    );
  }

  if (
    target.allowFreshnessFallback === true &&
    Number.isFinite(Date.parse(target.notificationDetectedAt ?? ""))
  ) {
    extractionUrl.searchParams.set("lead_observer_fresh", "1");
    extractionUrl.searchParams.set(
      "lead_observer_detected_at",
      new Date(target.notificationDetectedAt).toISOString()
    );
  }

  const tab = await chrome.tabs.create({
    url: extractionUrl.toString(),
    active: false
  });

  if (!tab.id) {
    throw new Error("Browser did not return a temporary tab ID");
  }

  await saveNotificationExtractionState(tab.id, {
    groupId: target.groupId,
    postId: target.postId ?? null,
    notificationId: target.notificationId ?? null,
    notificationDetectedAt: target.notificationDetectedAt || null,
    allowFreshnessFallback: target.allowFreshnessFallback === true
  });
  recentlyOpenedNotificationPosts.set(key, Date.now());
  chrome.alarms.create(
    notificationAlarmName(tab.id),
    { delayInMinutes: NOTIFICATION_EXTRACTION_TIMEOUT_MINUTES }
  );

  return {
    ok: true,
    opened: true
  };
}

async function handlePostNotification(message, sender) {
  if (!isFacebookNotificationsUrl(sender.tab?.url)) {
    return {
      ok: false,
      error: "Rejected notification from an unexpected Facebook page"
    };
  }

  const parsedPost = GroupConfig.parseGroupPostUrl(
    message.payload?.postUrl
  );
  const parsedNotification = parsedPost
    ? null
    : GroupConfig.parseGroupNotificationUrl(
      message.payload?.notificationUrl
    );
  const parsedTarget = parsedPost ?? parsedNotification;
  const extractionTarget = parsedTarget
    ? {
      ...parsedTarget,
      notificationText: String(message.payload?.notificationText ?? ""),
      notificationDetectedAt: String(message.payload?.detectedAt ?? ""),
      allowFreshnessFallback:
        message.payload?.isNewPostNotification === true
    }
    : null;
  const payloadGroupId = String(message.payload?.groupId ?? "");
  const payloadPostId = String(message.payload?.postId ?? "");
  const payloadNotificationId = String(
    message.payload?.notificationId ?? ""
  );

  if (
    !parsedTarget ||
    parsedTarget.groupId !== payloadGroupId ||
    (
      parsedPost &&
      parsedPost.postId !== payloadPostId
    ) ||
    (
      parsedNotification &&
      parsedNotification.notificationId !== payloadNotificationId
    )
  ) {
    return {
      ok: false,
      error: "Facebook notification contains an invalid group link"
    };
  }

  const monitoredGroups = await GroupConfig.loadGroups();

  if (!monitoredGroups.some((group) => group.id === parsedTarget.groupId)) {
    return {
      ok: false,
      error: `Facebook group ${parsedTarget.groupId} is not monitored`
    };
  }

  const openTask = notificationOpenChain.then(
    () => openNotificationTarget(extractionTarget),
    () => openNotificationTarget(extractionTarget)
  );

  notificationOpenChain = openTask.catch(() => {});
  return openTask;
}

async function handleNotificationExtractionContext(_message, sender) {
  const extractionState = sender.tab?.id
    ? await getNotificationExtractionState(sender.tab.id)
    : null;
  const extractionUrlDetails = notificationExtractionDetails(sender.tab?.url);

  return {
    ok: true,
    isNotificationExtraction: Boolean(
      extractionState || extractionUrlDetails
    ),
    postId:
      extractionState?.postId ?? extractionUrlDetails?.postId ?? null,
    notificationDetectedAt:
      extractionState?.notificationDetectedAt ??
      extractionUrlDetails?.notificationDetectedAt ??
      null,
    allowFreshnessFallback:
      extractionState?.allowFreshnessFallback === true ||
      extractionUrlDetails?.allowFreshnessFallback === true
  };
}

async function handleNotificationExtractionOutcome(message, sender) {
  if (!Number.isInteger(sender.tab?.id)) {
    return {
      ok: false,
      error: "Notification extraction tab is unavailable"
    };
  }

  const extractionState = await getNotificationExtractionState(sender.tab.id);
  const extractionUrlDetails = notificationExtractionDetails(sender.tab.url);

  if (!extractionState && !extractionUrlDetails) {
    return {
      ok: false,
      error: "Rejected outcome from a non-extraction tab"
    };
  }

  const postId =
    extractionState?.postId ?? extractionUrlDetails?.postId ?? null;
  const reportedPostId = String(message.payload?.postId ?? "");

  if (postId && postId !== reportedPostId) {
    return {
      ok: false,
      error: "Temporary tab reported an unexpected Facebook post"
    };
  }

  const status = String(message.payload?.status ?? "");

  if (!["duplicate", "stale", "failed"].includes(status)) {
    return {
      ok: false,
      error: "Temporary tab reported an unsupported outcome"
    };
  }

  const result = {
    status: status === "failed" ? "failed" : status,
    groupId:
      extractionState?.groupId ??
      GroupConfig.parseGroupId(sender.tab.url) ??
      "",
    postId: reportedPostId,
    notificationId: extractionState?.notificationId ?? null,
    duplicate: status === "duplicate",
    isLead: null,
    telegramSent: false,
    error: String(message.payload?.error ?? ""),
    ageMinutes: Number.isFinite(message.payload?.ageMinutes)
      ? message.payload.ageMinutes
      : null
  };

  await sendNotificationResult(result);

  setTimeout(() => {
    closeNotificationExtractionTab(sender.tab.id).catch(() => {});
  }, 500);

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message?.type === "NEW_POST"
    ? handleNewPost
    : message?.type === "NEW_POST_NOTIFICATION"
      ? handlePostNotification
      : message?.type === "GET_NOTIFICATION_EXTRACTION_CONTEXT"
        ? handleNotificationExtractionContext
        : message?.type === "NOTIFICATION_EXTRACTION_OUTCOME"
          ? handleNotificationExtractionOutcome
      : null;

  if (!handler) {
    return false;
  }

  handler(message, sender)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      console.error("[Lead Bridge] Failed to forward post:", error.message);
      sendResponse({
        ok: false,
        error: error.message
      });
    });

  return true;
});

async function handleNotificationExtractionTimeout(tabId) {
  const extractionState = await getNotificationExtractionState(tabId);

  if (extractionState) {
    await sendNotificationResult({
      status: "timed_out",
      groupId: extractionState.groupId,
      postId: extractionState.postId,
      notificationId: extractionState.notificationId
    });
  }

  console.warn(
    `[Lead Bridge] Temporary notification tab ${tabId} timed out; ` +
    "closing it without another automatic request."
  );
  await closeNotificationExtractionTab(tabId);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(NOTIFICATION_ALARM_PREFIX)) {
    return;
  }

  const tabId = Number.parseInt(
    alarm.name.slice(NOTIFICATION_ALARM_PREFIX.length),
    10
  );

  if (Number.isInteger(tabId)) {
    handleNotificationExtractionTimeout(tabId).catch((error) => {
      console.warn(
        `[Lead Bridge] Could not close temporary tab ${tabId}: ` +
        error.message
      );
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeNotificationExtractionState(tabId)
    .then(() => chrome.alarms.clear(notificationAlarmName(tabId)))
    .catch(() => {});
});

async function initialize() {
  try {
    const groups = await GroupConfig.loadGroups();
    console.info(
      `[Lead Bridge] Ready with ${groups.length} monitored ` +
      `${groups.length === 1 ? "group" : "groups"}; forwarding posts to ` +
      `${LOCAL_SERVICE_URL}/leads`
    );
  } catch (error) {
    console.error(
      `[Lead Bridge] Could not initialize monitored groups: ${error.message}`
    );
  }
}

async function closeStaleNotificationExtractionTabs() {
  const groupTabs = await chrome.tabs.query({
    url: "https://www.facebook.com/groups/*"
  });
  const staleTabIds = groupTabs
    .filter((tab) =>
      Number.isInteger(tab.id) &&
      isNotificationExtractionUrl(tab.url)
    )
    .map((tab) => tab.id);

  await Promise.allSettled(
    staleTabIds.map((tabId) => closeNotificationExtractionTab(tabId))
  );
}

async function initializeInstalledGroups(details) {
  await closeStaleNotificationExtractionTabs();

  const stored = await chrome.storage.local.get([
    GroupConfig.STORAGE_KEY,
    GroupConfig.LEGACY_STORAGE_KEY
  ]);
  const hasStoredGroups =
    Array.isArray(stored[GroupConfig.STORAGE_KEY]) ||
    Array.isArray(stored[GroupConfig.LEGACY_STORAGE_KEY]);

  if (!hasStoredGroups) {
    const isLegacyUpgrade =
      details.reason === "update" &&
      /^0\.[0-5]\./.test(details.previousVersion ?? "");
    const initialGroups = isLegacyUpgrade
      ? GroupConfig.LEGACY_GROUP_IDS.map((id) => ({
        id,
        type: GroupConfig.GROUP_TYPES.RENTAL
      }))
      : [];

    await GroupConfig.saveGroups(initialGroups);
  } else {
    await GroupConfig.loadGroups();
  }

  await initialize();
}

chrome.runtime.onInstalled.addListener((details) => {
  initializeInstalledGroups(details).catch((error) => {
    console.error(
      `[Lead Bridge] Could not migrate monitored groups: ${error.message}`
    );
  });
});

initialize();
