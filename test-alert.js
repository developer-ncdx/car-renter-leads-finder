const host = process.env.SERVER_HOST?.trim() || "127.0.0.1";
const port = process.env.SERVER_PORT?.trim() || "8787";
const formattedHost = host.includes(":") ? `[${host}]` : host;
const alertType = process.argv.includes("--job")
  ? "job"
  : "rental";
const endpoint =
  `http://${formattedHost}:${port}/test-${alertType === "job" ? "job-" : ""}` +
  "alert";

try {
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(20_000)
  });
  const result = await response.json();

  if (!response.ok || result.ok !== true) {
    throw new Error(
      result.error || `Local service returned HTTP ${response.status}`
    );
  }

  console.info(
    `${alertType} Telegram test alert sent successfully ` +
    `(message ${result.telegramMessageId}).`
  );
} catch (error) {
  console.error(`Telegram test alert failed: ${error.message}`);
  process.exitCode = 1;
}
