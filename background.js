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

  const monitoredGroupIds = await GroupConfig.loadGroupIds();

  if (!monitoredGroupIds.includes(senderGroupId)) {
    return {
      ok: false,
      error: `Facebook group ${senderGroupId} is not in the monitored list`
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
    const groupIds = await GroupConfig.loadGroupIds();
    console.info(
      `[Lead Bridge] Ready with ${groupIds.length} monitored ` +
      `${groupIds.length === 1 ? "group" : "groups"}; forwarding posts to ` +
      `${LOCAL_SERVICE_URL}/leads`
    );
  } catch (error) {
    console.error(
      `[Lead Bridge] Could not initialize monitored groups: ${error.message}`
    );
  }
}

async function initializeInstalledGroups(details) {
  const stored = await chrome.storage.local.get(GroupConfig.STORAGE_KEY);

  if (!Array.isArray(stored[GroupConfig.STORAGE_KEY])) {
    const isLegacyUpgrade =
      details.reason === "update" &&
      /^0\.[0-5]\./.test(details.previousVersion ?? "");
    const initialGroupIds = isLegacyUpgrade
      ? GroupConfig.LEGACY_GROUP_IDS
      : [];

    await GroupConfig.saveGroupIds(initialGroupIds);
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
