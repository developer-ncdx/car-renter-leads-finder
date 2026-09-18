import http from "node:http";

import { evaluateLeadEligibility } from "./eligibility.js";
import { evaluateJobEligibility } from "./job-eligibility.js";

const MAX_BODY_BYTES = 64 * 1024;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 10_000;

const RENTAL_SYSTEM_PROMPT = `
You classify Facebook posts for a car-rental operator in the Philippines.

Return is_lead=true only when the post author is actively looking to rent or
hire a car, van, SUV, MPV, or similar road vehicle for their own current or
upcoming trip. The author does not need to explicitly say "with driver".

Understand English, Filipino, Taglish, texting shorthand, misspellings, and
missing punctuation. Search shorthand includes "LF", "L/F", "LF4", "LFR",
and "ISO". Price shorthand includes "HM", "H/M", "LP", "qte", "paquote",
"qoute", "rate", "presyo", "magkano", and "mgkano". Buyer wording also
includes "looking for", "need", "hanap", "naghahanap", "pahanap",
"kailangan", "kelangan", "may avail", "mauupahan", and recommendation
requests such as "reco". Trip details such as vehicle type or capacity, route,
pickup/drop-off, date, and duration can establish buyer intent even when the
opening phrase is abbreviated or missing.

Return false for:
- vehicle owners/operators advertising units, rates, promos, or availability
- "for rent", "accepting bookings", or "PM for rates" supplier posts
- posts listing model years, starting rates, services, renter requirements,
  everyday availability, or instructions to DM for booking
- past-client testimonials, successful-booking posts, delivered-unit updates,
  and recurring daily/weekly/monthly rental packages
- promotional vehicle listings saying "available now", "book early", "secure
  your date", "why you'll love", "with us", "serving you", or "promo"
- people looking for passengers, carpools, drivers to hire, jobs, or vehicles
  for sale
- news, discussions, old stories, or ambiguous posts without buyer intent

Driver preference can be with-driver, self-drive, or omitted; all three can be
leads when the author has explicit rental buyer intent.
`.trim();

const JOB_SYSTEM_PROMPT = `
You classify Facebook posts for a targeted technology-job alert feed.

Return is_lead=true only when an employer, recruiter, founder, or client is
actively advertising a real job, contract, or freelance opening for at least
one of these roles:
- AI engineer, AI developer, AI specialist, ML engineer, or LLM developer
- Bubble.io developer or Bubble developer
- software developer or software engineer
- AI agent developer or AI agent engineer
- agentic developer, engineer, or specialist
- AI-assisted developer or engineer
- automation engineer, automation developer, or automation specialist

Understand English, Filipino, Taglish, abbreviations such as AI, ML, LLM, SWE,
SDE, dev, and engr, and common misspellings.

Return false for:
- candidates looking for work, sharing a resume, or advertising themselves
- agencies or freelancers advertising development or automation services
- courses, bootcamps, webinars, tutorials, and certifications
- general discussions, advice, news, memes, or unrelated job openings
- vague posts without a genuine hiring, contract, or freelance opportunity
`.trim();

function envValue(name) {
  return process.env[name]?.trim() ?? "";
}

function requiredEnv(name) {
  const value = envValue(name);

  if (!value || /^replace_with_/i.test(value)) {
    throw new Error(`${name} is missing or still contains a placeholder`);
  }

  return value;
}

function optionalEnv(name) {
  const value = envValue(name);
  return /^replace_with_/i.test(value) ? "" : value;
}

function parseBooleanEnv(name) {
  const value = envValue(name).toLowerCase();

  if (["true", "1", "yes"].includes(value)) {
    return true;
  }

  if (["false", "0", "no"].includes(value)) {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SERVER_PORT must be an integer between 1 and 65535");
  }

  return port;
}

