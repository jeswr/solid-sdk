// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { previewBytes, signedMessage } from "../preview.js";
import { DIRECT } from "../profiles.js";
import type { Wire } from "../types.js";
import { readEnvelope } from "./shared.js";

/**
 * Native direct carriage has no human-visible text: the recipient agent reads the signed
 * message itself. The preview is that message, as canonical JSON decoded from the JWS
 * payload (with the shared invisible-character refusal), so the owner approves exactly
 * what is sent.
 */
export async function preview(wire: Wire): Promise<string> {
  const { compactJws } = readEnvelope(previewBytes(wire, "application/ld+json", DIRECT.maxBytes));
  return signedMessage(compactJws, DIRECT.maxBytes);
}
