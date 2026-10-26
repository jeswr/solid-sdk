// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { createHmac } from "crypto";

/** Stable normalisation only: Unicode NFC, surrounding whitespace, lowercase; no alias merging. */
export function normaliseHandle(handle: string): string {
  return handle.normalize("NFC").trim().toLowerCase();
}
/** HMAC-SHA-256(salt, normalised handle), lowercase hex. Salt must have at least 256 bits. */
export function hashHandle(handle: string, salt: Uint8Array): string {
  if (!(salt instanceof Uint8Array) || salt.byteLength < 32 || !normaliseHandle(handle)) {
    throw new Error("Invalid handle or daemon salt");
  }
  return createHmac("sha256", salt).update(normaliseHandle(handle)).digest("hex");
}
/** Domain separation prevents resource ids from revealing registry ids or colliding with handles. */
export function accountId(id: string, salt: Uint8Array): string {
  return hashHandle(`account-id\u0000${id}`, salt);
}
