// AUTHORED-BY Claude Opus 4.8
/**
 * The PER-DATA-CLASS GRANT model + the pure enforcement logic — the security heart of
 * access-management Phase 2 (design `access-management-proposal.md` §4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS WIDENS, AND WHY IT IS FAIL-CLOSED
 *
 * Phase-0/1 consented by *origin*: a granted app origin could drive `window.solid.fetch`
 * against the WHOLE pod. This module adds the ORTHOGONAL, NARROWER capability the design
 * calls for — a grant keyed by `(origin, dataClass, modes, purpose, expiry)` whose
 * enforceable substance is a **PINNED, RESOLVED TARGET SET**: at grant time the data class
 * is resolved (type-index walk, `class-resolve.ts`) to the concrete pod resources/containers
 * it maps to, and THAT set is frozen into the grant. The service worker then enforces the
 * pinned set on every `.fetch` — not the origin, and never a live re-resolution (the TOCTOU
 * mitigation, design §6.2: the user consented to *those* resources; a resource created later,
 * or re-typed into the class, needs fresh consent).
 *
 * This module is the PURE core of that gate — no `chrome.*`, no `fetch`, no storage — so the
 * decision is exhaustively unit-testable. Every rule is fail-closed:
 *   - an EXPIRED grant authorises nothing (and is pruned);
 *   - a grant with an EMPTY / unresolved target set authorises nothing (unknown class → deny);
 *   - a grant with no valid modes authorises nothing;
 *   - a malformed stored grant authorises nothing;
 *   - a target-set membership test fails closed on any unparseable URL, cross-origin target,
 *     or path-traversal attempt (the WHATWG URL parser normalises `..`, so a normalised path
 *     that escapes the pinned container prefix is simply not a match → DENY).
 *
 * BACKWARDS COMPATIBILITY (design item 5 — "legacy origin-only grants must keep working"):
 * this module governs ONLY origins whose access is class-scoped. An origin that holds a
 * FULL-pod grant (a deliberate login / `setClientId` opt-in, or a credential/pod origin) is
 * NOT constrained here — the service worker checks full-grant membership FIRST and only falls
 * through to this pinned-set gate for an origin that is present *solely* because it holds one
 * or more class grants. So a legacy origin keeps its whole-pod access unchanged; a class-only
 * origin is confined to its pinned targets. (Dual-read migration; no data migration needed.)
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The three WAC-shaped access modes a grant can carry. */
export type GrantMode = 'read' | 'append' | 'write';

/** A pinned, resolved target: either one exact resource, or a container (covers descendants). */
export interface PinnedTarget {
  /** The concrete resource/container URL, normalised to its `origin + pathname`. */
  readonly url: string;
  /** `instance` ⇒ exactly this resource; `container` ⇒ this container and its descendants. */
  readonly kind: 'instance' | 'container';
}

/**
 * A per-data-class grant, as persisted in extension storage. IMMUTABLE once written (a change
 * is a new grant + a revoke, mirroring SAI's immutable AccessGrant). The `targets` are the
 * RESOLVED, PINNED set — the substance the SW enforces; the `dataClass`/`purpose` are the
 * human-meaningful consent anchors carried for the dashboard + audit (they are NOT enforced —
 * enforcement is on `targets` + `modes` + `expiresAt`).
 */
export interface ClassGrant {
  /** Opaque, unique grant id (also the revoke handle). */
  readonly grantId: string;
  /**
   * The WebID this grant was minted under — a SECURITY dimension (mirrors the replica-key
   * WebID boundary): a grant minted for WebID A NEVER authorises a request while WebID B is the
   * active session, so a re-login as a different identity cannot inherit A's pinned access.
   */
  readonly webId: string;
  /** The requesting app origin this grant authorises (canonical `https://host[:port]`). */
  readonly origin: string;
  /** The data-class IRI the user consented to (audit/UX anchor; not itself enforced). */
  readonly dataClass: string;
  /** The granted modes. Enforcement requires the request's method-mode to be satisfied. */
  readonly modes: readonly GrantMode[];
  /** The declared purpose (DPV IRI or string) — audit-only, NOT RS-enforceable (design §6.3). */
  readonly purpose: string | null;
  /** Absolute expiry, epoch ms. A request at/after this instant is denied (design item 3). */
  readonly expiresAt: number;
  /** The RESOLVED, PINNED targets — the enforced substance (TOCTOU mitigation, design §6.2). */
  readonly targets: readonly PinnedTarget[];
  /** When the grant was minted, epoch ms (dashboard ordering / audit). */
  readonly createdAt: number;
}

