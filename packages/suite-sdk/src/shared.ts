// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import {
  classifyIpLiteral,
  DEFAULT_HOSTNAME_DENYLIST,
  isDeniedHostname,
  isPublicAddress,
  isWithinPodScope,
  normalizeHostForClassification,
} from "@jeswr/guarded-fetch";
import {
  createInboxReader,
  type InboxNotification,
  type InboxReaderOptions,
  notificationKind,
} from "@jeswr/pod-access/notify";

import { isOwnPodIri, podScopedFetch } from "./pod-scoped-fetch.js";
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
  /**
   * An inbox notification named this resource, so nothing verifies it. The flag survives every
   * merge (even with a record that the user opened it): such an item is only ever previewed.
   */
  announced?: boolean;
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

const PRIVATE_NAME_SUFFIXES = [".local", ".localhost", ".localdomain", ".lan", ".home.arpa"];

/**
 * A resource an unverified sender may point the session at: `https:`, no credentials, and a host
 * that is not a loopback/private/link-local address, a single-label or LAN name, or a
 * cloud-internal name. Judged by name and IP literal only (no DNS), with guarded-fetch's own
 * classifiers; a name that resolves privately is still the transport's concern.
 */
export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = normalizeHostForClassification(url.hostname.toLowerCase().replace(/\.$/, ""));
    if (classifyIpLiteral(host) !== 0) return isPublicAddress(host, false);
    return (
      host.includes(".") &&
      host !== "localhost" &&
      !PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix)) &&
      !isDeniedHostname(host, DEFAULT_HOSTNAME_DENYLIST)
    );
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

/** Same bound as the Requests listing (`listRequests`' MAX_MEMBERS). */
export const SHARED_INBOX_LIMIT = 100;

/** The session transports an inbox read may use; credentials never leave `storageUrl`. */
export interface InboxTransportOptions extends Pick<InboxReaderOptions, "fetch" | "pinningFetch"> {
  /** The user's storage: the only place the session's credentials are sent. */
  storageUrl: string;
  /** Credential-free reads of a profile hosted outside the storage (the session's, when it has one). */
  publicFetch?: typeof fetch;
}

/**
 * Credentials only inside `storageUrl` (`podScopedFetch`, redirects refused); everything else,
 * such as a WebID document hosted elsewhere, is read without credentials, through `publicFetch`
 * when the session has one.
 */
function confineTransport(transport: typeof fetch, options: InboxTransportOptions): typeof fetch {
  const own = podScopedFetch(transport, options.storageUrl);
  const publicFetch = options.publicFetch;
  if (!publicFetch) return own;
  return (input, init) =>
    isOwnPodIri(new Request(input).url, options.storageUrl)
      ? own(input, init)
      : publicFetch(input, { ...init, credentials: "omit" });
}

export interface ShareNotificationUrlsOptions extends InboxTransportOptions {
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
 * another purpose therefore re-reads only the members it could not place. An inbox outside
 * `storageUrl` is never read (nothing is recognised), and a profile outside it is read
 * credential-free.
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
      return confineTransport(transport, options)(input, init);
    };
  const reader = createInboxReader({
    fetch: only(options.fetch),
    ...(options.pinningFetch ? { pinningFetch: only(options.pinningFetch) } : {}),
    maxItems: options.maxItems ?? SHARED_INBOX_LIMIT,
  });
  options.signal?.throwIfAborted();
  const discovered = options.inbox ?? (await reader.inbox(options.webId));
  // Discovery reports failures, aborts included, as "no inbox": an abort still rejects here.
  options.signal?.throwIfAborted();
  if (!discovered || !isOwnPodIri(discovered, options.storageUrl)) return new Set();
  inbox = new URL(discovered).href;
  const items = await reader.list(discovered, options.signal ? { signal: options.signal } : {});
  return new Set(
    items.filter((item) => wanted.has(item.url) && isShareNotification(item)).map((n) => n.url),
  );
}

