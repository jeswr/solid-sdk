// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { StorageError } from "@jeswr/storage-client";
import { createIntentChannel } from "@jeswr/suite-sdk/offline";
import { ChatClient } from "../lib/client";
import { ChatIoError, dayUrl, isoDate, messageSubject, roomContainer, text } from "../lib/model";

export interface MessageIntent {
  room: string;
  id: string;
  at: string;
  content: string;
}
export function decodeMessageIntent(value: unknown): MessageIntent {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "at,content,id,room"
  )
    throw new Error("Invalid chat intent");
  const input = value as Record<string, unknown>;
  if (
    typeof input.room !== "string" ||
    typeof input.id !== "string" ||
    typeof input.at !== "string" ||
    typeof input.content !== "string"
  )
    throw new Error("Invalid chat intent");
  const at = new Date(input.at);
  if (isoDate(at) !== input.at || roomContainer(input.room) !== input.room)
    throw new Error("Invalid chat intent");
  messageSubject(input.room, at, input.id);
  text(input.content);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024)
    throw new Error("Invalid chat intent");
  return { room: input.room, id: input.id, at: input.at, content: input.content };
}
export const messageChannel = createIntentChannel<MessageIntent>({
  tag: "chat.message-v1",
  destination: (intent) => dayUrl(intent.room, new Date(intent.at)),
  // Chat's day resources have this layout even in joined rooms on another pod.
  matches: (url) =>
    /^https?:\/\//.test(url) && /\/\d{4}\/\d{2}\/\d{2}\.ttl$/.test(new URL(url).pathname),
  decode: decodeMessageIntent,
  async deliver(intent, ctx) {
    const fetch: typeof globalThis.fetch = (input, init) =>
      ctx.fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([ctx.signal, init.signal]) : ctx.signal,
      });
    const client = new ChatClient(fetch, ctx.storage.root, ctx.webId);
    try {
      // The existing facade re-reads and retries once after a 412.
      await client.send(intent.room, intent.content, { id: intent.id, at: new Date(intent.at) });
    } catch (error) {
      ctx.signal.throwIfAborted();
      if (
        error instanceof RdfFetchError &&
        error.status === undefined &&
        error.contentType === undefined &&
        error.code === undefined &&
        error.cause instanceof TypeError
      )
        throw new StorageError("network", {
          url: dayUrl(intent.room, new Date(intent.at)),
          method: "PUT",
        });
      if (error instanceof ChatIoError && error.status === 412)
        throw new StorageError("precondition-failed", {
          url: dayUrl(intent.room, new Date(intent.at)),
          method: "PUT",
          status: 412,
          etag: error.etag,
        });
      throw error;
    }
  },
});
