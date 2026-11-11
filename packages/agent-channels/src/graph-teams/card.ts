// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson } from "@jeswr/agent-model";
import { decodeEnvelopeObject, encodeEnvelope, encodeEnvelopeObject } from "../envelope.js";
import { ChannelParseError } from "../errors.js";
import { record } from "../graph-mail/rest.js";
import { json } from "./rest.js";

export const CARD_TYPE = "application/vnd.microsoft.card.adaptive";
export function card(text: string, compactJws: string, attachmentId = "agent-envelope") {
  return {
    id: attachmentId,
    contentType: CARD_TYPE,
    content: canonicalJson({
      // biome-ignore lint/style/useNamingConvention: Adaptive Card schema key
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.2",
      body: [{ type: "TextBlock", text, wrap: true }],
      data: { envelope: encodeEnvelopeObject(compactJws) },
    }),
  };
}
/** Detection is by attachment type. Ordinary cards without our data are observations. */
export function envelopes(attachments: unknown): string[] {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 512)
    throw new ChannelParseError("invalid Teams attachments");
  const out: string[] = [];
  for (const attachment of attachments) {
    const row = record(attachment);
    if (row.contentType !== CARD_TYPE) continue;
    if (typeof row.content !== "string") throw new ChannelParseError("invalid Teams card");
    const value = json(row.content);
    if (
      value.type !== "AdaptiveCard" ||
      typeof value.version !== "string" ||
      !Array.isArray(value.body)
    )
      throw new ChannelParseError("invalid Teams card");
    if (value.data === undefined) continue;
    const data = record(value.data);
    if (data.envelope === undefined) continue;
    out.push(encodeEnvelope(decodeEnvelopeObject(data.envelope)));
  }
  if (new Set(out).size > 1) throw new ChannelParseError("conflicting Teams envelopes");
  return [...new Set(out)];
}