const config = Object.freeze({
  host: envValue("SERVER_HOST") || "127.0.0.1",
  port: parsePort(envValue("SERVER_PORT") || "8787"),
  telegramToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  telegramChatId: requiredEnv("TELEGRAM_CHAT_ID"),
  telegramJobsToken: optionalEnv("TELEGRAM_JOBS_BOT_TOKEN"),
  telegramJobsChatId: optionalEnv("TELEGRAM_JOBS_CHAT_ID"),
  bypassLlm: parseBooleanEnv("BYPASS_LLM"),
  openAiApiKey: envValue("OPENAI_API_KEY"),
  openAiModel: envValue("OPENAI_MODEL") || "gpt-5.6-luna"
});

if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) {
  throw new Error("SERVER_HOST must remain bound to the local machine");
}

if (!/^-?\d+$/.test(config.telegramChatId)) {
  throw new Error("TELEGRAM_CHAT_ID must be a numeric Telegram chat ID");
}

if (
  config.telegramJobsChatId &&
  !/^-?\d+$/.test(config.telegramJobsChatId)
) {
  throw new Error(
    "TELEGRAM_JOBS_CHAT_ID must be a numeric Telegram chat ID"
  );
}

if (!config.bypassLlm) {
  if (!config.openAiApiKey || /^replace_with_/i.test(config.openAiApiKey)) {
    throw new Error("OPENAI_API_KEY is required when BYPASS_LLM=false");
  }

  if (!config.openAiModel) {
    throw new Error("OPENAI_MODEL is required when BYPASS_LLM=false");
  }
}

const processedPostKeys = new Map();
let processingTail = Promise.resolve();
let queueDepth = 0;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const declaredLength = Number.parseInt(
    request.headers["content-length"] ?? "0",
    10
  );

  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large");
  }

  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "Request body is required");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function sanitizeString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }

  const sanitized = value.trim();

  if (!sanitized) {
    throw new HttpError(400, `${field} must not be empty`);
  }

  if (sanitized.length > maxLength) {
    throw new HttpError(
      400,
      `${field} must not exceed ${maxLength} characters`
    );
  }

  return sanitized;
}

function validateLeadPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Lead payload must be an object");
  }

  const groupId = sanitizeString(value.groupId, "groupId", 32);
  const postId = sanitizeString(value.postId, "postId", 32);
  const authorName = sanitizeString(value.authorName, "authorName", 200);
  const postText = sanitizeString(value.postText, "postText", 20_000);
  const postUrl = sanitizeString(value.postUrl, "postUrl", 2_000);
  const leadType = sanitizeString(value.leadType, "leadType", 16);

  if (!/^\d+$/.test(groupId) || !/^\d+$/.test(postId)) {
    throw new HttpError(400, "groupId and postId must be numeric");
  }

  if (!["rental", "job"].includes(leadType)) {
    throw new HttpError(400, "leadType must be rental or job");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(postUrl);
  } catch {
    throw new HttpError(400, "postUrl must be a valid URL");
  }

  const expectedPath = `/groups/${groupId}/posts/${postId}/`;

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "www.facebook.com" ||
    parsedUrl.pathname !== expectedPath
  ) {
    throw new HttpError(
      400,
      "postUrl must match the supplied Facebook group and post IDs"
    );
  }

  return {
    groupId,
    leadType,
    postId,
    authorName,
    postText,
    postUrl: `https://www.facebook.com${expectedPath}`,
    isExplicitlyAnonymous: value.isExplicitlyAnonymous === true,
    detectedAt:
      typeof value.detectedAt === "string"
        ? value.detectedAt
        : new Date().toISOString()
  };
}

function pruneDedupeCache() {
  const cutoff = Date.now() - DEDUPE_TTL_MS;

  for (const [key, addedAt] of processedPostKeys) {
    if (
      addedAt < cutoff ||
      processedPostKeys.size > MAX_DEDUPE_ENTRIES
    ) {
      processedPostKeys.delete(key);
    }
  }
}

