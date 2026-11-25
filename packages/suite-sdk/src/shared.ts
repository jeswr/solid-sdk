// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import {
  createInboxReader,
  type InboxNotification,
  type InboxReaderOptions,
  notificationKind,
} from "@jeswr/pod-access/notify";

import { isDirectChild, resolveSuiteResource, type SharedApp } from "./resource.js";

export { isDirectChild, resolveSuiteResource, type SharedApp, sharedApps } from "./resource.js";
export interface SharedItem {
  url: string;
  name: string;
  app: SharedApp;
  kind: string;
  /** Sender assertion from the notification, not a verified identity. */
  sharedBy?: string;
  sharedAt?: string;
  role?: string;
  source: "inbox" | "opened" | "app";
  contentType?: string;
  rdfTypes?: readonly string[];
  /** An unverified announcement actor claims a resource outside the actor's apparent pod. */
  fromAnotherPod?: boolean;
}
export interface SharedItemHints {
  url: string;
  name?: string;
  contentType?: string;
  rdfTypes?: readonly string[];
}

/** Never expose credentialed or non-HTTP resource links. No I/O or permission inference. */
export function isSharedItemUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function sharedItemName(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);
  } catch {
    return value;
  }
}

/** Classification is shared with shell search; RDF types use canonical vocabulary IRIs. */
export function classifySharedItem(hints: SharedItemHints): Pick<SharedItem, "app" | "kind"> {
  if (!isSharedItemUrl(hints.url)) return { app: "drive", kind: "file" };
  const { app, kind } = resolveSuiteResource(hints, { encodeRef: (url) => url });
  return { app: app === "contacts" ? "drive" : app, kind };
}

/** Drive's native Docs scope: direct .ttl children of docs/ or legacy pod-docs/. */
export function isSuiteDocsDocument(url: string, storageUrl: string): boolean {
  if (!isSharedItemUrl(url) || !isSharedItemUrl(storageUrl) || !url.endsWith(".ttl")) return false;
  return ["docs/", "pod-docs/"].some((slug) => isDirectChild(url, new URL(slug, storageUrl).href));
}

/** Tolerated sender clock skew; a later `published` claim is not a date at all. */
export const SHARED_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Whether the actor and the resource can be placed in one pod. Different origins never can.
 * On the signed-in user's own host the user's storage depth gives the pod layout, so a
 * path-based multi-pod host compares pod roots, not origins. Elsewhere the layout is unknown
 * and the origin is the only boundary available without I/O.
 */
function sameApparentPod(actor: string, object: string, storageUrl?: string): boolean {
  if (!isSharedItemUrl(actor)) return false;
  const agent = new URL(actor);
  if (agent.origin !== new URL(object).origin) return false;
  if (!storageUrl || !isSharedItemUrl(storageUrl) || new URL(storageUrl).origin !== agent.origin)
    return true;
  const depth = new URL(storageUrl).pathname.split("/").filter(Boolean).length;
  const segments = agent.pathname.split("/");
  // The WebID document must sit inside a container at the storage depth.
  if (segments.length <= depth + 1) return false;
  return isWithinPodScope(
    new URL(`${segments.slice(0, depth + 1).join("/")}/`, agent).href,
    object,
  );
}

/**
 * The suite share Announce shape (`shareNotification`) naming a usable resource link. Whether the
 * resource is inside the user's own storage is not considered: such a notification is still a
 * share, just never "shared with me".
 */
export function isShareNotification(
  notification: InboxNotification,
): notification is InboxNotification & { object: string } {
  return (
    notificationKind(notification) === "share" &&
    notification.object !== undefined &&
    isSharedItemUrl(notification.object)
  );
}

export interface ShareNotificationUrlsOptions
  extends Pick<InboxReaderOptions, "fetch" | "pinningFetch"> {
  /** The inbox owner; the inbox is discovered from this WebID as Shared with me discovers it. */
  webId: string;
  /** The inbox, when the caller already knows it: discovery (and its profile read) is skipped. */
  inbox?: string;
  signal?: AbortSignal;
  /** Direct inbox children considered, in listing order (default 100, `listRequests`' bound). */
  maxItems?: number;
}

