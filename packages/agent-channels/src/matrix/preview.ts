// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { decodeEventContent, ENVELOPE_KEY } from "../envelope.js";
import { ChannelParseError } from "../errors.js";
import {
  exactKeys,
  previewJson,
  previewObject,
  previewText,
  withSignedMessage,
} from "../preview.js";
import { MATRIX_CONTENT } from "../profiles.js";
import type { Wire } from "../types.js";

/**
 * Closed world: plain m.text only (no edits, replies, threads or formatted body). Native
 * rooms also carry the signed envelope to the recipient's agent, so it is shown in full.
 */
export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/json", MATRIX_CONTENT.maxBytes);
  const bridged = "compactJws" in plan;
  exactKeys(plan, ["roomId", "txnId", "content", ...(bridged ? ["compactJws"] : [])], "Matrix");
  const content = previewObject(plan.content);
  exactKeys(content, ["msgtype", "body", ...(bridged ? [] : [ENVELOPE_KEY])], "Matrix content");
  if (content.msgtype !== "m.text")
    throw new ChannelParseError("unsupported Matrix preview content");
  const body = previewText(content.body);
  return bridged
    ? body
    : withSignedMessage(body, decodeEventContent(content), MATRIX_CONTENT.maxBytes);
}
