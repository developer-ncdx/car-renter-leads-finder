(() => {
  "use strict";

  const DEFAULT_MAX_AGE_MS = 20 * 60 * 1000;
  const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

  const UNIT_MULTIPLIERS = Object.freeze({
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    wk: 7 * 24 * 60 * 60 * 1000,
    wks: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000
  });

  function normalize(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseClockTime(value) {
    const match = value.match(
      /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i
    );

    if (!match) {
      return null;
    }

    let hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2] ?? "0", 10);
    const meridiem = match[3]?.toLowerCase();

    if (hours > (meridiem ? 12 : 23) || minutes > 59) {
      return null;
    }

    if (meridiem === "am" && hours === 12) {
      hours = 0;
    } else if (meridiem === "pm" && hours !== 12) {
      hours += 12;
    }

    return { hours, minutes };
  }

  function parseTimestamp(value, now = Date.now()) {
    const text = normalize(value);

    if (!text) {
      return null;
    }

    if (/^\d{10}$/.test(text)) {
      return Number.parseInt(text, 10) * 1000;
    }

    if (/^\d{13}$/.test(text)) {
      return Number.parseInt(text, 10);
    }

    if (/^(?:just\s+now|now|a\s+moment\s+ago)$/i.test(text)) {
      return now;
    }

    const relativeMatch = text
      .replace(/\s*[·•]\s*(?:edited)?\s*$/i, "")
      .match(
        /^(?:about\s+)?(\d+|an?|one)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|wk|w)(?:\s+ago)?$/i
      );

    if (relativeMatch) {
      const amount = /^\d+$/.test(relativeMatch[1])
        ? Number.parseInt(relativeMatch[1], 10)
        : 1;
      const multiplier =
        UNIT_MULTIPLIERS[relativeMatch[2].toLowerCase()];

      return now - amount * multiplier;
    }

    const dayMatch = text.match(
      /^(today|yesterday)\s+(?:at\s+)?(.+)$/i
    );

    if (dayMatch) {
      const clockTime = parseClockTime(dayMatch[2]);

      if (!clockTime) {
        return null;
      }

      const date = new Date(now);
      date.setSeconds(0, 0);
      date.setHours(clockTime.hours, clockTime.minutes);

      if (dayMatch[1].toLowerCase() === "yesterday") {
        date.setDate(date.getDate() - 1);
      }

      return date.getTime();
    }

    const withoutAt = text.replace(/\s+at\s+/i, " ");

    if (/\b(?:19|20)\d{2}\b/.test(withoutAt)) {
      const parsed = Date.parse(withoutAt);
      return Number.isNaN(parsed) ? null : parsed;
    }

    if (
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
        .test(withoutAt)
    ) {
      const currentYear = new Date(now).getFullYear();
      const parsed = Date.parse(`${withoutAt}, ${currentYear}`);

      if (Number.isNaN(parsed)) {
        return null;
      }

      const date = new Date(parsed);

      if (date.getTime() > now + FUTURE_TOLERANCE_MS) {
        date.setFullYear(currentYear - 1);
      }

      return date.getTime();
    }

    return null;
  }

  function evaluateTimestampValues(
    values,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS
  ) {
    const timestamps = [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => parseTimestamp(value, now))
        .filter((value) =>
          Number.isFinite(value) &&
          value > 0 &&
          value <= now + FUTURE_TOLERANCE_MS
        )
    )];

    if (timestamps.length === 0) {
      return {
        status: "unknown",
        publishedAt: null,
        ageMs: null
      };
    }

    const publishedAtMs = Math.min(...timestamps);
    const ageMs = Math.max(0, now - publishedAtMs);

    return {
      status: ageMs < maxAgeMs ? "fresh" : "stale",
      publishedAt: new Date(publishedAtMs).toISOString(),
      ageMs
    };
  }

  globalThis.FbPostFreshness = Object.freeze({
    DEFAULT_MAX_AGE_MS,
    parseTimestamp,
    evaluateTimestampValues
  });
})();