function enqueue(task) {
  queueDepth += 1;

  const result = processingTail.then(task);

  processingTail = result
    .catch(() => undefined)
    .finally(() => {
      queueDepth -= 1;
    });

  return result;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function logTextPreview(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return JSON.stringify(truncate(normalized, 240));
}

async function parseErrorResponse(response) {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const data = await response.json();
    return data?.error?.message || data?.description || fallback;
  } catch {
    return fallback;
  }
}

async function sendTelegramMessage(text, chatId, botToken) {
  if (!chatId || !botToken) {
    throw new Error(
      "Telegram bot or destination is not configured for this lead type"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(15_000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Telegram rejected the message: ${await parseErrorResponse(response)}`
    );
  }

  const result = await response.json();

  if (result.ok !== true) {
    throw new Error(
      `Telegram rejected the message: ${result.description || "unknown error"}`
    );
  }

  return result.result?.message_id ?? null;
}

function formatLeadMessage(payload) {
  const isJob = payload.leadType === "job";
  const title = config.bypassLlm
    ? `🧪 <b>New ${isJob ? "Job" : "Rental"} Post (LLM bypassed)</b>`
    : isJob
      ? "💼 <b>New Targeted Tech Job!</b>"
      : "🚨 <b>New Car Rental Lead!</b>";
  const author = escapeHtml(payload.authorName);
  const postText = escapeHtml(truncate(payload.postText, 3_000));
  const postUrl = escapeHtml(payload.postUrl);

  return [
    title,
    "",
    `<b>${author}</b> posted:`,
    postText,
    "",
    `<a href="${postUrl}">🔗 Open Facebook Post</a>`
  ].join("\n");
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  for (const outputItem of data?.output ?? []) {
    for (const contentItem of outputItem?.content ?? []) {
      if (
        contentItem?.type === "output_text" &&
        typeof contentItem.text === "string"
      ) {
        return contentItem.text;
      }
    }
  }

  return "";
}

async function classifyLead(postText, instructions) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAiModel,
      instructions,
      input: postText,
      store: false,
      reasoning: {
        effort: "minimal"
      },
      max_output_tokens: 300,
      text: {
        format: {
          type: "json_schema",
          name: "lead_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              is_lead: {
                type: "boolean"
              }
            },
            required: ["is_lead"],
            additionalProperties: false
          }
        }
      }
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI rejected classification: ${await parseErrorResponse(response)}`
    );
  }

  const data = await response.json();
  const outputText = extractResponseText(data);

  if (!outputText) {
    const reason = data?.incomplete_details?.reason;
    const detail = reason
      ? ` (${data.status || "incomplete"}: ${reason})`
      : "";

    throw new Error(`OpenAI returned no classification text${detail}`);
  }

  let classification;

  try {
    classification = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI returned invalid classification JSON");
  }

  if (typeof classification.is_lead !== "boolean") {
    throw new Error("OpenAI classification is missing is_lead");
  }

  return classification.is_lead;
}

async function processLead(payload) {
  const isJob = payload.leadType === "job";

  if (
    isJob &&
    (!config.telegramJobsToken || !config.telegramJobsChatId)
  ) {
    throw new Error(
      "TELEGRAM_JOBS_BOT_TOKEN and TELEGRAM_JOBS_CHAT_ID are required " +
      "for job-posting groups"
    );
  }

  const eligibility = isJob
    ? evaluateJobEligibility(payload.postText)
    : evaluateLeadEligibility(payload.postText);

  if (!config.bypassLlm) {
    if (!eligibility.eligible) {
      console.info(
        `[${payload.leadType}] Rejected by rule=${eligibility.reason} ` +
        `group=${payload.groupId} post=${payload.postId} ` +
        `text=${logTextPreview(payload.postText)}`
      );

      return {
        isLead: false,
        telegramSent: false,
        telegramMessageId: null,
        rejectionReason: eligibility.reason
      };
    }
  }

  const isLead = config.bypassLlm
    ? true
    : await classifyLead(
      payload.postText,
      isJob ? JOB_SYSTEM_PROMPT : RENTAL_SYSTEM_PROMPT
    );

  if (!isLead) {
    console.info(
      `[${payload.leadType}] Rejected by GPT group=${payload.groupId} ` +
      `post=${payload.postId} text=${logTextPreview(payload.postText)}`
    );

    return {
      isLead: false,
      telegramSent: false,
      telegramMessageId: null,
      rejectionReason: "gpt_not_lead"
    };
  }

  const telegramChatId = isJob
    ? config.telegramJobsChatId
    : config.telegramChatId;
  const telegramToken = isJob
    ? config.telegramJobsToken
    : config.telegramToken;
  const telegramMessageId = await sendTelegramMessage(
    formatLeadMessage(payload),
    telegramChatId,
    telegramToken
  );

  console.info(
    `[${payload.leadType}] Sent to Telegram group=${payload.groupId} ` +
    `post=${payload.postId}`
  );

  return {
    isLead: true,
    telegramSent: true,
    telegramMessageId
  };
}

async function handleLeadRequest(request, response) {
  const payload = validateLeadPayload(await readJson(request));
  const dedupeKey =
    `${payload.leadType}:${payload.groupId}:${payload.postId}`;

  pruneDedupeCache();

  if (processedPostKeys.has(dedupeKey)) {
    sendJson(response, 200, {
      ok: true,
      duplicate: true,
      isLead: null,
      telegramSent: false
    });
    return;
  }

  processedPostKeys.set(dedupeKey, Date.now());

  try {
    const result = await enqueue(() => processLead(payload));

    sendJson(response, 200, {
      ok: true,
      duplicate: false,
      ...result
    });
  } catch (error) {
    processedPostKeys.delete(dedupeKey);
    throw error;
  }
}

async function handleTestAlert(response, leadType = "rental") {
  const isJob = leadType === "job";
  const chatId = isJob
    ? config.telegramJobsChatId
    : config.telegramChatId;
  const botToken = isJob
    ? config.telegramJobsToken
    : config.telegramToken;
  const messageId = await enqueue(() =>
    sendTelegramMessage(
      [
        `🧪 <b>Live ${isJob ? "Job Post" : "Car Rental Lead"} Observer</b>`,
        "",
        `The local ${isJob ? "job" : "rental"} Telegram bridge is working.`
      ].join("\n"),
      chatId,
      botToken
    )
  );

  console.info(`[test] ${leadType} Telegram test alert sent`);
  sendJson(response, 200, {
    ok: true,
    telegramSent: true,
    telegramMessageId: messageId
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${config.host}:${config.port}`
  );

  try {
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        bypassLlm: config.bypassLlm,
        model: config.bypassLlm ? null : config.openAiModel,
        queueDepth,
        dedupeEntries: processedPostKeys.size,
        jobsTelegramConfigured: Boolean(
          config.telegramJobsToken && config.telegramJobsChatId
        )
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/test-alert") {
      await handleTestAlert(response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/test-job-alert"
    ) {
      await handleTestAlert(response, "job");
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/leads") {
      await handleLeadRequest(request, response);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: "Not found"
    });
  } catch (error) {
    const statusCode = error instanceof HttpError
      ? error.statusCode
      : 502;

    console.error(
      `[server] ${request.method} ${requestUrl.pathname} failed:`,
      error.message
    );

    sendJson(response, statusCode, {
      ok: false,
      error: error.message
    });
  }
});

server.on("error", (error) => {
  console.error("[server] Fatal server error:", error.message);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  console.info(
    `[server] Listening on http://${config.host}:${config.port} ` +
    `(BYPASS_LLM=${config.bypassLlm})`
  );
});

function shutdown(signal) {
  console.info(`[server] Received ${signal}; shutting down`);
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
