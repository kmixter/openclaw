import { escapeRegExp } from "../utils.js";

export const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
export const IDLE_OK_TOKEN = "IDLE_OK";
export const SILENT_REPLY_TOKEN = "NO_REPLY";

export function isSilentReplyText(
  text: string | undefined,
  token: string = SILENT_REPLY_TOKEN,
): boolean {
  if (!text) {
    return false;
  }
  const escaped = escapeRegExp(token);
  const prefix = new RegExp(`^\\s*${escaped}(?=$|\\W)`);
  if (prefix.test(text)) {
    return true;
  }
  const suffix = new RegExp(`\\b${escaped}\\b\\W*$`);
  return suffix.test(text);
}

/**
 * Detect when the model appended a silent token to real content.
 * Returns the cleaned text (token stripped) if the pattern is found,
 * or null if the text is a legitimate silent-only reply.
 */
export function stripMisusedSilentToken(
  text: string,
  token: string = SILENT_REPLY_TOKEN,
): string | null {
  if (!text) {
    return null;
  }
  const escaped = escapeRegExp(token);
  // Only trigger if the token appears at the end with real content before it.
  const suffix = new RegExp(`\\b${escaped}\\b\\W*$`);
  if (!suffix.test(text)) {
    return null;
  }
  // If the entire text is just the token (with whitespace), it's legitimate.
  const prefix = new RegExp(`^\\s*${escaped}(?=$|\\W)`);
  if (prefix.test(text)) {
    return null;
  }
  // Real content + trailing token: strip the token.
  return text.replace(suffix, "").trimEnd();
}

export function isSilentReplyPrefixText(
  text: string | undefined,
  token: string = SILENT_REPLY_TOKEN,
): boolean {
  if (!text) {
    return false;
  }
  const normalized = text.trimStart().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (!normalized.includes("_")) {
    return false;
  }
  if (/[^A-Z_]/.test(normalized)) {
    return false;
  }
  return token.toUpperCase().startsWith(normalized);
}
