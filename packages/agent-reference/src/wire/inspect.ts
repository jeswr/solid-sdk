// AUTHORED-BY Codex GPT-6
/** Untrusted diagnostics only. Never use these projections for admission. */

import { DEFAULT_LIMITS } from "../core/limits.js";
import type { AnyMessage, JsonObject } from "../core/types.js";
import { cachedMessage } from "./message-packet.js";

export function decodeJws(jws: string): { header?: JsonObject; payload?: JsonObject } {
  if (typeof jws !== "string" || Buffer.byteLength(jws) > DEFAULT_LIMITS.maxEnvelopeBytes)
    return {};
  const [h, p] = jws.split(".");
  try {
    return {
      header: JSON.parse(Buffer.from(h ?? "", "base64url").toString("utf8")) as JsonObject,
      payload: JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as JsonObject,
    };
  } catch {
    return {};
  }
}

/** Best-effort read of a wire unit's payload WITHOUT verifying it (for display only). */
export function peekWire(wire: unknown): AnyMessage | undefined {
  if (!wire || typeof wire !== "object") return undefined;
  const cached = cachedMessage(wire);
  if (cached) return cached;
  const w = wire as Record<string, unknown>;
  if (w.format === "awp-jsonld/0.1") return undefined;
  try {
    if (typeof w.jws === "string") return decodeJws(w.jws).payload as unknown as AnyMessage;
    if (typeof w.payload === "string") return JSON.parse(w.payload) as AnyMessage;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Decode a legacy statement for inspection, never for authentication or source acceptance. */
export function decodeCompactPayload(jws: string): JsonObject {
  return JSON.parse(
    Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as JsonObject;
}

/** Decode an already bounded adapter response. Protocol/schema checks belong to its caller. */
export function decodeAdapterJson(bytes: string): unknown {
  return JSON.parse(bytes);
}
