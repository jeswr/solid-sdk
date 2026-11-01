// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes, parseBoundedJson } from "@jeswr/agent-model";
import type { InboundRawMessage } from "../channel.js";
import { ChannelParseError } from "../errors.js";
import type { BridgeMessage } from "../message.js";
import { handle, id, JSON_LIMITS, MAX_RECORD_BYTES, record } from "./rest.js";

export type Source = "notifications" | "conversations";
export function rawId(origin: string, source: Source, row: Record<string, unknown>): string {
  const suffix = source === "conversations" ? `:${id(record(row.last_status).id)}` : "";
  return `${origin}:${source}:${id(row.id)}${suffix}`;
}
function clean(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip hostile control and bidi characters
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
}
function plainText(value: unknown): string {
  if (typeof value !== "string") throw new ChannelParseError("invalid Mastodon text");
  return clean(value).trim();
}
/** A plain-text projection only. No provider markup, attributes or links are followed. */
function htmlText(value: unknown): string {
  if (typeof value !== "string") throw new ChannelParseError("invalid Mastodon text");
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return clean(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => entities[name] as string),
  ).trim();
}
export function parseRecord(origin: string, item: InboundRawMessage): BridgeMessage {
  try {
    const raw = typeof item.raw === "string" ? Buffer.from(item.raw) : item.raw;
    if (raw.byteLength > MAX_RECORD_BYTES)
      throw new ChannelParseError("Mastodon record exceeds cap");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const wrapper = record(parseBoundedJson(text, JSON_LIMITS));
    if (wrapper.source !== "notifications" && wrapper.source !== "conversations")
      throw new ChannelParseError("invalid Mastodon source");
    const source = wrapper.source;
    const row = record(wrapper.row);
    if (item.id !== rawId(origin, source, row)) throw new ChannelParseError("Mastodon id differs");
    const status =
      source === "conversations"
        ? record(row.last_status)
        : row.status == null
          ? undefined
          : record(row.status);
    if (source === "conversations" && status?.visibility !== "direct")
      throw new ChannelParseError("Mastodon conversation is not direct");
    const sender = record(source === "conversations" ? status?.account : row.account);
    const acct = handle(sender.acct);
    const senderHandle = acct.includes("@") ? acct : `${acct}@${new URL(origin).host}`;
    const signals: Record<string, string> = Object.create(null);
    let textBody: string;
    if (source === "notifications") {
      if (typeof row.type !== "string" || !/^[a-z_.]{1,64}$/.test(row.type))
        throw new ChannelParseError("invalid Mastodon notification type");
      signals["mastodon-notification-type"] = row.type;
      textBody = `Mastodon notification: ${row.type}`;
    } else textBody = "";
    if (status) {
      id(status.id);
      if (typeof status.visibility !== "string")
        throw new ChannelParseError("invalid Mastodon visibility");
      signals["mastodon-visibility"] = status.visibility;
      textBody += `${textBody ? "\n" : ""}${plainText(status.spoiler_text ?? "")}${status.spoiler_text ? "\n" : ""}${htmlText(status.content)}`;
    }
    const date = source === "conversations" ? status?.created_at : row.created_at;
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date)))
      throw new ChannelParseError("invalid Mastodon date");
    const threadId =
      source === "conversations"
        ? `${origin}:conversation:${id(row.id)}`
        : status
          ? `${origin}:status:${id(status.in_reply_to_id ?? status.id)}`
          : undefined;
    return {
      channel: "mastodon",
      sender: {
        handle: senderHandle,
        ...(typeof sender.display_name === "string"
          ? { displayName: plainText(sender.display_name) }
          : {}),
      },
      textBody: textBody.slice(0, 16384),
      date: new Date(date).toISOString(),
      messageId: item.id,
      ...(threadId ? { threadId } : {}),
      signals: Object.freeze(signals),
      rawSha256: digestBytes(raw).slice("sha-256:".length),
      rawByteLength: raw.byteLength,
      rawMediaType: "application/json",
      warnings: [],
    };
  } catch {
    throw new ChannelParseError("invalid Mastodon inbound message");
  }
}