/** Why Shared with me could not read the inbox, as opposed to the inbox holding nothing. */
export type SharedInboxFailure = "network" | "forbidden" | "lws-no-ldn" | "outside-storage";

export type SharedInboxRead =
  /** `truncated`: the inbox holds more than `limit` documents; these are the newest of those read. */
  | { status: "ok"; notifications: InboxNotification[]; truncated: boolean; limit: number }
  /** A readable profile that names no (single) inbox, or an inbox that does not exist. */
  | { status: "none" }
  | { status: "failed"; reason: SharedInboxFailure };

export interface ReadSharedInboxOptions extends InboxTransportOptions {
  webId: string;
  signal?: AbortSignal;
  /** Notifications kept, newest first (default {@link SHARED_INBOX_LIMIT}). */
  maxItems?: number;
}

/**
 * Read the inbox Shared with me lists. Credentials only reach `storageUrl`: the profile is read
 * credential-free when the WebID lives elsewhere, and an inbox outside the storage is refused.
 * A failed read is told apart from an empty inbox, and an inbox larger than the bound is flagged
 * (one extra document is requested to know). An abort through `signal` rejects; any other failure
 * (including a transport's own timeout) is a network failure.
 */
export async function readSharedInbox(options: ReadSharedInboxOptions): Promise<SharedInboxRead> {
  const limit = options.maxItems ?? SHARED_INBOX_LIMIT;
  const profileUrl = (() => {
    try {
      const url = new URL(options.webId);
      url.hash = "";
      return url.href;
    } catch {
      return options.webId;
    }
  })();
  let profile: SharedInboxFailure | "ok" | undefined;
  let container: number | undefined;
  let inbox: string | undefined;
  const members = new Set<string>();
  const observe =
    (transport: typeof fetch): typeof fetch =>
    async (input, init) => {
      options.signal?.throwIfAborted();
      const { url } = new Request(input);
      if (inbox !== undefined && url !== inbox) members.add(url);
      try {
        const response = await confineTransport(transport, options)(input, init);
        if (url === profileUrl)
          profile =
            response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ===
            "application/lws+json"
              ? "lws-no-ldn"
              : response.status === 401 || response.status === 403
                ? "forbidden"
                : response.ok
                  ? "ok"
                  : "network";
        else if (url === inbox) container = response.status;
        return response;
      } catch (error) {
        if (url === profileUrl) profile = "network";
        throw error;
      }
    };
  const reader = createInboxReader({
    fetch: observe(options.fetch),
    ...(options.pinningFetch ? { pinningFetch: observe(options.pinningFetch) } : {}),
    maxItems: limit + 1,
  });
  try {
    options.signal?.throwIfAborted();
    const discovered = await reader.inbox(options.webId);
    options.signal?.throwIfAborted();
    if (!discovered) {
      return profile === undefined || profile === "ok"
        ? { status: "none" }
        : { status: "failed", reason: profile };
    }
    if (!isOwnPodIri(discovered, options.storageUrl))
      return { status: "failed", reason: "outside-storage" };
    inbox = new URL(discovered).href;
    const notifications = await reader.list(
      discovered,
      options.signal ? { signal: options.signal } : {},
    );
    if (container === 404) return { status: "none" };
    return {
      status: "ok",
      notifications: notifications.slice(0, limit),
      truncated: members.size > limit,
      limit,
    };
  } catch {
    options.signal?.throwIfAborted();
    // The inbox reader rejects a 401/403 listing rather than reading it as empty.
    if (container === 401 || container === 403) return { status: "failed", reason: "forbidden" };
    return { status: "failed", reason: "network" };
  }
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
          isWithinPodScope(options.storageUrl, notification.object)) ||
        // An unverified sender never gets the session pointed at http:, a private host or a
        // credentialed URL; the notification is dropped like any other malformed one.
        !isPublicHttpsUrl(notification.object)
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
          announced: true,
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
      ...(previous.announced || item.announced ? { announced: true } : {}),
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
