// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { StorageError } from "@jeswr/storage-client";
import { createIntentChannel, type IntentContext } from "@jeswr/suite-sdk/offline";
import { type CalendarEvent, CalendarHttpError } from "../lib/model";
import { decodeEvent, matchesEvent, reviveEventWrite, strongEventEtag } from "./event-write";
import type { EventWrite } from "./repository";
import type { CalendarInfo } from "./view";

export interface EventIntent {
  id: string;
  collection: string;
  name: string;
  write: EventWrite;
  /** Exact preceding local value: permits conditional chains without blind overwrites. */
  after?: CalendarEvent;
}
export function eventIntent(
  write: EventWrite,
  id = crypto.randomUUID(),
  after?: CalendarEvent,
): EventIntent {
  const url = new URL(write.url);
  return {
    id,
    collection: new URL(".", url).href,
    name: url.pathname.split("/").at(-1) as string,
    write,
    ...(after ? { after } : {}),
  };
}
export function eventDestination(intent: EventIntent): string {
  const collection = new URL(intent.collection);
  if (
    !/^https?:$/.test(collection.protocol) ||
    collection.username ||
    collection.password ||
    collection.hash ||
    collection.search ||
    !collection.pathname.endsWith("/") ||
    collection.href !== intent.collection ||
    !intent.name ||
    /[/?#\\]/.test(intent.name)
  )
    throw new TypeError("Invalid event destination");
  const url = new URL(intent.name, collection).href;
  if (
    url !== `${collection.href}${intent.name}` ||
    /%2f|%5c/i.test(intent.name) ||
    url !== intent.write.url
  )
    throw new TypeError("Invalid event destination");
  return url;
}
export function decodeEventIntent(value: unknown): EventIntent {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["id", "collection", "name", "write", "after"].includes(key))
  )
    throw new TypeError("Invalid event intent");
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(raw.id) ||
    typeof raw.collection !== "string" ||
    typeof raw.name !== "string"
  )
    throw new TypeError("Invalid event intent");
  const after = raw.after === undefined ? undefined : decodeEvent(raw.after);
  // An unsent create has no ETag. Its exact predecessor must be confirmed at delivery.
  const input = raw.write as EventWrite;
  const write = reviveEventWrite(
    after && input?.kind !== "create" && input?.etag === ""
      ? { ...input, etag: '"pending"' }
      : input,
  );
  if (after && write.kind === "create") throw new TypeError("Invalid event predecessor");
  if (after && input.kind !== "create" && input.etag === "" && write.kind !== "create")
    write.etag = "";
  const intent = {
    id: raw.id,
    collection: raw.collection,
    name: raw.name,
    write,
    ...(after ? { after } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024)
    throw new TypeError("Invalid event intent size");
  eventDestination(intent);
  return intent;
}
export function createEventChannel(options: {
  storageUrl: string;
  calendars(): readonly CalendarInfo[];
  allowed(write: EventWrite): void;
  send(write: EventWrite, fetch: typeof globalThis.fetch): Promise<unknown>;
  conflict?(error: CalendarHttpError): void;
}) {
  return createIntentChannel<EventIntent>({
    tag: "calendar.event-v1",
    destination: eventDestination,
    matches: (url) =>
      Boolean(podScopedUrl(options.storageUrl, url)) &&
      (Boolean(podScopedUrl(new URL("calendar/", options.storageUrl).href, url)) ||
        options
          .calendars()
          .some((calendar) => calendar.url === url || podScopedUrl(calendar.container, url))),
    decode(value) {
      const intent = decodeEventIntent(value);
      options.allowed(intent.write);
      return intent;
    },
    async deliver(intent, ctx: IntentContext) {
      const fetch: typeof globalThis.fetch = async (input, init) => {
        try {
          return await ctx.fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([ctx.signal, init.signal]) : ctx.signal,
          });
        } catch (error) {
          ctx.signal.throwIfAborted();
          if (error instanceof TypeError) throw new TypeError("Calendar network unavailable");
          throw error;
        }
      };
      let write = intent.write;
      try {
        if (intent.after && write.kind !== "create") {
          let current: Awaited<ReturnType<typeof fetchRdf>> | undefined;
          try {
            current = await fetchRdf(eventDestination(intent), {
              fetch,
              headers: { "Cache-Control": "no-cache" },
            });
          } catch (error) {
            if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
          }
          if (
            !current ||
            !strongEventEtag(current.etag) ||
            !matchesEvent(current, write.url, intent.after)
          ) {
            const error = new CalendarHttpError(412, current?.etag ?? null);
            options.conflict?.(error);
            throw error;
          }
          write = { ...write, etag: current.etag };
        }
        await options.send(write, fetch);
      } catch (error) {
        ctx.signal.throwIfAborted();
        if (error instanceof CalendarHttpError && error.status === 412)
          throw new StorageError("precondition-failed", {
            url: eventDestination(intent),
            method: "PUT",
            status: 412,
            etag: error.etag,
          });
        if (
          (error instanceof TypeError && error.message === "Calendar network unavailable") ||
          (error instanceof RdfFetchError &&
            error.cause instanceof TypeError &&
            error.status === undefined)
        )
          throw new StorageError("network", { url: eventDestination(intent), method: "PUT" });
        throw error;
      }
    },
  });
}
