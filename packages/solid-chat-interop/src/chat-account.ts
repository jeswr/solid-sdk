// AUTHORED-BY Codex GPT-6.1-Sol
import { redactSecrets } from "./redact.js";

/** Normalize an optional owner-chosen account label. Diagnostics never contain the label.
 * Returns the identity label before redaction; redact it before storage or disclosure.
 */
export function normalizeChatAccount(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value))
    throw new TypeError("Invalid chat account label");
  const label = value.normalize("NFC").trim();
  if (label.length < 1 || label.length > 64) throw new TypeError("Invalid chat account label");
  return label;
}

/** Redact a validated label; a growing replacement that exceeds 64 characters hides the whole label. */
export function redactChatAccount(value: string): string {
  const label = redactSecrets(value);
  return label.length > 64 ? "[REDACTED]" : label;
}

/** Scope a source-derived conversation ID by its account, keeping absent-account IDs unchanged.
 * Hash the normalized identity before redaction so distinct secret-looking labels stay distinct.
 * Pass the returned ID to ChatWriter.save; get/list return this stored ID for subsequent reads.
 */
export async function chatConversationId(id: string, account?: string): Promise<string> {
  const label = normalizeChatAccount(account);
  if (label === undefined) return id;
  const bytes = new TextEncoder().encode(JSON.stringify(["chat-account-v1", label, id]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
