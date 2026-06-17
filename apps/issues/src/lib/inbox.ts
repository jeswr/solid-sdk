// AUTHORED-BY Claude Opus 4.8
/**
 * LDN inbox reader (Linked Data Notifications — https://www.w3.org/TR/ldn/).
 *
 * The user's `ldp:inbox` is read off their WebID profile; the inbox is an LDP
 * container whose members are individual notification resources, each an
 * ActivityStreams 2.0 Activity (`as:Announce` / `as:Add` / `as:Create` / … —
 * e.g. an assignment or @mention). This module:
 *
 *   1. reads `ldp:inbox` from the profile,
 *   2. SSRF-validates it is one of the user's OWN pod storages (own-pod.ts) —
 *      we never attach the user's auth-patched `fetch` to a foreign origin,
 *   3. lists the inbox container's `ldp:contains` members,
 *   4. fetches + parses each notification (own-pod-validated likewise), and
 *   5. returns them newest-first.
 *
 * READ-ONLY: posting to inboxes is out of scope. We do NOT auto-dereference the
 * foreign `as:actor` of a notification — its WebID is shown as-is; only the
 * notification resources inside the user's own inbox are fetched.
 *
 * All RDF goes through @jeswr/fetch-rdf (parse) + @rdfjs/wrapper typed accessors
 * — never hand-built triples, never Turtle regex (house rule).
 */

import {
  TermWrapper,
  DatasetWrapper,
  OptionalFrom,
  SetFrom,
  NamedNodeAs,
  NamedNodeFrom,
  LiteralAs,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { AS, LDP, RDF } from "./vocab";
import { isOwnPodUrl } from "./own-pod";

/** A parsed LDN notification, reduced to what the inbox view renders. */
export interface InboxNotification {
  /** The notification resource URL (its identity / dedupe key). */
  url: string;
  /** AS2 activity type IRIs (`as:Announce`, `as:Add`, …) — may be several. */
  types: string[];
  /** `as:actor` WebID (who triggered it), if present. NOT dereferenced. */
  actor?: string;
  /** `as:object` — the issue/resource the activity is about, if present. */
  object?: string;
  /** Human-readable text: `as:summary` || `as:content` || `as:name`. */
  summary?: string;
  /** `as:published` timestamp (ISO string), if present. */
  published?: string;
  /** `as:target` — where the activity landed (e.g. the tracker), if present. */
  target?: string;
}

/** Reads the `ldp:inbox` link off a WebID subject. */
class ProfileInbox extends TermWrapper {
  get inbox(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${LDP}inbox`, NamedNodeAs.string);
  }
}

/** Wraps an LDP container document to read its `ldp:contains` members. */
class InboxContainer extends DatasetWrapper {
  /** The member resource URLs (`<container> ldp:contains <member>`). */
  members(containerUrl: string): string[] {
    const contains = SetFrom.subjectPredicate(
      new TermWrapper(containerUrl, this, this.factory),
      `${LDP}contains`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    return [...contains];
  }
}

/** One AS2 Activity resource (the body of a single notification). */
class ActivityResource extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get actor(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}actor`, NamedNodeAs.string);
  }
  // NB: named `activityObject`, not `object` — `object` is a reserved Quad member
  // on the TermWrapper base class (it IS an RDF/JS term), so overriding it breaks
  // the `this`-as-TermWrapper contract the accessor helpers depend on.
  get activityObject(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}object`, NamedNodeAs.string);
  }
  get target(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}target`, NamedNodeAs.string);
  }
  get summary(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}summary`, LiteralAs.string);
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}content`, LiteralAs.string);
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}name`, LiteralAs.string);
  }
  get published(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}published`, LiteralAs.string);
  }
}

/**
 * Parse a single notification dataset into an {@link InboxNotification}. The
 * notification subject is the resource URL; if no AS2-typed subject sits at that
 * URL we fall back to the first subject carrying an `as:` activity type (some
 * servers mint the activity at a fragment / blank node). Exported for unit tests.
 */
