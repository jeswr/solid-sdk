// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { ActivityDoc } from "./activity.js";
import { AS, LDP_CONTAINS, RDF_TYPE } from "./vocabulary.js";

/** A notification as a reader consumes it (plain, serialisable — no RDF terms). */
export interface InboxNotification {
  /** The notification resource URL (an inbox child). */
  url: string;
  /** `as:type` local name(s) joined (e.g. "Announce"), or "Notification". */
  type: string;
  /** `as:actor` — sender WebID, if present. */
  actor?: string;
  /** `as:object` IRI, if present. */
  object?: string;
  /** `as:target` IRI, if present. */
  target?: string;
  /** `as:summary`. */
  summary?: string;
  /** `as:content`. */
  content?: string;
  /** `as:published` as an ISO string (serialisable). */
  published?: string;
}

/** Read the `as:type` local names from an AS2.0 activity subject. */
function typeLabel(types: Set<string>): string {
  const locals = [...types]
    .filter((t) => t.startsWith(AS))
    .map((t) => t.slice(AS.length))
    .filter(Boolean);
  return locals.length > 0 ? locals.join(", ") : "Notification";
}

/**
 * True when `url` is a direct child resource of the `container` (same origin, path
 * is one segment deeper, no query/fragment, no encoded slash). Mirrors the Pod
 * Manager's `assertInInbox` scope guard so a crafted listing can never steer a GET
 * onto another origin or out of the container.
 */
export function isDirectChild(url: string, container: string): boolean {
  let parsed: URL;
  let parent: URL;
  try {
    parsed = new URL(url);
    parent = new URL(container);
  } catch {
    return false;
  }
  const containerPath = parent.pathname.endsWith("/") ? parent.pathname : `${parent.pathname}/`;
  if (
    parsed.origin !== parent.origin ||
    !parsed.pathname.startsWith(containerPath) ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return false;
  }
  const rest = parsed.pathname.slice(containerPath.length);
  return rest.length > 0 && !rest.includes("/") && !/%2f/i.test(rest);
}

/**
 * Locate the activity subject IRI within a notification dataset: the first subject
 * carrying an `as:` rdf:type, else the first with an `as:actor`. Falls back to the
 * conventional `${url}#it`. Pure.
 */
export function findActivitySubject(
  url: string,
  dataset: import("@rdfjs/types").DatasetCore,
): string | undefined {
  for (const q of dataset.match(null, DataFactory.namedNode(RDF_TYPE), null)) {
    if (q.object.termType === "NamedNode" && q.object.value.startsWith(AS)) {
      return q.subject.value;
    }
  }
  for (const q of dataset.match(null, DataFactory.namedNode(`${AS}actor`), null)) {
    return q.subject.value;
  }
  const itUrl = `${url}#it`;
  const it = new ActivityDoc(itUrl, dataset, DataFactory);
  if (it.actor || it.summary || it.content) return itUrl;
  return undefined;
}

/**
 * Parse a notification document into an {@link InboxNotification}, or `undefined`
 * if it carries no recognisable AS2.0 activity.
 */
export function parseInboxNotification(
  url: string,
  dataset: import("@rdfjs/types").DatasetCore,
): InboxNotification | undefined {
  const subject = findActivitySubject(url, dataset);
  if (!subject) return undefined;
  const doc = new ActivityDoc(subject, dataset, DataFactory);
  // A missing, untyped or malformed as:published must not hide the notification itself.
  let published: Date | undefined;
  try {
    published = doc.published;
  } catch {
    published = undefined;
  }
  return {
    url,
    type: typeLabel(doc.types),
    ...(doc.actor !== undefined ? { actor: doc.actor } : {}),
    ...(doc.activityObject !== undefined ? { object: doc.activityObject } : {}),
    ...(doc.target !== undefined ? { target: doc.target } : {}),
    ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
    ...(doc.content !== undefined ? { content: doc.content } : {}),
    ...(published !== undefined && !Number.isNaN(published.getTime())
      ? { published: published.toISOString() }
      : {}),
  };
}

/** Extract the direct-child member URLs an inbox container's `ldp:contains` advertises. */
export function containerMembers(
  inboxUrl: string,
  dataset: import("@rdfjs/types").DatasetCore,
): string[] {
  const out = new Set<string>();
  for (const q of dataset.match(null, DataFactory.namedNode(LDP_CONTAINS), null)) {
    if (q.object.termType !== "NamedNode") continue;
    let abs: string;
    try {
      abs = new URL(q.object.value, inboxUrl).toString();
    } catch {
      continue;
    }
    // Confused-deputy guard: only dereference genuine direct children of THIS inbox.
    if (isDirectChild(abs, inboxUrl)) out.add(abs);
  }
  return [...out];
}

/** Order newest first, with undated items last and URL ties deterministic. */
export function sortInboxNotifications(notifications: InboxNotification[]): InboxNotification[] {
  // Newest first; a stable secondary key on url keeps undated items deterministic.
  // ISO-8601 UTC strings are lexicographically ordered, so plain relational compare.
  return notifications.sort((a, b) => {
    const pa = a.published ?? "";
    const pb = b.published ?? "";
    if (pa !== pb) return pa < pb ? 1 : -1; // descending (newest first)
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}