/**
 * Which `candidates` (members of the WebID's inbox) are suite share Announces, parsed by the same
 * pod-access inbox reader as Shared with me. Only the profile (unless `inbox` is given), the inbox
 * container and the candidates are requested: once the inbox is known, every other URL is
 * answered locally with 404, which the reader skips. A caller that has already read the inbox for
 * another purpose therefore re-reads only the members it could not place.
 */
export async function shareNotificationUrls(
  candidates: readonly string[],
  options: ShareNotificationUrlsOptions,
): Promise<Set<string>> {
  const wanted = new Set(
    candidates.flatMap((candidate) => (URL.canParse(candidate) ? [new URL(candidate).href] : [])),
  );
  if (!wanted.size) return new Set();
  let inbox: string | undefined;
  const only =
    (transport: typeof fetch): typeof fetch =>
    async (input, init) => {
      options.signal?.throwIfAborted();
      const { url } = new Request(input);
      if (inbox !== undefined && url !== inbox && !wanted.has(url))
        return new Response(null, { status: 404 });
      return transport(input, init);
    };
  const reader = createInboxReader({
    fetch: only(options.fetch),
    ...(options.pinningFetch ? { pinningFetch: only(options.pinningFetch) } : {}),
    maxItems: options.maxItems ?? 100,
  });
  options.signal?.throwIfAborted();
  const discovered = options.inbox ?? (await reader.inbox(options.webId));
  // Discovery reports failures, aborts included, as "no inbox": an abort still rejects here.
  options.signal?.throwIfAborted();
  if (!discovered) return new Set();
  inbox = new URL(discovered).href;
  const items = await reader.list(discovered, options.signal ? { signal: options.signal } : {});
  return new Set(
    items.filter((item) => wanted.has(item.url) && isShareNotification(item)).map((n) => n.url),
  );
}

/**
 * Only the suite share Announce shape; assignments, mentions and invitations stay separate.
 * Resources inside `storageUrl` (the user's own pod) are never "shared with me". A `published`
 * claim later than `now` plus {@link SHARED_CLOCK_SKEW_MS} is dropped, so it can neither pin an
 * item to the top nor outrank a local hide.
 */
export function sharedItemsFromInbox(
  notifications: readonly InboxNotification[],
  options: { storageUrl?: string; now?: number } = {},
): SharedItem[] {
  const latest = (options.now ?? Date.now()) + SHARED_CLOCK_SKEW_MS;
  return mergeSharedItems(
    notifications.flatMap((notification): SharedItem[] => {
      if (
        !isShareNotification(notification) ||
        (options.storageUrl !== undefined &&
          isWithinPodScope(options.storageUrl, notification.object))
      )
        return [];
      const role = notification.summary?.slice("Shared with you as ".length).trim();
      const published = Date.parse(notification.published ?? "");
      return [
        {
          url: notification.object,
          name: notification.content?.trim() || sharedItemName(notification.object),
          ...classifySharedItem({ url: notification.object }),
          ...(notification.actor
            ? {
                sharedBy: notification.actor,
                fromAnotherPod: !sameApparentPod(
                  notification.actor,
                  notification.object,
                  options.storageUrl,
                ),
              }
            : {}),
          ...(Number.isFinite(published) && published <= latest
            ? { sharedAt: notification.published }
            : {}),
          ...(role ? { role } : {}),
          source: "inbox",
        },
      ];
    }),
  );
}

function timestamp(value: string | Date | undefined): number {
  const date = value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(date) ? date : -Infinity;
}

/** Preserve Drive's insertion order for ties and its original NaN comparisons. */
export function latestSharedEntries<T extends { url: string }>(
  entries: readonly T[],
  date: (entry: T) => string | undefined,
): T[] {
  const latest = new Map<string, T>();
  for (const entry of entries) {
    const previous = latest.get(entry.url);
    if (!previous || Date.parse(date(entry) ?? "") >= Date.parse(date(previous) ?? ""))
      latest.set(entry.url, entry);
  }
  return [...latest.values()].sort((a, b) => Date.parse(date(b) ?? "") - Date.parse(date(a) ?? ""));
}

