// AUTHORED-BY Codex GPT-6.1-Sol
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import type { BlankNode, NamedNode } from "@rdfjs/types";
import { LiteralAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { ActivityDoc } from "./activity.js";
import { AS, LDP_CONTAINS, RDF_TYPE } from "./vocabulary.js";

export const READ_SUFFIX = ".read.ttl";

/** Treat encoded sidecar suffixes as reserved too; malformed encodings fail closed. */
export function isReadMarker(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return name.endsWith(READ_SUFFIX);
  } catch {
    return true;
  }
}

/** Auxiliary access/metadata resources are never notification or mutation targets. */
export function isAuxiliaryResource(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)).toLowerCase();
    return (
      name.startsWith(".") || [".acl", ".acr", ".meta"].some((suffix) => name.endsWith(suffix))
    );
  } catch {
    return true;
  }
}

/** A slashless LDP container must not become an unknown notification either. */
export function isInboxContainer(
  url: string,
  dataset: import("@rdfjs/types").DatasetCore,
): boolean {
  return ["Container", "BasicContainer", "DirectContainer", "IndirectContainer"].some(
    (type) =>
      dataset.match(
        DataFactory.namedNode(url),
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(`http://www.w3.org/ns/ldp#${type}`),
      ).size > 0,
  );
}

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
  /** Legacy display name, used when summary and content are absent. */
  name?: string;
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
    !isWithinPodScope(container, url, { allowRoot: false }) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    isAuxiliaryResource(url)
  ) {
    return false;
  }
  const rest = parsed.pathname.slice(containerPath.length);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * Locate the RDF/JS activity subject (named or blank) within a notification dataset: the first subject
 * carrying an `as:` or `ldp:` rdf:type, else the first with an `as:actor`. Other
 * ActivityStreams properties prefer `${url}#it`, then the document, then any subject.
 * Unrelated RDF is not a notification. Pure.
 */
export function findActivitySubject(
  url: string,
  dataset: import("@rdfjs/types").DatasetCore,
): NamedNode | BlankNode | undefined {
  if (
    isAuxiliaryResource(url) ||
    new URL(url).pathname.endsWith("/") ||
    isInboxContainer(url, dataset)
  ) {
    return undefined;
  }
  for (const q of dataset.match(null, DataFactory.namedNode(RDF_TYPE), null)) {
    if (
      q.object.termType === "NamedNode" &&
      (q.object.value.startsWith(AS) || q.object.value.startsWith("http://www.w3.org/ns/ldp#"))
    ) {
      return q.subject as NamedNode | BlankNode;
    }
  }
  for (const q of dataset.match(null, DataFactory.namedNode(`${AS}actor`), null)) {
    return q.subject as NamedNode | BlankNode;
  }
  for (const subject of [DataFactory.namedNode(`${url}#it`), DataFactory.namedNode(url), null]) {
    for (const q of dataset.match(subject, null, null)) {
      if (q.predicate.value.startsWith(AS)) return q.subject as NamedNode | BlankNode;
    }
  }
  return undefined;
}

/**
 * Parse a notification document into an {@link InboxNotification}, or `undefined`
 * if no subject has ActivityStreams properties or an AS/LDN type. Unknown types
 * with recognizable properties remain readable.
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
  for (const q of dataset.match(subject, DataFactory.namedNode(`${AS}published`), null)) {
    if (q.object.termType !== "Literal") continue;
    const date = new Date(q.object.value);
    if (!Number.isNaN(date.getTime())) {
      published = date;
      break;
    }
  }
  const types = new Set<string>();
  for (const q of dataset.match(subject, DataFactory.namedNode(RDF_TYPE), null)) {
    if (q.object.termType === "NamedNode") types.add(q.object.value);
  }
  const name = OptionalFrom.subjectPredicate(doc, `${AS}name`, LiteralAs.string);
  return {
    url,
    type: typeLabel(types),
    ...(doc.actor !== undefined ? { actor: doc.actor } : {}),
    ...(doc.activityObject !== undefined ? { object: doc.activityObject } : {}),
    ...(doc.target !== undefined ? { target: doc.target } : {}),
    ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
    ...(doc.content !== undefined ? { content: doc.content } : {}),
    ...(name !== undefined ? { name } : {}),
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
    if (isDirectChild(abs, inboxUrl) && !isInboxContainer(abs, dataset)) out.add(abs);
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
