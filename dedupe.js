import { createHash } from "node:crypto";

function normalizeFingerprintPart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createLeadContentKey(payload) {
  const fingerprintSource = [
    normalizeFingerprintPart(payload?.leadType),
    normalizeFingerprintPart(payload?.authorName),
    normalizeFingerprintPart(payload?.postText)
  ].join("\u0000");

  return createHash("sha256")
    .update(fingerprintSource)
    .digest("hex");
}

export {
  createLeadContentKey,
  normalizeFingerprintPart
};