/** Newest metadata wins conflicts; fill missing fields and inferred names/apps from richer sources. */
export function mergeSharedItems(...sources: readonly (readonly SharedItem[])[]): SharedItem[] {
  const entries = sources.flat().filter((item) => isSharedItemUrl(item.url));
  entries.sort(
    (a, b) => timestamp(b.sharedAt) - timestamp(a.sharedAt) || a.url.localeCompare(b.url),
  );
  const merged = new Map<string, SharedItem>();
  for (const item of entries) {
    const previous = merged.get(item.url);
    if (!previous) {
      merged.set(item.url, { ...item });
      continue;
    }
    merged.set(item.url, {
      ...item,
      ...previous,
      // Local app/open metadata outranks every unverified inbox title, regardless of date.
      name:
        previous.source === "inbox" && item.source !== "inbox"
          ? item.name
          : previous.source !== "inbox" && item.source === "inbox"
            ? previous.name
            : previous.name.trim() && previous.name !== sharedItemName(previous.url)
              ? previous.name
              : item.name || previous.name,
      source: previous.source === "inbox" ? item.source : previous.source,
      fromAnotherPod: previous.fromAnotherPod || item.fromAnotherPod,
      ...(previous.app === "drive" && item.app !== "drive"
        ? { app: item.app, kind: item.kind }
        : {}),
      sharedBy: previous.sharedBy || item.sharedBy,
      sharedAt: previous.sharedAt || item.sharedAt,
      role: previous.role || item.role,
    });
  }
  return [...merged.values()];
}

/** Same key scheme as Tasks' per-account Shared with me list. Storage belongs to the app. */
export function sharedAccountKey(webId: string, namespace = "suite.shared.hidden"): string {
  return `${namespace}:${encodeURIComponent(webId)}`;
}

/** A stored list is untrusted. Keep valid entries only, with the last value for each URL. */
export function parseSharedEntries<T extends { url: string }>(
  raw: string | null,
  valid: (value: unknown) => value is T,
): T[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value)
      ? [...new Map(value.filter(valid).map((entry) => [entry.url, entry])).values()]
      : [];
  } catch {
    return [];
  }
}

/** Never carry an in-memory list across sign-out/account changes when storage is unavailable. */
export function sharedItemsForAccount<T>(
  owner: string | undefined,
  snapshot: { owner?: string | undefined; items: readonly T[] },
): readonly T[] {
  return owner && owner === snapshot.owner ? snapshot.items : [];
}
export function removeSharedItem<T extends { url: string }>(items: readonly T[], url: string): T[] {
  return items.filter((item) => item.url !== url);
}
export interface HiddenSharedItem {
  url: string;
  hiddenAt: string;
}
export function hideSharedItem(
  hidden: readonly HiddenSharedItem[],
  url: string,
  hiddenAt = new Date().toISOString(),
): HiddenSharedItem[] {
  return isSharedItemUrl(url) ? [...removeSharedItem(hidden, url), { url, hiddenAt }] : [...hidden];
}
/** A hide outranks the record's own dates, including a `sharedAt` within the clock skew. */
export function sharedHiddenAt(
  item: { sharedAt?: string; openedAt?: string | Date } | undefined,
  now = Date.now(),
): string {
  return new Date(
    Math.max(now, timestamp(item?.sharedAt), timestamp(item?.openedAt)),
  ).toISOString();
}
export function visibleSharedItems<
  T extends { url: string; sharedAt?: string; openedAt?: string | Date },
>(items: readonly T[], hidden: readonly HiddenSharedItem[]): T[] {
  const dates = new Map(hidden.map((item) => [item.url, timestamp(item.hiddenAt)]));
  return items.filter((item) => {
    const hiddenAt = dates.get(item.url);
    return (
      hiddenAt === undefined ||
      Math.max(timestamp(item.sharedAt), timestamp(item.openedAt)) > hiddenAt
    );
  });
}
export function isHiddenSharedItem(value: unknown): value is HiddenSharedItem {
  return (
    isSharedUrlEntry(value) &&
    "hiddenAt" in value &&
    typeof value.hiddenAt === "string" &&
    Number.isFinite(Date.parse(value.hiddenAt))
  );
}
export function isSharedUrlEntry(value: unknown): value is { url: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "url" in value &&
    typeof value.url === "string" &&
    isSharedItemUrl(value.url)
  );
}
