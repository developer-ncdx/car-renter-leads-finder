(() => {
  "use strict";

  const activeGroupMatch = window.location.pathname.match(
    /^\/groups\/(\d+)(?:\/|$)/
  );

  if (!activeGroupMatch) {
    return;
  }

  const GroupConfig = globalThis.FbGroupConfig;

  if (!GroupConfig) {
    console.error(
      "[Live Car Rental Lead Observer] Group configuration failed to load."
    );
    return;
  }

  const CONFIG = Object.freeze({
    groupId: activeGroupMatch[1],
    scanThrottleMs: 350,
    reconciliationScanMs: 5000,
    extractionDelayMs: 700,
    extractionRetryMs: 1000,
    maxExtractionAttempts: 4,
    extractionFailureRetryMs: 30_000,
    deliveryRetryMs: 10_000,
    storageKey: `processedPosts:v4:${activeGroupMatch[1]}`,
    processedTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxStoredPostIds: 1000,
    persistDebounceMs: 1000,
    pillClickMinDelayMs: 3000,
    pillClickMaxDelayMs: 12_000,
    fallbackRefreshMinDelayMs: 60_000,
    fallbackRefreshMaxDelayMs: 120_000,
    fallbackActivityCooldownMs: 60_000
  });

  const LOG_PREFIX = "[Live Car Rental Lead Observer]";
  const TARGET_ROUTE_PATTERN = new RegExp(
    `^/groups/${CONFIG.groupId}(?:/|$)`
  );
  const GROUP_FEED_ROUTE_PATTERN = new RegExp(
    `^/groups/${CONFIG.groupId}/?$`
  );
  const POST_ROUTE_PATTERN = new RegExp(
    `^/groups/${CONFIG.groupId}/(?:posts|permalink)/(\\d+)(?:/|$)`
  );
  const POST_LINK_SELECTOR =
    `a[href*="/groups/${CONFIG.groupId}/posts/"], ` +
    `a[href*="/groups/${CONFIG.groupId}/permalink/"]`;

  const processedPostIds = new Map();
  const pendingPostIds = new Set();
  const expandedPostIds = new Set();
  const retryNotBefore = new Map();

  let scanTimer = null;
  let reconciliationTimer = null;
  let lastPillNoticeAt = 0;
  let persistTimer = null;
  let pillClickPending = false;
  let fallbackRefreshTimer = null;
  let deliveriesInFlight = 0;
  let lastRelevantFeedActivityAt = Date.now();
  let monitoringEnabled = false;
  let observerStarted = false;
  let observerStartPending = false;
  let chronologicalRedirectPending = false;

  async function loadProcessedPosts() {
    const stored = await chrome.storage.local.get(CONFIG.storageKey);
    const entries = stored?.[CONFIG.storageKey];

    if (!entries || typeof entries !== "object") {
      return false;
    }

    const cutoff = Date.now() - CONFIG.processedTtlMs;

    for (const [postId, processedAt] of Object.entries(entries)) {
      if (typeof processedAt === "number" && processedAt >= cutoff) {
        processedPostIds.set(postId, processedAt);
      }
    }

    return processedPostIds.size > 0;
  }

  function persistProcessedPosts() {
    if (persistTimer !== null) {
      return;
    }

    persistTimer = window.setTimeout(() => {
      persistTimer = null;

      const cutoff = Date.now() - CONFIG.processedTtlMs;
      const fresh = [...processedPostIds]
        .filter(([, processedAt]) => processedAt >= cutoff)
        .slice(-CONFIG.maxStoredPostIds);

      chrome.storage.local
        .set({ [CONFIG.storageKey]: Object.fromEntries(fresh) })
        .catch((error) => {
          console.warn(
            `${LOG_PREFIX} Could not save post history: ${error.message}`
          );
        });
    }, CONFIG.persistDebounceMs);
  }

  function markProcessed(postId) {
    if (!processedPostIds.has(postId)) {
      processedPostIds.set(postId, Date.now());
    }

    retryNotBefore.delete(postId);
    persistProcessedPosts();
  }

  function schedulePostRetry(postId, delayMs) {
    const retryAt = Date.now() + delayMs;
    retryNotBefore.set(postId, retryAt);

    window.setTimeout(() => {
      if (retryNotBefore.get(postId) !== retryAt) {
        return;
      }

      retryNotBefore.delete(postId);
      scheduleScan();
    }, delayMs);
  }

  function normalizeInline(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isExpansionLabel(value) {
    const label = normalizeInline(value);

    return (
      /^(?:(?:see|show|view)\s+)(?:more|less)$/i.test(label) ||
      /^(?:tingnan|tumingin)\s+pa$/i.test(label)
    );
  }

  function normalizeMultiline(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => normalizeInline(line))
      .filter((line) => line && !isExpansionLabel(line))
      .join("\n")
      .trim();
  }

  function isTargetGroupRoute() {
    return (
      monitoringEnabled &&
      TARGET_ROUTE_PATTERN.test(window.location.pathname)
    );
  }

  function isGroupFeedRoute() {
    return (
      monitoringEnabled &&
      GROUP_FEED_ROUTE_PATTERN.test(window.location.pathname)
    );
  }

  function enforceChronologicalFeed() {
    if (!isGroupFeedRoute()) {
      return true;
    }

    const url = new URL(window.location.href);

    if (
      url.searchParams.get("sorting_setting")?.toUpperCase() ===
      "CHRONOLOGICAL"
    ) {
      return true;
    }

    if (chronologicalRedirectPending) {
      return false;
    }

    chronologicalRedirectPending = true;
    url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    console.info(
      `${LOG_PREFIX} Switching this monitored feed to New Posts sorting.`
    );
    window.location.replace(url.toString());
    return false;
  }

  function parsePostLink(rawHref) {
    try {
      const url = new URL(rawHref, window.location.origin);
      const match = url.pathname.match(POST_ROUTE_PATTERN);

      if (!match) {
        return null;
      }

      const postId = match[1];

      return {
        postId,
        postUrl:
          `https://www.facebook.com/groups/${CONFIG.groupId}/posts/${postId}/`
      };
    } catch {
      return null;
    }
  }

  function collectPostCandidates(root = document) {
    const anchors = [];

    if (root instanceof Element && root.matches(POST_LINK_SELECTOR)) {
      anchors.push(root);
    }

    if (root instanceof Document || root instanceof DocumentFragment ||
        root instanceof Element) {
      anchors.push(...root.querySelectorAll(POST_LINK_SELECTOR));
    }

    const candidates = new Map();

    for (const anchor of anchors) {
      const parsed = parsePostLink(anchor.getAttribute("href"));

      if (parsed && !candidates.has(parsed.postId)) {
        candidates.set(parsed.postId, { ...parsed, anchor });
      }
    }

    return [...candidates.values()];
  }

  function findPostContainer(anchor) {
    const article = anchor.closest('[role="article"]');

    if (article) {
      return article;
    }

    let current = anchor.parentElement;

    for (let depth = 0; current && depth < 8; depth += 1) {
      if (
        current.matches('[data-pagelet*="FeedUnit"]') ||
        current.querySelector(
          '[data-ad-rendering-role="story_message"], ' +
          '[data-ad-preview="message"], ' +
          '[data-ad-comet-preview="message"]'
        )
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return anchor.parentElement;
  }

  function belongsToPostContainer(element, container) {
    const nearestArticle = element.closest('[role="article"]');
    return !nearestArticle || nearestArticle === container;
  }

  function isLikelyUiText(text) {
    return /^(?:like|comment|share|send|follow|reply|edited|author|group admin|\d+\s+comments?)$/i
      .test(text);
  }

  function extractAuthorName(container, permalinkAnchor) {
    const selectors = [
      '[data-ad-rendering-role="profile_name"]',
      "h2 strong",
      "h3 strong",
      'strong a[role="link"]',
      'a[role="link"] strong',
      "h2",
      "h3"
    ];

    for (const selector of selectors) {
      for (const element of container.querySelectorAll(selector)) {
        if (!belongsToPostContainer(element, container)) {
          continue;
        }

        const name = normalizeInline(element.innerText || element.textContent)
          .replace(
            /\s*[·•]\s*(?:follow|following|i-follow|sinusundan)\s*$/i,
            ""
          )
          .trim();
        const appearsBeforePermalink = Boolean(
          element.compareDocumentPosition(permalinkAnchor) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );

        if (
          appearsBeforePermalink &&
          name.length >= 2 &&
          name.length <= 120 &&
          !isLikelyUiText(name)
        ) {
          return name.split("\n")[0];
        }
      }
    }

    return "Unknown or anonymous member";
  }

  function extractPostText(container, permalinkAnchor, authorName) {
    const directMessageSelectors = [
      '[data-ad-rendering-role="story_message"]',
      '[data-ad-preview="message"]',
      '[data-ad-comet-preview="message"]',
      '[data-testid="post_message"]'
    ];
    const directElements = new Set();

    for (const selector of directMessageSelectors) {
      for (const element of container.querySelectorAll(selector)) {
        if (belongsToPostContainer(element, container)) {
          directElements.add(element);
        }
      }
    }

    const directTexts = [...directElements]
      .sort((left, right) => {
        if (
          left.compareDocumentPosition(right) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) {
          return -1;
        }

        return 1;
      })
      .map((element) =>
        normalizeMultiline(element.innerText || element.textContent)
      )
      .filter((text) => text && text !== authorName);
    const completeDirectTexts = [];

    for (const text of directTexts) {
      if (completeDirectTexts.some((current) => current.includes(text))) {
        continue;
      }

      for (let index = completeDirectTexts.length - 1; index >= 0; index -= 1) {
        if (text.includes(completeDirectTexts[index])) {
          completeDirectTexts.splice(index, 1);
        }
      }

      completeDirectTexts.push(text);
    }

    if (completeDirectTexts.length > 0) {
      return normalizeMultiline(completeDirectTexts.join("\n"));
    }

    const fallbackCandidates = [];

    for (const element of container.querySelectorAll(
      'div[dir="auto"], span[dir="auto"]'
    )) {
      if (
        !belongsToPostContainer(element, container) ||
        element.closest('button, [role="button"]')
      ) {
        continue;
      }

      const text = normalizeMultiline(element.innerText || element.textContent);

      if (
        text.length < 2 ||
        text === authorName ||
        isLikelyUiText(normalizeInline(text))
      ) {
        continue;
      }

      const followsPermalink = Boolean(
        permalinkAnchor.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING
      );
      const score =
        text.length +
        (text.split("\n").length - 1) * 20 +
        (followsPermalink ? 40 : 0);

      fallbackCandidates.push({ text, score });
    }

    fallbackCandidates.sort((left, right) => right.score - left.score);
    return fallbackCandidates[0]?.text ?? "";
  }

  function findCandidateByPostId(postId) {
    return collectPostCandidates().find(
      (candidate) => candidate.postId === postId
    ) ?? null;
  }

  function extractPayload(candidate) {
    const container = findPostContainer(candidate.anchor);

    if (!container) {
      return null;
    }

    const authorName = extractAuthorName(container, candidate.anchor);
    const postText = extractPostText(
      container,
      candidate.anchor,
      authorName
    );

    if (!postText) {
      return null;
    }

    const headerText = normalizeInline(
      [...container.querySelectorAll("h2, h3")]
        .map((element) => element.innerText || element.textContent)
        .join(" ")
    );

    return {
      groupId: CONFIG.groupId,
      postId: candidate.postId,
      authorName,
      postText,
      postUrl: candidate.postUrl,
      isExplicitlyAnonymous:
        /\banonymous (?:participant|member|user)\b/i.test(headerText),
      detectedAt: new Date().toISOString()
    };
  }

  function expandPostText(container, postId) {
    if (expandedPostIds.has(postId)) {
      return false;
    }

    const expandControl = [...container.querySelectorAll(
      'button, [role="button"]'
    )].find((element) =>
      isExpansionLabel(
        element.getAttribute("aria-label") ||
        element.innerText ||
        element.textContent
      )
    );

    if (!expandControl) {
      return false;
    }

    expandedPostIds.add(postId);
    expandControl.click();
    return true;
  }

  function emitNewPost(payload) {
    lastRelevantFeedActivityAt = Date.now();

    console.groupCollapsed(
      `${LOG_PREFIX} New post from ${payload.authorName}`
    );
    console.info("NEW_POST", payload);
    console.groupEnd();

    deliveriesInFlight += 1;

    chrome.runtime.sendMessage(
      {
        type: "NEW_POST",
        payload
      },
      (response) => {
        deliveriesInFlight = Math.max(0, deliveriesInFlight - 1);
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          pendingPostIds.delete(payload.postId);
          schedulePostRetry(payload.postId, CONFIG.deliveryRetryMs);
          console.error(
            `${LOG_PREFIX} Local bridge unavailable; post ` +
            `${payload.postId} will be retried: ${runtimeError.message}`
          );
          return;
        }

        if (!response?.ok) {
          pendingPostIds.delete(payload.postId);
          schedulePostRetry(payload.postId, CONFIG.deliveryRetryMs);
          console.error(
            `${LOG_PREFIX} Lead delivery failed; post ${payload.postId} ` +
            "will be retried: " +
            `${response?.error || "unknown error"}`
          );
          return;
        }

        pendingPostIds.delete(payload.postId);
        markProcessed(payload.postId);

        if (response.duplicate) {
          console.info(
            `${LOG_PREFIX} Post ${payload.postId} was already processed.`
          );
        } else if (response.telegramSent) {
          console.info(
            `${LOG_PREFIX} Post ${payload.postId} was sent to Telegram.`
          );
        } else if (response.isLead === false) {
          console.info(
            `${LOG_PREFIX} Eligibility filter rejected post ` +
            `${payload.postId} (${response.rejectionReason || "not a lead"}).`
          );
        }
      }
    );
  }

  function queueExtraction(candidate) {
    if (
      processedPostIds.has(candidate.postId) ||
      pendingPostIds.has(candidate.postId)
    ) {
      return;
    }

    pendingPostIds.add(candidate.postId);
    let attempts = 0;

    const attemptExtraction = () => {
      if (!isTargetGroupRoute()) {
        pendingPostIds.delete(candidate.postId);
        return;
      }

      attempts += 1;

      const currentCandidate = findCandidateByPostId(candidate.postId);

      if (currentCandidate) {
        const container = findPostContainer(currentCandidate.anchor);

        if (
          container &&
          expandPostText(container, candidate.postId) &&
          attempts < CONFIG.maxExtractionAttempts
        ) {
          window.setTimeout(attemptExtraction, 300);
          return;
        }
      }

      const payload = currentCandidate
        ? extractPayload(currentCandidate)
        : null;

      if (payload) {
        emitNewPost(payload);
        return;
      }

      if (attempts < CONFIG.maxExtractionAttempts) {
        window.setTimeout(attemptExtraction, CONFIG.extractionRetryMs);
        return;
      }

      pendingPostIds.delete(candidate.postId);
      schedulePostRetry(
        candidate.postId,
        CONFIG.extractionFailureRetryMs
      );
      console.warn(
        `${LOG_PREFIX} Could not extract post ${candidate.postId}; ` +
        "it remains unprocessed and will be retried."
      );
    };

    window.setTimeout(attemptExtraction, CONFIG.extractionDelayMs);
  }

  function scanForPosts() {
    if (!isTargetGroupRoute() || !enforceChronologicalFeed()) {
      return;
    }

    const now = Date.now();

    collectPostCandidates().forEach((candidate) => {
      if (
        processedPostIds.has(candidate.postId) ||
        pendingPostIds.has(candidate.postId)
      ) {
        return;
      }

      const retryAt = retryNotBefore.get(candidate.postId);

      if (retryAt && retryAt > now) {
        return;
      }

      retryNotBefore.delete(candidate.postId);
      queueExtraction(candidate);
    });
  }

  function scheduleScan() {
    if (scanTimer !== null) {
      return;
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scanForPosts();
    }, CONFIG.scanThrottleMs);
  }

  function startReconciliationScan() {
    if (reconciliationTimer !== null || !isTargetGroupRoute()) {
      return;
    }

    reconciliationTimer = window.setInterval(
      scanForPosts,
      CONFIG.reconciliationScanMs
    );
  }

  function stopReconciliationScan() {
    if (reconciliationTimer === null) {
      return;
    }

    window.clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }

  function isNewPostsPill(element) {
    const label = normalizeInline(
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent
    );

    return (
      /^(?:(?:see|show|view)\s+)?(?:\d+\s+)?new posts?$/i.test(label) ||
      /^(?:tingnan(?:\s+ang)?\s+)?(?:mga\s+)?bagong posts?$/i.test(label)
    );
  }

  function detectNewPostsPill(addedNodes) {
    const buttons = new Set();

    for (const node of addedNodes) {
      const element = node instanceof Element
        ? node
        : node.parentElement;

      if (!element) {
        continue;
      }

      const closestButton = element.closest('button, [role="button"]');

      if (closestButton) {
        buttons.add(closestButton);
      }

      for (const button of element.querySelectorAll(
        'button, [role="button"]'
      )) {
        buttons.add(button);
      }
    }

    const pill = [...buttons].find(isNewPostsPill);

    if (pill && Date.now() - lastPillNoticeAt > 5000) {
      lastPillNoticeAt = Date.now();
      lastRelevantFeedActivityAt = Date.now();
      clickNewPostsPill(pill);
    }
  }

  function clickNewPostsPill(pill) {
    if (
      !isTargetGroupRoute() ||
      pillClickPending
    ) {
      return;
    }

    pillClickPending = true;

    const spread = CONFIG.pillClickMaxDelayMs - CONFIG.pillClickMinDelayMs;
    const delay = CONFIG.pillClickMinDelayMs +
      Math.floor(Math.random() * spread);

    console.info(
      `${LOG_PREFIX} Facebook displayed a new-posts button; ` +
      `clicking it in ${Math.round(delay / 1000)}s without refreshing.`
    );

    window.setTimeout(() => {
      pillClickPending = false;

      if (!pill.isConnected || !isTargetGroupRoute()) {
        return;
      }

      // Detection is limited to the top of the feed, so return there first.
      window.scrollTo({ top: 0, behavior: "smooth" });
      pill.click();
      console.info(`${LOG_PREFIX} Clicked the new-posts button.`);
    }, delay);
  }

  function hasFocusedEditor() {
    const activeElement = document.activeElement;

    if (!(activeElement instanceof Element)) {
      return false;
    }

    return Boolean(
      activeElement.closest(
        'input, textarea, [contenteditable="true"], [role="textbox"]'
      )
    );
  }

  function scheduleFallbackRefresh() {
    if (fallbackRefreshTimer !== null || !isGroupFeedRoute()) {
      return;
    }

    const spread =
      CONFIG.fallbackRefreshMaxDelayMs -
      CONFIG.fallbackRefreshMinDelayMs;
    const delay =
      CONFIG.fallbackRefreshMinDelayMs +
      Math.floor(Math.random() * (spread + 1));

    console.info(
      `${LOG_PREFIX} Fallback refresh scheduled in ` +
      `${Math.round(delay / 1000)} seconds.`
    );

    fallbackRefreshTimer = window.setTimeout(() => {
      fallbackRefreshTimer = null;

      if (!isGroupFeedRoute()) {
        return;
      }

      const feedWasRecentlyActive =
        Date.now() - lastRelevantFeedActivityAt <
        CONFIG.fallbackActivityCooldownMs;
      const shouldPostpone =
        feedWasRecentlyActive ||
        pendingPostIds.size > 0 ||
        deliveriesInFlight > 0 ||
        pillClickPending ||
        hasFocusedEditor();

      if (shouldPostpone) {
        console.info(
          `${LOG_PREFIX} Fallback refresh postponed because the feed ` +
          "is active or the page is being used."
        );
        scheduleFallbackRefresh();
        return;
      }

      console.info(
        `${LOG_PREFIX} No recent live-feed update; performing the ` +
        "conservative fallback refresh."
      );
      window.location.reload();
    }, delay);
  }

  function logReady() {
    console.info(
      `${LOG_PREFIX} Ready. Every unseen post loaded in this monitored ` +
      "tab will be sent for eligibility checking."
    );
    startReconciliationScan();
    scheduleFallbackRefresh();
  }

  function startObserver(hasStoredHistory) {
    if (!isTargetGroupRoute()) {
      return;
    }

    observerStarted = true;

    if (hasStoredHistory) {
      console.info(
        `${LOG_PREFIX} Restored ${processedPostIds.size} processed post IDs.`
      );
    } else {
      console.info(
        `${LOG_PREFIX} No processed-post history was found; scanning every ` +
        "post currently loaded by Facebook."
      );
    }

    scanForPosts();

    const observer = new MutationObserver((mutations) => {
      const addedNodes = [];
      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          addedNodes.push(...mutation.addedNodes);
          shouldScan = true;
        } else if (mutation.type === "attributes") {
          shouldScan = true;
        }
      }

      if (addedNodes.length > 0) {
        detectNewPostsPill(addedNodes);
      }

      if (shouldScan) {
        scheduleScan();
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href"]
    });

    logReady();
  }

  async function start() {
    let hasStoredHistory = false;

    try {
      hasStoredHistory = await loadProcessedPosts();
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} Could not read stored post history: ${error.message}`
      );
    }

    if (!monitoringEnabled) {
      return;
    }

    startObserver(hasStoredHistory);
  }

  function applyMonitoringState(groupIds) {
    const shouldMonitor = groupIds.includes(CONFIG.groupId);

    if (!shouldMonitor) {
      if (monitoringEnabled) {
        monitoringEnabled = false;

        if (fallbackRefreshTimer !== null) {
          window.clearTimeout(fallbackRefreshTimer);
          fallbackRefreshTimer = null;
        }

        stopReconciliationScan();

        console.info(
          `${LOG_PREFIX} Monitoring disabled for group ${CONFIG.groupId}.`
        );
      } else if (!observerStarted) {
        console.info(
          `${LOG_PREFIX} Group ${CONFIG.groupId} is not monitored. ` +
          "Add it from the extension popup."
        );
      }

      return;
    }

    if (monitoringEnabled) {
      return;
    }

    monitoringEnabled = true;

    if (!enforceChronologicalFeed()) {
      return;
    }

    if (observerStarted) {
      console.info(
        `${LOG_PREFIX} Monitoring resumed for group ${CONFIG.groupId}.`
      );
      scheduleScan();
      startReconciliationScan();
      scheduleFallbackRefresh();
      return;
    }

    if (observerStartPending) {
      return;
    }

    observerStartPending = true;
    start()
      .catch((error) => {
        console.error(
          `${LOG_PREFIX} Could not start monitoring: ${error.message}`
        );
      })
      .finally(() => {
        observerStartPending = false;
      });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const groupChange = changes[GroupConfig.STORAGE_KEY];

    if (areaName !== "local" || !groupChange) {
      return;
    }

    applyMonitoringState(
      GroupConfig.normalizeGroupIds(groupChange.newValue)
    );
  });

  GroupConfig.loadGroupIds()
    .then(applyMonitoringState)
    .catch((error) => {
      console.error(
        `${LOG_PREFIX} Could not load monitored groups: ${error.message}`
      );
    });
})();