export function parseNotification(url: string, dataset: DatasetCore): InboxNotification {
  const factory = DataFactory;
  // Prefer the subject AT the resource URL; else the first AS2-typed subject.
  let subjectUrl = url;
  const atUrl = new ActivityResource(url, dataset, factory);
  if (atUrl.types.size === 0) {
    const typed = findActivitySubject(dataset);
    if (typed) subjectUrl = typed;
  }
  const a = new ActivityResource(subjectUrl, dataset, factory);
  return {
    url,
    types: [...a.types],
    actor: a.actor,
    object: a.activityObject,
    target: a.target,
    summary: a.summary ?? a.content ?? a.name,
    published: a.published,
  };
}

/** Find the first named subject that has an `as:`-namespaced rdf:type. */
function findActivitySubject(dataset: DatasetCore): string | undefined {
  const typePred = DataFactory.namedNode(`${RDF}type`);
  for (const q of dataset.match(undefined, typePred)) {
    if (q.subject.termType === "NamedNode" && q.object.termType === "NamedNode" && q.object.value.startsWith(AS)) {
      return q.subject.value;
    }
  }
  return undefined;
}

/**
 * Resolve the user's `ldp:inbox` URL from their profile, IFF it is one of their
 * own pod storages (own-pod SSRF guard). Returns undefined when the profile
 * advertises no inbox, OR when the inbox URL is foreign (fail-closed — we never
 * fetch a foreign inbox with the user's token). `fetchImpl` is for tests.
 */
export async function resolveOwnInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  const { dataset } = await fetchRdf(webId, {
    headers: { "cache-control": "no-cache" },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const inbox = new ProfileInbox(webId, dataset, DataFactory).inbox;
  if (!inbox) return undefined;
  // SSRF guard: only an inbox within the user's OWN pod is fetched.
  if (!isOwnPodUrl(inbox, ownStorageUrls)) return undefined;
  return inbox;
}

/** Sort newest-first by `as:published`; undefined timestamps sink to the bottom. */
function byNewest(a: InboxNotification, b: InboxNotification): number {
  const ta = a.published ? Date.parse(a.published) : NaN;
  const tb = b.published ? Date.parse(b.published) : NaN;
  const va = Number.isNaN(ta) ? -Infinity : ta;
  const vb = Number.isNaN(tb) ? -Infinity : tb;
  return vb - va;
}

/** A bounded cap on notifications fetched per inbox load (keeps the view snappy). */
const MAX_NOTIFICATIONS = 50;

/**
 * Read the user's LDN inbox: resolve `ldp:inbox` (own-pod-validated), list its
 * members, fetch + parse each (own-pod-validated), and return them newest-first.
 *
 * Resilient: a member that fails to fetch/parse is skipped (one bad notification
 * never blanks the whole inbox). Returns `{ inboxUrl: undefined, notifications: [] }`
 * when the profile advertises no (own-pod) inbox — the view shows an empty state.
 */
export async function readInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
): Promise<{ inboxUrl: string | undefined; notifications: InboxNotification[] }> {
  const inboxUrl = await resolveOwnInbox(webId, ownStorageUrls, fetchImpl);
  if (!inboxUrl) return { inboxUrl: undefined, notifications: [] };

  const opts = fetchImpl ? { fetch: fetchImpl } : undefined;
  const { dataset: containerDs } = await fetchRdf(inboxUrl, opts);
  const memberUrls = new InboxContainer(containerDs, DataFactory)
    .members(inboxUrl)
    // Defence in depth: a member link could (maliciously or by misconfiguration)
    // point off-pod — only fetch members within the user's own storage.
    .filter((m) => m !== inboxUrl && isOwnPodUrl(m, ownStorageUrls))
    .slice(0, MAX_NOTIFICATIONS);

  const settled = await Promise.allSettled(
    memberUrls.map(async (m) => {
      const { dataset } = await fetchRdf(m, opts);
      return parseNotification(m, dataset);
    }),
  );
  const notifications = settled
    .filter((r): r is PromiseFulfilledResult<InboxNotification> => r.status === "fulfilled")
    .map((r) => r.value)
    .sort(byNewest);

  return { inboxUrl, notifications };
}
