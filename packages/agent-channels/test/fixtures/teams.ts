// AUTHORED-BY Codex GPT-6.1-Sol
import { createGraphTeamsReader } from "../../src/graph-teams.js";
import { RecordingTokenProvider } from "../../src/testing.js";
import { fixtureTransport } from "./graph.js";
import { account } from "./signed.js";

export const chat = "19:chat@thread.v2";
export const path = `/me/chats/${encodeURIComponent(chat)}/messages`;
export const base = "https://graph.microsoft.com/v1.0";
export const bounds = { maxItems: 100, maxBytes: 1024 * 1024 };
export const page = (value: unknown[] = [], next?: string) => ({
  value,
  ...(next ? { "@odata.nextLink": next } : {}),
});
export function row(extra: Record<string, unknown> = {}) {
  return {
    id: "1",
    messageType: "message",
    deletedDateTime: null,
    replyToId: null,
    from: { user: { id: "sender-id", displayName: "Display Name" } },
    createdDateTime: "2026-10-26T11:59:00Z",
    body: { contentType: "html", content: '<p>Hello <at id="0">Display Name</at> &amp; all</p>' },
    ...extra,
  };
}
export function item(extra: Record<string, unknown> = {}, source = path) {
  const message = row(extra);
  const key = source.startsWith("/me/")
    ? `teams:chat:${encodeURIComponent(chat)}`
    : "teams:channel:team:channel";
  return {
    id: `${key}:${encodeURIComponent(message.id as string)}`,
    raw: JSON.stringify({ path: source, message }),
  };
}
export function reader(replies: unknown[], extra: Record<string, unknown> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const config = { tokens, transport: fake.options, ...extra };
  return { ...fake, tokens, config, binding: createGraphTeamsReader(config) };
}
export const cursor = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    account: account.id,
    jobs: [`${base}${path}`],
    pending: [],
    pages: 2,
    ...extra,
  });