/**
 * Map an HTTP method to the access mode the request REQUIRES. Fail-closed: an unknown/unsafe
 * method requires `write` (the most privileged mode), so an unrecognised verb can only be
 * authorised by an explicit write grant, never slipped through as a read.
 *   GET/HEAD → read ;  POST → append ;  PUT/PATCH/DELETE → write ;  else → write.
 */
export function methodToMode(method: string): GrantMode {
  switch (method.trim().toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
      return 'append';
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return 'write';
    default:
      return 'write';
  }
}

/** Parse/normalise an arbitrary mode string to a {@link GrantMode}, or `null` if unrecognised. */
export function normaliseMode(value: unknown): GrantMode | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'read':
      return 'read';
    case 'append':
      return 'append';
    case 'write':
      return 'write';
    default:
      return null;
  }
}

/** Normalise a list of mode strings to the deduped set of recognised {@link GrantMode}s. */
export function normaliseModes(values: unknown): GrantMode[] {
  if (!Array.isArray(values)) return [];
  const out: GrantMode[] = [];
  for (const v of values) {
    const m = normaliseMode(v);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Whether a granted mode-set SATISFIES the mode a request requires. The only implication is the
 * WAC-standard `write ⊇ append` (a write grant covers an append). `read` is independent — a
 * write grant does NOT imply read, and a read grant does NOT imply append/write. Fail-closed:
 * an empty granted set satisfies nothing.
 */
export function modeSatisfies(granted: readonly GrantMode[], required: GrantMode): boolean {
  if (required === 'append') return granted.includes('append') || granted.includes('write');
  return granted.includes(required);
}

/** Parse a string to its normalised `origin + pathname` (no query/fragment), or `null`. */
function originPath(value: string): { origin: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const origin = u.origin;
  if (origin === 'null' || origin === '') return null;
  return { origin, path: u.pathname };
}

/**
 * Whether a request URL falls WITHIN a single pinned target. PURE + fail-closed:
 *   - unparseable / non-http(s) request or target URL → false;
 *   - cross-origin (request origin ≠ target origin) → false;
 *   - `instance` ⇒ EXACT `origin + pathname` match (query/fragment ignored — a pod resource's
 *     identity is its path, not its query);
 *   - `container` ⇒ the request path must be the container path itself OR a descendant of it.
 *     The container path is normalised to end in `/`, and membership is a strict path-segment
 *     prefix on the ALREADY-URL-NORMALISED request path — so a `..` traversal (which the URL
 *     parser collapses before we ever see it) that escapes the container cannot match, and a
 *     sibling like `/finance-secret/` never matches the pinned `/finance/`.
 */
export function isWithinTarget(target: PinnedTarget, requestUrl: string): boolean {
  const req = originPath(requestUrl);
  if (req === null) return false;
  const tgt = originPath(target.url);
  if (tgt === null) return false;
  if (req.origin !== tgt.origin) return false;

  if (target.kind === 'instance') {
    return req.path === tgt.path;
  }
  // container: normalise to a trailing-slash prefix; the container itself and any descendant match.
  const prefix = tgt.path.endsWith('/') ? tgt.path : `${tgt.path}/`;
  return req.path === prefix || req.path.startsWith(prefix);
}

/** Whether ANY pinned target of the set covers the request URL. Fail-closed on an empty set. */
export function targetsCover(targets: readonly PinnedTarget[], requestUrl: string): boolean {
  return targets.some((t) => isWithinTarget(t, requestUrl));
}

/** Whether a grant is expired (or has a missing/invalid expiry) at `now` (epoch ms). */
export function isGrantExpired(grant: ClassGrant, now: number): boolean {
  if (typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt)) return true;
  return now >= grant.expiresAt;
}

/**
 * Structural validation of a grant loaded from (untrusted) storage. A grant that fails ANY
 * check authorises NOTHING (it is dropped by {@link sanitiseGrants}). Defends the gate against
 * a corrupted / tampered storage record.
 */
export function isValidGrant(value: unknown): value is ClassGrant {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  if (typeof g.grantId !== 'string' || g.grantId.length === 0) return false;
  if (typeof g.webId !== 'string' || g.webId.length === 0) return false;
  if (typeof g.origin !== 'string' || originPath(g.origin) === null) return false;
  if (typeof g.dataClass !== 'string') return false;
  if (typeof g.expiresAt !== 'number' || !Number.isFinite(g.expiresAt)) return false;
  if (typeof g.createdAt !== 'number' || !Number.isFinite(g.createdAt)) return false;
  if (!Array.isArray(g.modes)) return false;
  if (!Array.isArray(g.targets)) return false;
  for (const t of g.targets) {
    if (typeof t !== 'object' || t === null) return false;
    const pt = t as Record<string, unknown>;
    if (typeof pt.url !== 'string') return false;
    if (pt.kind !== 'instance' && pt.kind !== 'container') return false;
  }
  // modes must be an array of recognised mode strings (an unrecognised entry is a corrupt record).
  for (const m of g.modes) if (normaliseMode(m) === null) return false;
  return true;
}

/** Keep only the structurally-valid grants from an untrusted list. */
export function sanitiseGrants(values: unknown): ClassGrant[] {
  if (!Array.isArray(values)) return [];
  return values.filter(isValidGrant);
}

/**
 * Whether a SINGLE grant authorises a `(url, method)` request at `now`. Fail-closed on every
 * axis: expired, mode not satisfied, empty/unresolved target set, or the URL outside every
 * pinned target → false.
 */
export function grantCovers(
  grant: ClassGrant,
  requestUrl: string,
  method: string,
  now: number,
): boolean {
  if (isGrantExpired(grant, now)) return false;
  if (grant.targets.length === 0) return false; // unresolved / unknown class → DENY.
  if (!modeSatisfies(grant.modes, methodToMode(method))) return false;
  return targetsCover(grant.targets, requestUrl);
}

/** A distinguishable reason the class gate denied, surfaced to the page (design item 2). */
export type ClassDenyReason =
  | 'out-of-grant-scope' // URL/method/expiry not covered by any pinned grant for this origin
  | 'no-class-grant'; // the origin holds no (live) class grant at all

/**
 * The class-scoped gate decision for one request. Given the (already-pruned, origin-filtered)
 * class grants an origin holds, decide whether `(url, method)` is authorised at `now`.
 * `null` deny ⇒ ALLOW. PURE + fail-closed: no grants ⇒ `no-class-grant`; grants present but
 * none cover ⇒ `out-of-grant-scope`.
 */
export function decideClassAccess(
  grantsForOrigin: readonly ClassGrant[],
  requestUrl: string,
  method: string,
  now: number,
): ClassDenyReason | null {
  const live = grantsForOrigin.filter((g) => !isGrantExpired(g, now));
  if (live.length === 0) return 'no-class-grant';
  const authorised = live.some((g) => grantCovers(g, requestUrl, method, now));
  return authorised ? null : 'out-of-grant-scope';
}

/** The non-expired subset of a grant list at `now` (used to prune the store). */
export function pruneExpiredGrants(grants: readonly ClassGrant[], now: number): ClassGrant[] {
  return grants.filter((g) => !isGrantExpired(g, now));
}

/**
 * The distinct origins holding at least one non-expired grant for the active WebID (drive the
 * per-origin gate so a class-only origin passes it, then the class gate confines it). When
 * `webId` is given, grants minted under a DIFFERENT WebID are ignored (the session boundary).
 */
export function liveGrantOrigins(
  grants: readonly ClassGrant[],
  now: number,
  webId?: string | null,
): Set<string> {
  const out = new Set<string>();
  for (const g of grants) {
    if (isGrantExpired(g, now)) continue;
    if (webId != null && g.webId !== webId) continue;
    out.add(g.origin);
  }
  return out;
}

/**
 * The grants that apply to a `(origin, webId)` session — the input to {@link decideClassAccess}.
 * Filters to this exact requesting origin AND this exact active WebID (the session boundary),
 * so cross-origin and cross-identity grants can never authorise the request.
 */
export function grantsForSession(
  grants: readonly ClassGrant[],
  origin: string,
  webId: string,
): ClassGrant[] {
  return grants.filter((g) => g.origin === origin && g.webId === webId);
}
