// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Pure RDF helpers for the proactive warmer (P2, §3).
 *
 * Everything here is a deterministic function over a Turtle string (parsed with
 * N3.js) — no network, no Cache API, no SW lifecycle — so the warmer's seed
 * derivation and child enumeration are fully unit-testable headlessly.
 *
 * The warmer ONLY parses Turtle. The SWR cache normalizes all RDF reads to
 * `Accept: text/turtle` (see `cache-policy.ts#canonicalAccept`), so the warm
 * `fetch`es ask for Turtle and we parse exactly that — no JSON-LD on this path.
 */

import { Parser, type Quad } from 'n3';

/** Well-known vocabulary terms the warmer dereferences. */
const NS = {
  pimStorage: 'http://www.w3.org/ns/pim/space#storage',
  ldpContains: 'http://www.w3.org/ns/ldp#contains',
  solidPublicTypeIndex: 'http://www.w3.org/ns/solid/terms#publicTypeIndex',
  solidPrivateTypeIndex: 'http://www.w3.org/ns/solid/terms#privateTypeIndex',
  ldpInbox: 'http://www.w3.org/ns/ldp#inbox',
  // Type Index registration → instance / instanceContainer.
  solidInstance: 'http://www.w3.org/ns/solid/terms#instance',
  solidInstanceContainer: 'http://www.w3.org/ns/solid/terms#instanceContainer',
} as const;

/** Parse a Turtle string into quads. Returns [] on any parse error (warmer is best-effort). */
export function parseTurtle(body: string, baseIRI?: string): Quad[] {
  try {
    const parser = new Parser(baseIRI ? { baseIRI } : undefined);
    return parser.parse(body);
  } catch {
    return [];
  }
}

/** All objects of `(any subject, predicate, ?)` as IRI strings (named nodes only). */
function objectsOf(quads: Quad[], predicate: string): string[] {
  const out: string[] = [];
  for (const q of quads) {
    if (q.predicate.value === predicate && q.object.termType === 'NamedNode') {
      out.push(q.object.value);
    }
  }
  return out;
}

/** Objects of `(subject, predicate, ?)` for a specific subject IRI. */
function objectsOfSubject(quads: Quad[], subject: string, predicate: string): string[] {
  const out: string[] = [];
  for (const q of quads) {
    if (
      q.subject.value === subject &&
      q.predicate.value === predicate &&
      q.object.termType === 'NamedNode'
    ) {
      out.push(q.object.value);
    }
  }
  return out;
}

