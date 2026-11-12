// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import { ChannelParseError } from "../errors.js";
import { previewJson, previewObject, previewText } from "../preview.js";
import { TEAMS_CARD } from "../profiles.js";
import type { Wire } from "../types.js";
import { CARD_TYPE } from "./card.js";

export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/vnd.jeswr.teams-message+json", TEAMS_CARD.maxBytes);
  const attachments = previewObject(plan.request).attachments;
  if (!Array.isArray(attachments) || attachments.length !== 1)
    throw new ChannelParseError("unsupported Teams preview attachments");
  const attachment = previewObject(attachments[0]);
  if (attachment.contentType !== CARD_TYPE || typeof attachment.content !== "string")
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
  if (card.type !== "AdaptiveCard" || !Array.isArray(card.body) || card.body.length === 0)
    throw new ChannelParseError("unsupported Teams preview body");
  return card.body
    .map((value) => {
      const block = previewObject(value);
      if (
        block.type !== "TextBlock" ||
        Object.keys(block).some((key) => !["type", "text", "wrap"].includes(key))
      )
        throw new ChannelParseError("unsupported Teams preview block");
      return previewText(block.text);
    })
    .join("\n");
}
