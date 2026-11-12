// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { canonicalJson, DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { ChannelParseError } from "../errors.js";
import { previewBytes } from "../preview.js";
import { DIRECT } from "../profiles.js";
import type { Wire } from "../types.js";
import { readEnvelope } from "./shared.js";

/**
 * Native direct carriage has no human-visible text: the recipient agent reads the signed
 * message itself. The preview is that message, as canonical JSON decoded from the JWS
 * payload, so the owner approves exactly what is sent.
 */
export async function preview(wire: Wire): Promise<string> {
  const { compactJws } = readEnvelope(previewBytes(wire, "application/ld+json", DIRECT.maxBytes));
  try {
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(compactJws.split(".")[1] as string, "base64url"),
    );
    return canonicalJson(
      parseBoundedJson(payload, {
        ...DEFAULT_LIMITS,
        maxEnvelopeBytes: DIRECT.maxBytes,
        maxStringLength: DIRECT.maxBytes,
      }),
    );
  } catch {
    throw new ChannelParseError("invalid direct preview payload");
  }
}
