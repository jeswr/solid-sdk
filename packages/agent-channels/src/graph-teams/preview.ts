// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { digestBytes } from "@jeswr/agent-model";
import { decodeEnvelopeObject } from "../envelope.js";
import { ChannelParseError } from "../errors.js";
import {
  exactKeys,
  previewJson,
  previewObject,
  previewText,
  withSignedMessage,
} from "../preview.js";
import { TEAMS_CARD } from "../profiles.js";
import type { Wire } from "../types.js";
import { CARD_SCHEMA, CARD_TYPE, htmlFor } from "./card.js";

/**
 * Closed world: one card with one text block, an HTML body that says exactly the same, and
 * the signed envelope (delivered to the recipient's agent), which is shown in full.
 */
export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/vnd.jeswr.teams-message+json", TEAMS_CARD.maxBytes);
  exactKeys(plan, ["account", "chat", "request"], "Teams");
  const request = previewObject(plan.request);
  exactKeys(request, ["body", "attachments"], "Teams request");
  const attachments = request.attachments;
  if (!Array.isArray(attachments) || attachments.length !== 1)
    throw new ChannelParseError("unsupported Teams preview attachments");
  const attachment = previewObject(attachments[0]);
  exactKeys(attachment, ["id", "contentType", "content"], "Teams attachment");
  if (
    attachment.contentType !== CARD_TYPE ||
    typeof attachment.content !== "string" ||
    typeof attachment.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(attachment.id)
  )
    throw new ChannelParseError("unsupported Teams preview card");
  // Nested card JSON needs the same byte, depth, node and string bounds as the outer wire.
  const card = previewJson(
    {
      bytes: attachment.content,
      mediaType: "application/json",
      digest: digestBytes(attachment.content),
    },
    "application/json",
    TEAMS_CARD.maxBytes,
  );
  exactKeys(card, ["$schema", "type", "version", "body", "data"], "Teams card");
  if (
    card.$schema !== CARD_SCHEMA ||
    card.type !== "AdaptiveCard" ||
    card.version !== "1.2" ||
    !Array.isArray(card.body) ||
    card.body.length !== 1
  )
    throw new ChannelParseError("unsupported Teams preview body");
  const block = previewObject(card.body[0]);
  exactKeys(block, ["type", "text", "wrap"], "Teams block");
  if (block.type !== "TextBlock" || block.wrap !== true)
    throw new ChannelParseError("unsupported Teams preview block");
  const text = previewText(block.text);
  const body = previewObject(request.body);
  exactKeys(body, ["contentType", "content"], "Teams body");
  if (body.contentType !== "html" || body.content !== htmlFor(text, attachment.id))
    throw new ChannelParseError("Teams preview body differs from its card");
  const data = previewObject(card.data);
  exactKeys(data, ["envelope"], "Teams card data");
  return withSignedMessage(text, decodeEnvelopeObject(data.envelope), TEAMS_CARD.maxBytes);
}
