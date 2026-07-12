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

/** How many notifications the view renders (applied AFTER fetch + newest-first sort). */
const DISPLAY_LIMIT = 50;
/**
 * Hard ceiling on member resources FETCHED per load — a backstop against a
 * pathologically large inbox, NOT the display cap. We must fetch enough to sort
 * by `as:published` (LDP `ldp:contains` order is not guaranteed), so this is set
 * well above the display limit; the newest `DISPLAY_LIMIT` survive the cut.
 */
const MAX_FETCH = 500;
/** Max concurrent member fetches (keeps the fan-out bounded on a large inbox). */
const FETCH_CONCURRENCY = 8;

/**
 * Map `fn` over `items` with at most `limit` in flight at once. A rejected `fn`
 * surfaces as a rejected slot (callers use Promise-settled semantics to skip it).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The result of reading the LDN inbox. */
export interface InboxResult {
  /** The own-pod inbox URL, or undefined when none is advertised. */
  inboxUrl: string | undefined;
  /** The notifications, newest-first, capped at the display limit. */
  notifications: InboxNotification[];
  /**
   * Total eligible (own-pod) member count in the container — even when more than
   * we fetched. Lets the view tell the user the inbox is large.
   */
  totalMembers: number;
  /**
   * True when the container held MORE eligible members than the fetch ceiling
   * (`MAX_FETCH`): `ldp:contains` order is not guaranteed, so beyond this bound a
   * newer notification COULD be hidden. EXPLICIT (the view surfaces it) rather
   * than a silent drop. (LDN/LDP gives no portable server-side ordering or
   * pagination, so an unbounded inbox cannot be made fully exhaustive
   * client-side — this is the honest, bounded contract.)
   */
  truncated: boolean;
}

/**
 * Read the user's LDN inbox: resolve `ldp:inbox` (own-pod-validated), list its
 * members, fetch + parse each (own-pod-validated), and return them newest-first.
 *
 * Resilient: a member that fails to fetch/parse is skipped (one bad notification
 * never blanks the whole inbox). Returns `inboxUrl: undefined` when the profile
 * advertises no (own-pod) inbox — the view shows an empty state.
 *
 * Bounded: at most `MAX_FETCH` members are fetched. When the container holds more
 * than that, `truncated` is set so the view can tell the user some (possibly
 * newer) notifications are not shown — an explicit, surfaced limit, not a silent
 * drop (LDN/LDP gives no portable ordering/pagination to exhaust a huge inbox).
 */
export async function readInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
  /** Override the fetch ceiling (tests only); defaults to {@link MAX_FETCH}. */
  maxFetch: number = MAX_FETCH,
): Promise<InboxResult> {
  const inboxUrl = await resolveOwnInbox(webId, ownStorageUrls, fetchImpl);
  if (!inboxUrl) return { inboxUrl: undefined, notifications: [], totalMembers: 0, truncated: false };

  const opts = fetchImpl ? { fetch: fetchImpl } : undefined;
  const { dataset: containerDs } = await fetchRdf(inboxUrl, opts);
  const eligible = new InboxContainer(containerDs, DataFactory)
    .members(inboxUrl)
    // Defence in depth: a member link could (maliciously or by misconfiguration)
    // point off-pod — only fetch members within the user's own storage.
    .filter((m) => m !== inboxUrl && isOwnPodUrl(m, ownStorageUrls));
  const totalMembers = eligible.length;
  const truncated = totalMembers > maxFetch;
  // Fetch ceiling (NOT the display cap): `ldp:contains` order is not guaranteed,
  // so we fetch a broad set, sort by `as:published`, and THEN cap. Beyond
  // maxFetch we cannot guarantee the newest survive (hence `truncated`).
  const memberUrls = eligible.slice(0, maxFetch);

  // Bounded-concurrency fan-out so a large inbox doesn't open hundreds of
  // requests at once. A member that fails to fetch/parse is skipped.
  const settled = await mapWithConcurrency(memberUrls, FETCH_CONCURRENCY, async (m) => {
    const { dataset } = await fetchRdf(m, opts);
    return parseNotification(m, dataset);
  });
  const notifications = settled
    .filter((r): r is PromiseFulfilledResult<InboxNotification> => r.status === "fulfilled")
    .map((r) => r.value)
    .sort(byNewest)
    // Newest-first, THEN apply the display cap so the most recent survive.
    .slice(0, DISPLAY_LIMIT);

  return { inboxUrl, notifications, totalMembers, truncated };
}
