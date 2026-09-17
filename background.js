const LOCAL_SERVICE_URL = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = 45_000;

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NEW_POST") {
    return false;
  }

  if (!sender.tab?.url?.startsWith("https://www.facebook.com/groups/")) {
    sendResponse({
      ok: false,
      error: "Rejected message from an unexpected page"
    });
    return false;
  }

  forwardLead(message.payload)
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

console.info(
  `[Lead Bridge] Ready; forwarding posts to ${LOCAL_SERVICE_URL}/leads`
);
