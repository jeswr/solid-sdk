// AUTHORED-BY Codex GPT-6
/** Decode only at the wire boundary. Projection is NOT signature verification. */
import { DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
import type { JsonObject } from "../core/types.js";
import { assertUniqueKeys } from "./document.js";
export function inspectEvidenceJws(jws: string): { header: JsonObject; payload: JsonObject } {
  if (Buffer.byteLength(jws) > DEFAULT_LIMITS.maxEnvelopeBytes)
    throw new TypeError("Evidence JWS too large");
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
    throw new TypeError("Expected compact JWS evidence");
  const read = (part: string): JsonObject => {
    const bytes = Buffer.from(part, "base64url");
    if (bytes.toString("base64url") !== part)
      throw new TypeError("Noncanonical base64url evidence");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assertUniqueKeys(text);
    const value = parseBoundedJson(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("Expected JWS object");
    return value as JsonObject;
  };
  return { header: read(parts[0]!), payload: read(parts[1]!) };
}

/** The legacy selective/chain bindings contain signed credentials inside an unsigned envelope. */
export function inspectEvidenceEnvelope(
  value: string,
  format: string,
  options: { allowEmpty?: boolean } = {},
): {
  payload: import("../core/types.js").JsonObject | import("../core/types.js").Json[];
  credentials: readonly string[];
} {
  if (!["selective-disclosure+jws", "mandate-chain+jws", "awp-action-intent/0.1"].includes(format))
    throw new TypeError("Unsupported evidence envelope");
  assertUniqueKeys(value);
  const payload = parseBoundedJson(value);
  if (!payload || typeof payload !== "object") throw new TypeError("Expected evidence envelope");
  const credentials: string[] = [];
  function walk(item: unknown): void {
    if (typeof item === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(item)) {
      inspectEvidenceJws(item);
      credentials.push(item);
    } else if (Array.isArray(item)) for (const child of item) walk(child);
    else if (item && typeof item === "object") for (const child of Object.values(item)) walk(child);
  }
  walk(payload);
  if (!credentials.length && format !== "awp-action-intent/0.1" && !options.allowEmpty)
    throw new TypeError("Envelope contains no signed credential");
  return { payload: payload as JsonObject | import("../core/types.js").Json[], credentials };
}
