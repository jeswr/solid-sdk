// AUTHORED-BY Codex GPT-6
/** Logging projection only. Never use this display projection for verification. */
import { digestOf } from "../core/canonical.js";

function containsPrivate(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPrivate);
  return Object.entries(value).some(
    ([key, child]) =>
      [
        "partial",
        "shares",
        "audit_opening",
        "auditOpening",
        "localPartial",
        "signing_secret",
        "encryption_secret",
      ].includes(key) || containsPrivate(child),
  );
}
export function jointLogView<T>(value: T): T {
  if (typeof value === "string") {
    const parts = value.split(".");
    if (parts.length === 3) {
      try {
        const decoded = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString());
        // Nested evidence can itself be a JWS.
        if (
          containsPrivate(decoded) ||
          JSON.stringify(jointLogView(decoded)) !== JSON.stringify(decoded)
        )
          return `[private joint message ${digestOf(value)}]` as T;
      } catch {
        /* ordinary text */
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(jointLogView) as T;
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (
    "partial" in obj ||
    "shares" in obj ||
    "audit_opening" in obj ||
    "auditOpening" in obj ||
    "localPartial" in obj ||
    "signing_secret" in obj ||
    "encryption_secret" in obj
  )
    return {
      privateJointMessage: true,
      ...(obj.sessionId ? { sessionId: obj.sessionId } : {}),
      digest: digestOf(value),
    } as T;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, jointLogView(v)])) as T;
}
