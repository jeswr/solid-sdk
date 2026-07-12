// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * discover.ts — discover a recipient agent's LDN inbox from THEIR WebID profile.
 *
 * SECURITY. The inbox URI is read ONLY from the recipient's profile graph
 * (`ldp:inbox` via a typed `@rdfjs/wrapper` accessor — never a regex on RDF, and
 * never taken from caller free-text). The profile GET is itself attacker-
 * influenced (the WebID host is whatever the caller picked), so it goes through
 * the DNS-pinned {@link guardedFetch} chokepoint: a public WebID name that
 * resolves to a private/metadata IP is refused, the body is bounded, and a
 * redirect chain is re-classified+re-pinned per hop. The discovered inbox is
 * returned UNVALIDATED for SSRF purposes only in the sense that the actual POST
 * to it ALSO goes through `guardedFetch` (see `send.ts`); but we still resolve it
 * to an absolute URL here so callers get a clean result.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  NamedNodeAs,
  NamedNodeFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { LDP_INBOX, MAX_BYTES_PROFILE } from "./config.js";
import {
  type GuardedFetchOptions,
  type GuardedFetchResult,
  guardedFetch,
} from "./security/guardedFetch.js";

/** Options shared by the discover / send / read helpers. */
export interface NotifyOptions {
  /**
   * TEST/DEV ONLY: permit loopback targets + loopback http. NEVER set in
   * production (it disables the loopback SSRF guard so a fixture server on
   * 127.0.0.1 is reachable).
   */
  allowLoopback?: boolean;
  /** Inject a DNS lookup (tests — e.g. the rebinding stub). */
  dnsLookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** Total timeout (ms) for the underlying guarded fetch. */
  timeoutMs?: number;
  /** Override the guarded-fetch impl, TESTS ONLY — production must use the real chokepoint. */
  fetchImpl?: (
    url: string,
    opts?: GuardedFetchOptions
  ) => Promise<GuardedFetchResult>;
  /**
   * ADVANCED (send-only): augment the notification dataset before it is serialised
   * to Turtle and POSTed — e.g. embed a shared `wf:Task` body alongside the
   * `as:Announce` (see `task.ts` / `notifyTaskAssigned`). Receives the n3 `Store`
   * holding the just-built activity; mutate it via TYPED accessors (never
   * hand-built quads). May be `async` — the send path `await`s it, so its mutations
   * are guaranteed complete BEFORE serialise + POST. Ignored by `discoverInbox` /
   * `readInbox` (no body there).
   */
  extend?: (store: Store) => void | Promise<void>;
}

/** Strip the fragment from a WebID to get its profile DOCUMENT URL (the RDF base). */
export function profileDocUrl(webId: string): string {
  const u = new URL(webId); // throws on a non-URL WebID — caller catches
  u.hash = "";
  return u.toString();
}

/** A typed view of an agent's profile subject that exposes `ldp:inbox`. */
class InboxAgent extends TermWrapper {
  /**
   * All `ldp:inbox` values advertised by this subject. A `Set` (not an
   * `Optional`) so a malformed profile advertising MULTIPLE inboxes does not
   * throw — discovery must fail gracefully (return `undefined`), never leak a
   * raw cardinality error.
   */
  get inboxes(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      LDP_INBOX,
      NamedNodeAs.string,
      NamedNodeFrom.string
    );
  }
}

/**
 * Discover the recipient's LDN inbox.
 *
 * @returns the absolute `ldp:inbox` URI, or `undefined` when the WebID is
 *   unparseable, the profile is unreadable/unsafe (SSRF-refused), advertises no
 *   inbox, or advertises MULTIPLE inboxes (ambiguous — we refuse to guess).
 *
 * NOTE the SSRF guard's redirect handling: a GET may follow a same-origin /
 * re-validated redirect to the canonical card. The inbox value is resolved
 * against the FINAL document URL the profile resolved to (the RDF base).
 */
export async function discoverInbox(
  webId: string,
  opts: NotifyOptions = {}
): Promise<string | undefined> {
  let docUrl: string;
  try {
    docUrl = profileDocUrl(webId);
  } catch {
    return undefined; // not a parseable WebID URL
  }

  const fetcher = opts.fetchImpl ?? guardedFetch;
  let result: GuardedFetchResult;
  try {
    result = await fetcher(docUrl, {
      method: "GET",
      maxBytes: MAX_BYTES_PROFILE,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.allowLoopback !== undefined
        ? { allowLoopback: opts.allowLoopback }
        : {}),
      ...(opts.dnsLookup !== undefined ? { dnsLookup: opts.dnsLookup } : {}),
    });
  } catch {
    // Profile unreadable / SSRF-refused → no inbox we can discover.
    return undefined;
  }
  if (result.status < 200 || result.status >= 300) return undefined;

  let dataset: import("@rdfjs/types").DatasetCore;
  try {
    dataset = await parseRdf(result.text, result.contentType || null, {
      baseIRI: result.finalUrl,
    });
  } catch {
    return undefined; // unparseable profile
  }

  // Read the inbox values defensively — a malformed/malicious profile (e.g.
  // ldp:inbox pointing at a literal where a NamedNode is expected) must collapse
  // to `undefined`, never throw a raw term/cardinality error out of discovery.
  let raw: string | undefined;
  try {
    const inboxes = new InboxAgent(webId, dataset, DataFactory).inboxes;
    if (inboxes.size !== 1) return undefined; // zero → none; multiple → ambiguous
    [raw] = [...inboxes];
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  // Resolve a possibly-relative inbox IRI against the FINAL profile document URL.
  try {
    return new URL(raw, result.finalUrl).toString();
  } catch {
    return undefined;
  }
}
