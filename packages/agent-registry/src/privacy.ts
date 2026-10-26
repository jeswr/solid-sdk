// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { createHmac } from "crypto";

/** NFC and trim; preserve Matrix case, otherwise lowercase. Never merge aliases. */
export function normaliseHandle(handle: string, channel?: string): string {
  const normalised = handle.normalize("NFC").trim();
  return channel === "matrix" ? normalised : normalised.toLowerCase();
}
/** HMAC-SHA-256(salt, normalised handle), lowercase hex. Salt must have at least 256 bits. */
export function hashHandle(handle: string, salt: Uint8Array, channel?: string): string {
  const normalised = normaliseHandle(handle, channel);
  if (!(salt instanceof Uint8Array) || salt.byteLength < 32 || !normalised) {
    throw new Error("Invalid handle or daemon salt");
  }
  return createHmac("sha256", salt).update(normalised).digest("hex");
}
/** Domain separation prevents resource ids from revealing registry ids or colliding with handles. */
export function accountId(id: string, salt: Uint8Array): string {
  return hashHandle(`account-id\u0000${id}`, salt);
}
