importScripts("group-config.js");

const LOCAL_SERVICE_URL = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = 45_000;
const GroupConfig = globalThis.FbGroupConfig;

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

  return forwardLead(message.payload);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NEW_POST") {
    return false;
  }

  handleNewPost(message, sender)
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

async function initializeInstalledGroups(details) {
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
