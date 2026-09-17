(() => {
  "use strict";

  const activeGroupMatch = window.location.pathname.match(
    /^\/groups\/(\d+)(?:\/|$)/
  );

  if (!activeGroupMatch) {
    return;
  }

  const CONFIG = Object.freeze({
    groupId: activeGroupMatch[1],
    bootstrapMs: 5000,
    scanThrottleMs: 350,
    extractionDelayMs: 700,
    extractionRetryMs: 1000,
    maxExtractionAttempts: 4,
    topPostLimit: 20,
    maxWindowScrollY: 1200,
    viewportSlackFactor: 3,
    storageKey: `seenPosts:${activeGroupMatch[1]}`,
    seenTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxStoredIds: 1000,
    persistDebounceMs: 1000,
    catchUpWindowMs: 15_000,
    maxCatchUpEmits: 5,
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

  const seenPostIds = new Map();
  const pendingPostIds = new Set();
  const expandedPostIds = new Set();
  const catchUpUntil = Date.now() + CONFIG.catchUpWindowMs;

  let baselineComplete = false;
  let scanTimer = null;
  let lastPillNoticeAt = 0;
  let persistTimer = null;
  let pillClickPending = false;
  let catchUpEmits = 0;
  let fallbackRefreshTimer = null;
  let deliveriesInFlight = 0;
  let lastRelevantFeedActivityAt = Date.now();

  async function loadSeenPosts() {
    const stored = await chrome.storage.local.get(CONFIG.storageKey);
    const entries = stored?.[CONFIG.storageKey];

    if (!entries || typeof entries !== "object") {
      return false;
    }

    const cutoff = Date.now() - CONFIG.seenTtlMs;

    for (const [postId, firstSeenAt] of Object.entries(entries)) {
      if (typeof firstSeenAt === "number" && firstSeenAt >= cutoff) {
        seenPostIds.set(postId, firstSeenAt);
      }
    }

    return seenPostIds.size > 0;
  }

  function persistSeenPosts() {
    if (persistTimer !== null) {
      return;
    }

    persistTimer = window.setTimeout(() => {
      persistTimer = null;

      const cutoff = Date.now() - CONFIG.seenTtlMs;
      const fresh = [...seenPostIds]
        .filter(([, firstSeenAt]) => firstSeenAt >= cutoff)
        .slice(-CONFIG.maxStoredIds);

      chrome.storage.local
        .set({ [CONFIG.storageKey]: Object.fromEntries(fresh) })
        .catch((error) => {
          console.warn(
            `${LOG_PREFIX} Could not save post history: ${error.message}`
          );
        });
    }, CONFIG.persistDebounceMs);
  }

  function markSeen(postId) {
    if (!seenPostIds.has(postId)) {
      seenPostIds.set(postId, Date.now());
    }

    persistSeenPosts();
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
    return TARGET_ROUTE_PATTERN.test(window.location.pathname);
  }

  function isGroupFeedRoute() {
    return GROUP_FEED_ROUTE_PATTERN.test(window.location.pathname);
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

    for (const selector of directMessageSelectors) {
      for (const element of container.querySelectorAll(selector)) {
        if (!belongsToPostContainer(element, container)) {
          continue;
        }

        const text = normalizeMultiline(element.innerText || element.textContent);

        if (text && text !== authorName) {
          return text;
        }
      }
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
          console.error(
            `${LOG_PREFIX} Local bridge unavailable: ${runtimeError.message}`
          );
          return;
        }

        if (!response?.ok) {
          console.error(
            `${LOG_PREFIX} Lead delivery failed: ` +
            `${response?.error || "unknown error"}`
          );
          return;
        }

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
      seenPostIds.has(candidate.postId) ||
      pendingPostIds.has(candidate.postId)
    ) {
      return;
    }

    pendingPostIds.add(candidate.postId);
    let attempts = 0;

    const attemptExtraction = () => {
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
        pendingPostIds.delete(candidate.postId);
        markSeen(candidate.postId);
        emitNewPost(payload);
        return;
      }

      if (attempts < CONFIG.maxExtractionAttempts) {
        window.setTimeout(attemptExtraction, CONFIG.extractionRetryMs);
        return;
      }

      pendingPostIds.delete(candidate.postId);
      markSeen(candidate.postId);
      console.warn(
        `${LOG_PREFIX} Skipped post ${candidate.postId}; ` +
        "its text was not available after repeated extraction attempts."
      );
    };

    window.setTimeout(attemptExtraction, CONFIG.extractionDelayMs);
  }

  function isCandidateNearFeedTop(candidate, position) {
    if (
      position >= CONFIG.topPostLimit ||
      window.scrollY > CONFIG.maxWindowScrollY
    ) {
      return false;
    }

    const container = findPostContainer(candidate.anchor);

    if (!container) {
      return false;
    }

    const bounds = container.getBoundingClientRect();

    return (
      bounds.bottom >= 0 &&
      bounds.top <= window.innerHeight * CONFIG.viewportSlackFactor
    );
  }

  function scanForPosts() {
    if (!isTargetGroupRoute()) {
      return;
    }

    collectPostCandidates().forEach((candidate, position) => {
      if (
        seenPostIds.has(candidate.postId) ||
        pendingPostIds.has(candidate.postId)
      ) {
        return;
      }

      if (!baselineComplete) {
        markSeen(candidate.postId);
        return;
      }

      if (!isCandidateNearFeedTop(candidate, position)) {
        // Posts far down the feed are virtualized history, not new arrivals.
        markSeen(candidate.postId);
        return;
      }

      // Limit the initial catch-up so a long absence cannot flood Telegram.
      if (Date.now() < catchUpUntil) {
        if (catchUpEmits >= CONFIG.maxCatchUpEmits) {
          markSeen(candidate.postId);
          return;
        }

        catchUpEmits += 1;
      }

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
    if (pillClickPending || !baselineComplete) {
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
      `${LOG_PREFIX} Ready. Keep this group tab sorted by New Posts ` +
      "and near the top of the feed."
    );
    scheduleFallbackRefresh();
  }

  function startObserver(hasStoredHistory) {
    if (!isTargetGroupRoute()) {
      return;
    }

    if (hasStoredHistory) {
      baselineComplete = true;
      console.info(
        `${LOG_PREFIX} Restored ${seenPostIds.size} known posts. ` +
        "Skipping the baseline so posts missed while away are still sent."
      );
    } else {
      console.info(
        `${LOG_PREFIX} First run for this group: starting a ` +
        `${CONFIG.bootstrapMs / 1000}-second baseline. ` +
        "Posts already on screen will not be emitted."
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

    if (baselineComplete) {
      logReady();
      return;
    }

    window.setTimeout(() => {
      scanForPosts();
      baselineComplete = true;
      logReady();
    }, CONFIG.bootstrapMs);
  }

  async function start() {
    let hasStoredHistory = false;

    try {
      hasStoredHistory = await loadSeenPosts();
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} Could not read stored post history: ${error.message}`
      );
    }

    startObserver(hasStoredHistory);
  }

  start();
})();
