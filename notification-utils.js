(() => {
  "use strict";

  const PostFreshness = globalThis.FbPostFreshness;

  function normalizeNotificationText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function timestampValuesWithin(element) {
    if (!element) {
      return [];
    }

    const elements = new Set([element]);

    if (element.querySelectorAll) {
      for (const descendant of element.querySelectorAll(
        "span, a, abbr, time, [data-utime], [datetime], [title], [aria-label]"
      )) {
        elements.add(descendant);
      }
    }

    const values = new Set();

    for (const candidate of elements) {
      for (const attribute of [
        "data-utime",
        "datetime",
        "title",
        "aria-label"
      ]) {
        const value = candidate.getAttribute?.(attribute);

        if (value) {
          values.add(value);
        }
      }

      const text = normalizeNotificationText(
        candidate.innerText || candidate.textContent
      );

      if (text && text.length <= 40) {
        values.add(text);
      }
    }

    return [...values];
  }

  function hasTimestampEvidence(element, now = Date.now()) {
    if (!PostFreshness) {
      return false;
    }

    return timestampValuesWithin(element).some(
      (value) => Number.isFinite(PostFreshness.parseTimestamp(value, now))
    );
  }

  function notificationContainerFor(anchor) {
    if (!anchor) {
      return null;
    }

    const candidates = [];
    const seen = new Set();

    function addCandidate(element) {
      if (element && !seen.has(element)) {
        seen.add(element);
        candidates.push(element);
      }
    }

    addCandidate(anchor);
    addCandidate(anchor.closest?.('a[role="link"], [role="link"]'));

    let ancestor = anchor.parentElement;

    for (let depth = 0; ancestor && depth < 6; depth += 1) {
      addCandidate(ancestor);
      ancestor = ancestor.parentElement;
    }

    const timestampContainer = candidates.find((candidate) =>
      hasTimestampEvidence(candidate)
    );

    if (timestampContainer) {
      return timestampContainer;
    }

    return candidates.find((candidate) =>
      isNewPostNotificationText(
        candidate.innerText || candidate.textContent
      )
    ) ?? anchor.parentElement ?? anchor;
  }

  function notificationTextFor(anchor) {
    const container = notificationContainerFor(anchor);

    return normalizeNotificationText(
      container?.innerText ||
      container?.textContent ||
      anchor?.innerText ||
      anchor?.textContent
    ).slice(0, 1000);
  }

  function isNewPostNotificationText(value) {
    return /\b(?:new (?:group )?(?:post|photo)|added (?:a )?new (?:post|photo)|posted (?:anonymously )?(?:in|to)|shared (?:a )?(?:new )?post (?:in|to)|has a new post|may bagong post|bagong post|ngayon sa|nag-post si|nagdagdag (?:si )?.*?\b(?:bagong post|bagong larawan))\b/i
      .test(normalizeNotificationText(value));
  }

  function notificationTimestampValuesFor(anchor) {
    const container = notificationContainerFor(anchor);
    return timestampValuesWithin(container);
  }

  function evaluateNotificationTimestampValues(
    values,
    now = Date.now(),
    maxAgeMs = PostFreshness?.DEFAULT_MAX_AGE_MS
  ) {
    if (!PostFreshness) {
      return {
        status: "unknown",
        publishedAt: null,
        ageMs: null
      };
    }

    const futureToleranceMs = 5 * 60 * 1000;
    const effectiveMaxAgeMs = Number.isFinite(maxAgeMs)
      ? maxAgeMs
      : PostFreshness.DEFAULT_MAX_AGE_MS;
    const timestamps = [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => PostFreshness.parseTimestamp(value, now))
        .filter((value) =>
          Number.isFinite(value) &&
          value > 0 &&
          value <= now + futureToleranceMs
        )
    )];

    if (timestamps.length === 0) {
      return {
        status: "unknown",
        publishedAt: null,
        ageMs: null
      };
    }

    const publishedAtMs = Math.max(...timestamps);
    const ageMs = Math.max(0, now - publishedAtMs);

    return {
      status: ageMs < effectiveMaxAgeMs ? "fresh" : "stale",
      publishedAt: new Date(publishedAtMs).toISOString(),
      ageMs
    };
  }

  function notificationMetadataFor(
    anchor,
    now = Date.now(),
    maxAgeMs = PostFreshness?.DEFAULT_MAX_AGE_MS
  ) {
    const notificationText = notificationTextFor(anchor);
    const freshness = evaluateNotificationTimestampValues(
      notificationTimestampValuesFor(anchor),
      now,
      maxAgeMs
    );

    return {
      notificationText,
      isNewPostNotification:
        isNewPostNotificationText(notificationText),
      freshness
    };
  }

  function decideNotificationCandidate({
    isProcessed = false,
    isMonitored = false,
    isNewPostNotification = false,
    freshnessStatus = "unknown",
    isStartup = false
  } = {}) {
    if (isProcessed) {
      return "duplicate";
    }

    if (!isMonitored) {
      return "unmonitored";
    }

    if (!isNewPostNotification) {
      return "not_new_post";
    }

    if (freshnessStatus === "stale") {
      return "stale";
    }

    if (isStartup && freshnessStatus !== "fresh") {
      return "startup_timestamp_unknown";
    }

    return "process";
  }

  function notificationCandidateScore(candidate) {
    const freshnessScore =
      candidate?.notificationFreshnessStatus === "fresh"
        ? 30
        : candidate?.notificationFreshnessStatus === "stale"
          ? 10
          : 0;

    return (
      (candidate?.isNewPostNotification ? 100 : 0) +
      freshnessScore +
      Math.min(
        normalizeNotificationText(candidate?.notificationText).length,
        1000
      ) / 1000
    );
  }

  function selectBetterNotificationCandidate(current, candidate) {
    if (!current) {
      return candidate;
    }

    return notificationCandidateScore(candidate) >
      notificationCandidateScore(current)
      ? candidate
      : current;
  }

  globalThis.FbNotificationUtils = Object.freeze({
    decideNotificationCandidate,
    evaluateNotificationTimestampValues,
    isNewPostNotificationText,
    normalizeNotificationText,
    notificationMetadataFor,
    notificationTextFor,
    notificationTimestampValuesFor,
    selectBetterNotificationCandidate
  });
})();