/** Resolve a possibly-relative IRI against a base; drop anything unparseable. */
function absolutize(iri: string, base: string): string | undefined {
  try {
    return new URL(iri, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * The warmer's seeds, in spec priority order (§3 + decision 6 "Type-Index-first"):
 *   WebID profile → pim:storage root → Type Index (public + private) → ACLs → inbox.
 *
 * `kind` lets the BFS order Type-Index entries ahead of plain storage roots and
 * decide what to enumerate (a Type Index lists registrations, not ldp:contains).
 */
export type SeedKind = 'profile' | 'typeIndex' | 'storage' | 'inbox' | 'acl';

export interface Seed {
  url: string;
  kind: SeedKind;
}

/**
 * Derive seeds from a WebID profile document.
 *
 * `webId` is the profile-card URL we fetched (the document); `profileTurtle` is
 * its body. We read pim:storage, public/privateTypeIndex, and ldp:inbox.
 * Type indexes are emitted BEFORE storage roots so the BFS warms the index-named
 * resources first (decision 6).
 */
export function deriveSeeds(webId: string, profileTurtle: string): Seed[] {
  const quads = parseTurtle(profileTurtle, webId);
  const seeds: Seed[] = [];
  const seen = new Set<string>();

  const add = (raw: string, kind: SeedKind): void => {
    const abs = absolutize(raw, webId);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    seeds.push({ url: abs, kind });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // #11: derive seeds ONLY from the logged-in WebID subject.
  //   Reading these predicates from ANY subject let a profile (or a malicious /
  //   confused document fragment) name pim:storage / type-index / inbox URLs that
  //   are NOT the user's own — so the warmer could be steered to crawl arbitrary
  //   storage roots. We anchor on the WebID subject. Profiles commonly use the
  //   hash WebID (`…/card#me`) as the subject; we also accept the profile
  //   DOCUMENT IRI (the WebID with the fragment stripped) as a narrow, explicit
  //   fallback (some profiles assert pim:storage on the document, not `#me`).
  // ────────────────────────────────────────────────────────────────────────────
  const subjects = profileSubjects(webId);
  const objectsForSelf = (predicate: string): string[] => {
    for (const subject of subjects) {
      const hits = objectsOfSubject(quads, subject, predicate);
      if (hits.length > 0) return hits;
    }
    return [];
  };

  // Type Index FIRST (decision 6).
  for (const t of objectsForSelf(NS.solidPublicTypeIndex)) add(t, 'typeIndex');
  for (const t of objectsForSelf(NS.solidPrivateTypeIndex)) add(t, 'typeIndex');
  // Storage root(s).
  for (const s of objectsForSelf(NS.pimStorage)) add(s, 'storage');
  // Inbox.
  for (const i of objectsForSelf(NS.ldpInbox)) add(i, 'inbox');

  return seeds;
}

/**
 * The subject IRIs we accept seed predicates from (#11): the WebID itself and,
 * as a narrow fallback, its document IRI (fragment stripped). Ordered so the
 * exact WebID wins.
 */
function profileSubjects(webId: string): string[] {
  const subjects = [webId];
  try {
    const u = new URL(webId);
    if (u.hash) {
      u.hash = '';
      const doc = u.toString();
      if (doc !== webId) subjects.push(doc);
    }
  } catch {
    /* unparseable WebID → just the raw string */
  }
  return subjects;
}

/**
 * Children to enqueue from a fetched container listing.
 *
 * Returns absolute `ldp:contains` member IRIs. The container's own ACL document
 * (if known) is handled separately by the BFS via `aclUrlFor`.
 */
export function containerChildren(containerUrl: string, listingTurtle: string): string[] {
  const quads = parseTurtle(listingTurtle, containerUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  // Prefer ldp:contains anchored on the container itself; fall back to any subject
  // (some servers list contains on a fragment).
  let members = objectsOfSubject(quads, containerUrl, NS.ldpContains);
  if (members.length === 0) members = objectsOf(quads, NS.ldpContains);
  for (const m of members) {
    const abs = absolutize(m, containerUrl);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

/**
 * Resources named by a Type Index document (the registrations'
 * solid:instance / solid:instanceContainer objects). These are warmed before
 * generic BFS frontier expansion (decision 6, Type-Index-first).
 */
export function typeIndexTargets(typeIndexUrl: string, indexTurtle: string): string[] {
  const quads = parseTurtle(indexTurtle, typeIndexUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pred of [NS.solidInstance, NS.solidInstanceContainer]) {
    for (const t of objectsOf(quads, pred)) {
      const abs = absolutize(t, typeIndexUrl);
      if (abs && !seen.has(abs)) {
        seen.add(abs);
        out.push(abs);
      }
    }
  }
  return out;
}

/** Is a URL a container per Solid convention (path ends with '/')? */
export function isContainer(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/');
  } catch {
    return false;
  }
}

/**
 * The ACL document URL for a resource, per the `Link: rel="acl"` header when
 * present, else the WAC convention (`<resource>.acl`, `<container>/.acl`).
 * Returns undefined if it cannot be derived (so the BFS simply skips it).
 */
export function aclUrlFor(resourceUrl: string, linkHeader?: string | null): string | undefined {
  const fromLink = aclFromLinkHeader(resourceUrl, linkHeader);
  if (fromLink) return fromLink;
  try {
    const u = new URL(resourceUrl);
    if (u.pathname.endsWith('.acl')) return undefined; // don't recurse on ACLs
    // WAC convention: append `.acl` to the resource URL. This covers both a plain
    // resource (`…/r` → `…/r.acl`) and a container (`…/c/` → `…/c/.acl`).
    return `${resourceUrl}.acl`;
  } catch {
    return undefined;
  }
}

/** Extract a rel="acl" target from a Link header, resolved against the resource. */
export function aclFromLinkHeader(base: string, linkHeader?: string | null): string | undefined {
  if (!linkHeader) return undefined;
  // Link: <https://…/foo.acl>; rel="acl", <…>; rel="type"
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*(.*)/);
    if (!m) continue;
    const target = m[1];
    const params = m[2]?.toLowerCase() ?? '';
    if (target && /rel\s*=\s*"?acl"?/.test(params)) {
      return absolutize(target, base);
    }
  }
  return undefined;
}

/**
 * Parse a `WAC-Allow` header into the modes granted to `user` / `public`.
 *
 * Example: `WAC-Allow: user="read write", public="read"`.
 * The warmer reads this on listings to decide whether a child subtree is worth
 * descending into (no read ⇒ prune without even attempting a 403).
 */
export interface WacAllow {
  user: Set<string>;
  public: Set<string>;
}

export function parseWacAllow(header?: string | null): WacAllow {
  const result: WacAllow = { user: new Set(), public: new Set() };
  if (!header) return result;
  // Split on the group boundary: `user="…"` / `public="…"`.
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null = re.exec(header);
  while (m !== null) {
    const group = m[1]?.toLowerCase();
    const modes = (m[2] ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (group === 'user') for (const mode of modes) result.user.add(mode);
    else if (group === 'public') for (const mode of modes) result.public.add(mode);
    m = re.exec(header);
  }
  return result;
}

/** True if the (authenticated) user is granted read on a resource per WAC-Allow. */
export function userCanRead(header?: string | null): boolean {
  const wac = parseWacAllow(header);
  // No header → unknown; let the BFS attempt the fetch (a 403 then prunes).
  if (!header) return true;
  return wac.user.has('read') || wac.public.has('read');
}
