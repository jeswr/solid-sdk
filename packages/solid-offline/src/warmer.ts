// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Proactive cache warmer (P2, §3 + decisions 1 & 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE-DRIVEN — the SW is NEVER authenticated (decision 1):
 *   The warmer runs in the PAGE. It issues every fetch through the page's normal
 *   (already-DPoP-decorated) global `fetch`, so the service worker (P1) merely
 *   intercepts and caches the responses. We never put a key or token in the SW,
 *   and we never ask the SW to authenticate. The warmer's only job is to *cause*
 *   the right authenticated reads to flow through the SW.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Strategy: a bounded BFS from seeds (WebID profile → pim:storage root →
 * Type Index public+private → ACLs → inbox) over `ldp:contains`, Type-Index-first
 * (decision 6). ACL-aware: a 403 on a child is caught, negative-cached, and its
 * subtree pruned — never surfaced as an error. Budget-bounded (decision 6):
 * `maxResources`, `maxBytes`, `maxDepth`, `concurrency`. Large binaries are
 * listed/metadata-warmed only (bytes fetched lazily on demand).
 *
 * The engine is written against a small injected dependency set (a `fetch`, a
 * negative-cache sink, a clock) so the full traversal is unit-testable with
 * mocks — no browser, no SW lifecycle. Browser-only triggers (idle scheduling,
 * reconnect listeners) live at the bottom and are excluded from coverage.
 */

import {
  aclUrlFor,
  containerChildren,
  deriveSeeds,
  isContainer,
  type Seed,
  type SeedKind,
  typeIndexTargets,
  userCanRead,
} from './warmer-rdf.js';

/** Fully-resolved warmer budget (decision 6 defaults). */
export interface ResolvedWarmBudget {
  maxResources: number;
  maxBytes: number;
  maxDepth: number;
  concurrency: number;
}

/** Decision 6 defaults: 500 resources / 50 MB / depth 6 / concurrency 4. */
export const DEFAULT_WARM_BUDGET: ResolvedWarmBudget = {
  maxResources: 500,
  maxBytes: 50_000_000,
  maxDepth: 6,
  concurrency: 4,
};

/**
 * Content types we treat as "large binaries": warm the listing/metadata that
 * names them (so the cache knows they exist) but DON'T pull their bytes (they
 * are fetched lazily on first read). Decided by Content-Type prefix.
 */
const BINARY_TYPE_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];

/** Size (bytes) above which even a non-binary resource is skipped to protect the byte budget. */
const LARGE_RESOURCE_BYTES = 5_000_000;

export interface WarmDeps {
  /**
   * The PAGE's fetch (already DPoP-decorated). The warmer ALWAYS uses this so the
   * SW intercepts + caches; the warmer itself never authenticates.
   */
  fetch: typeof fetch;
  /**
   * Record a negative-cache entry for a pruned/forbidden URL. In production this
   * is a no-op when the SW already negative-cached the 403/404 it observed; the
   * sink exists so the page can also remember pruned subtrees for re-warm
   * decisions and so tests can assert pruning.
   */
  negativeCache?(url: string, status: number): void;
  /** Current epoch ms (injected for deterministic tests). */
  now?(): number;
  /** Optional sink for observability of each visited resource. */
  onVisit?(event: WarmVisit): void;
}

export interface WarmVisit {
  url: string;
  kind: SeedKind | 'child';
  depth: number;
  status: number;
  bytes: number;
  /** Why a resource was not byte-warmed (still counts listings/metadata). */
  skipped?: 'large-binary' | 'large-resource' | 'forbidden' | 'not-found' | 'fetch-error';
}

export interface WarmResult {
  /** Resources whose bytes were warmed through the SW. */
  warmed: number;
  /** Resources visited (fetched) including those skipped for size. */
  visited: number;
  /** Total bytes pulled through the page fetch. */
  bytes: number;
  /** URLs negatively cached (403/404) and pruned. */
  pruned: string[];
  /** True if a budget limit stopped the crawl early. */
  budgetHit: boolean;
  /** Per-resource trace (when `onVisit` not supplied, this is the collected log). */
  visits: WarmVisit[];
}

interface FrontierItem {
  url: string;
  kind: SeedKind | 'child';
  depth: number;
}

/** Internal mutable crawl state. */
interface CrawlState {
  enqueued: Set<string>;
  negative: Set<string>;
  warmed: number;
  visited: number;
  bytes: number;
  pruned: string[];
  budgetHit: boolean;
  visits: WarmVisit[];
  /**
   * #10: SYNCHRONOUS reservation counter. `warmed`/`bytes` are only incremented
   * after the async fetch, so several concurrent workers could each pass the
   * budget check before any of them increments — overshooting maxResources by up
   * to `concurrency - 1`. We reserve a slot synchronously BEFORE each fetch, so
   * the in-flight count is accounted for at admission time, not completion time.
   */
  reserved: number;
}

function isBinaryType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return BINARY_TYPE_PREFIXES.some((p) => ct.startsWith(p));
}

function bodyBytes(buf: ArrayBuffer | null, contentLength: string | null): number {
  if (buf) return buf.byteLength;
  const n = contentLength ? Number.parseInt(contentLength, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Warm the cache by fetching the user's documents through the page fetch.
 *
 * @param webId        the logged-in user's WebID (profile-card URL).
 * @param profileTurtle the already-fetched profile body (the caller fetches the
 *                      profile once; we reuse it to derive seeds). If omitted,
 *                      the warmer fetches the WebID itself first.
 * @param budget       resolved budget (defaults applied by the caller or here).
 * @param opts.seeds   explicit seed URLs (#16). When provided, these are crawled
 *                     IN ADDITION to the auto-derived profile seeds (treated as
 *                     storage-kind roots → enumerated as container listings).
 *                     Lets a caller warm specific subtrees `WarmConfig.seeds`
 *                     names without relying solely on profile derivation.
 */
export async function warm(
  webId: string,
  deps: WarmDeps,
  budget: ResolvedWarmBudget = DEFAULT_WARM_BUDGET,
  profileTurtle?: string,
  opts?: { seeds?: string[] },
): Promise<WarmResult> {
  const state: CrawlState = {
    enqueued: new Set(),
    negative: new Set(),
    warmed: 0,
    visited: 0,
    bytes: 0,
    pruned: [],
    budgetHit: false,
    visits: [],
    reserved: 0,
  };

  // #16 (re-review corrective): explicit custom seeds are INDEPENDENT of profile
  // discovery. Build them up front so they are crawled even if the profile fetch
  // fails — a caller who named seeds explicitly should not lose them just because
  // the WebID document was unreadable.
  const customSeeds: Seed[] = (opts?.seeds ?? []).map((url) => ({ url, kind: 'storage' }));

  // 1. Get the profile (seed root). Fetch it through the page fetch so it's cached too.
  let profile = profileTurtle;
  if (profile === undefined) {
    try {
      const res = await deps.fetch(rdfRequest(webId));
      if (res.ok) {
        profile = await res.text();
        recordVisit(state, deps, {
          url: webId,
          kind: 'profile',
          depth: 0,
          status: res.status,
          bytes: byteLen(profile),
        });
      }
      // else: profile unreadable → no DERIVED seeds, but still crawl custom seeds.
    } catch {
      // Network error fetching the profile → same: derived seeds unavailable, but
      // explicit custom seeds are still crawled below.
    }
  }

  // 2. Derive seeds from the profile if we got one (Type-Index-first ordering).
  const seeds: Seed[] = profile !== undefined ? deriveSeeds(webId, profile) : [];
  // If there is nothing to crawl at all (no profile-derived seeds and no explicit
  // custom seeds), finish early.
  if (seeds.length === 0 && customSeeds.length === 0) {
    return finalize(state);
  }

  // 3. Build the initial frontier. Seeds are ordered: typeIndex → storage → inbox.
  //    We push them onto a depth-0 frontier preserving that priority order.
  const frontier: FrontierItem[] = [];
  for (const seed of orderSeeds([...seeds, ...customSeeds])) {
    enqueue(state, frontier, seed.url, seed.kind, 0);
  }

  // 4. BFS, level by level, with a concurrency cap per drain.
  let depth = 0;
  let current = frontier.splice(0);
  while (current.length > 0 && !budgetExceeded(state, budget)) {
    if (depth > budget.maxDepth) break;
    const next: FrontierItem[] = [];
    await drain(current, budget.concurrency, async (item) => {
      if (budgetExceeded(state, budget)) {
        state.budgetHit = true;
        return;
      }
      const discovered = await visit(item, state, deps, budget);
      for (const d of discovered) {
        if (d.depth <= budget.maxDepth) enqueue(state, next, d.url, d.kind, d.depth);
      }
    });
    current = next;
    depth += 1;
  }

  return finalize(state);
}

/**
 * Type-Index-first ordering (decision 6): typeIndex seeds, then storage, then
 * inbox/acl. `deriveSeeds` already emits in this order, but we make it explicit
 * + stable so the contract is testable independent of derivation order.
 */
function orderSeeds(seeds: Seed[]): Seed[] {
  const rank: Record<SeedKind, number> = {
    typeIndex: 0,
    storage: 1,
    inbox: 2,
    acl: 3,
    profile: 4,
  };
  return [...seeds].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function enqueue(
  state: CrawlState,
  frontier: FrontierItem[],
  url: string,
  kind: SeedKind | 'child',
  depth: number,
): void {
  if (state.enqueued.has(url) || state.negative.has(url)) return;
  state.enqueued.add(url);
  frontier.push({ url, kind, depth });
}

/**
 * Visit one resource: fetch it through the page fetch (SW caches it), handle
 * ACL pruning on 403/404, decide whether to pull bytes, and enumerate children.
 * Returns the next-level items discovered (container members, type-index targets,
 * ACL doc).
 *
 * The body reads as a short pipeline of guard clauses + named steps; the
 * non-obvious INVARIANT it preserves is the #10 byte-budget reservation (the
 * synchronous slot reserved AFTER the HEAD probe rules out binary/large but
 * BEFORE the byte-warming GET — see `reserveSlot`). Each step is its own helper so
 * the control flow here stays flat.
 */
async function visit(
  item: FrontierItem,
  state: CrawlState,
  deps: WarmDeps,
  budget: ResolvedWarmBudget,
): Promise<FrontierItem[]> {
  const discovered: FrontierItem[] = [];

  // #9: HEAD-probe first. A binary / declared-large resource is recorded
  // metadata-only and short-circuits here, so the byte-pulling GET is never issued.
  if (await probeHeadForSkip(item, state, deps)) return discovered;

  // #10: reserve the byte-budget slot synchronously BEFORE the GET (the GET is what
  // flows through the SW + caches bytes), so concurrent workers can't overshoot.
  if (!reserveSlot(state, budget)) return discovered;

  const res = await fetchOrRecordError(item, state, deps);
  if (!res) return discovered;

  state.visited += 1;

  // ACL pruning: a genuine 403/404 (the authoritative signal, unlike the HEAD
  // probe) is negative-cached and the subtree pruned — never surfaced as an error.
  if (res.status === 403 || res.status === 404) {
    return pruneForbidden(item, res.status, state, deps, discovered);
  }
  if (!res.ok) {
    recordVisit(state, deps, errorVisit(item, res.status));
    return discovered;
  }

  // GET succeeded. A binary / declared-large response (the HEAD probe missed it, or
  // there was no usable HEAD) is metadata-only; otherwise pull bytes + enumerate.
  return warmGetResponse(item, res, state, deps, budget, discovered);
}

/**
 * HEAD-probe the resource and, if it is a binary / declared-large file, record it
 * metadata-only (NO byte-pulling GET) and report it as handled (caller returns).
 * Returns `false` (continue to the GET) for RDF/small resources, an unreadable
 * HEAD, or a HEAD error — and crucially for a HEAD 403/404, which is INCONCLUSIVE
 * (a server may only honour credentials on the GET path), so the real GET is the
 * authoritative ACL signal (`pruneForbidden` runs there).
 */
async function probeHeadForSkip(
  item: FrontierItem,
  state: CrawlState,
  deps: WarmDeps,
): Promise<boolean> {
  let head: Response | undefined;
  try {
    head = await deps.fetch(headRequest(item.url));
  } catch {
    return false; // HEAD unsupported / errored → fall back to the GET path.
  }
  if (!head.ok) return false;

  const skipped = sizeSkipReason(
    head.headers.get('content-type'),
    head.headers.get('content-length'),
  );
  if (!skipped) return false;

  state.visited += 1;
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status: head.status,
    bytes: bodyBytes(null, head.headers.get('content-length')),
    skipped,
  });
  return true;
}

/**
 * Reserve one byte-budget slot synchronously (#10). Returns `false` (and flags
 * `budgetHit`) when the cap is already reached — the caller then skips the GET.
 * `reserved` is a conservative upper bound: a GET that later 403s or busts the
 * byte budget still consumed a slot (the safe direction for a cap).
 */
function reserveSlot(state: CrawlState, budget: ResolvedWarmBudget): boolean {
  if (state.reserved >= budget.maxResources) {
    state.budgetHit = true;
    return false;
  }
  state.reserved += 1;
  return true;
}

/** GET the resource; on a network error record a `fetch-error` visit + return undefined. */
async function fetchOrRecordError(
  item: FrontierItem,
  state: CrawlState,
  deps: WarmDeps,
): Promise<Response | undefined> {
  try {
    return await deps.fetch(rdfRequest(item.url));
  } catch {
    recordVisit(state, deps, errorVisit(item, 0));
    return undefined;
  }
}

/**
 * Process a successful (2xx) GET: metadata-only for a binary / declared-large file,
 * else pull the bytes (within the byte budget) and enumerate children. Returns the
 * discovered frontier items (mutating `discovered` in place + returning it).
 */
async function warmGetResponse(
  item: FrontierItem,
  res: Response,
  state: CrawlState,
  deps: WarmDeps,
  budget: ResolvedWarmBudget,
  discovered: FrontierItem[],
): Promise<FrontierItem[]> {
  // ACL-aware descent: no read on the listing ⇒ don't enumerate its subtree.
  // Absent header ⇒ proceed (a child 403 prunes later).
  const canRead = userCanRead(res.headers.get('wac-allow'));
  const contentType = res.headers.get('content-type');
  const contentLength = res.headers.get('content-length');
  const container = isContainerListing(item, contentType);

  // Binary / declared-large: record metadata only, never pull the bytes.
  const skipReason = sizeSkipReason(contentType, contentLength);
  if (skipReason) {
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes: bodyBytes(null, contentLength),
      skipped: skipReason,
    });
    return discovered;
  }

  // RDF / small resource: pull the bytes (this is what populates the SW cache).
  // The slot was already reserved before the GET (#10).
  const buf = await safeArrayBuffer(res);
  const bytes = bodyBytes(buf, contentLength);

  // Over the byte budget — count it visited but not warmed; still enumerate a
  // readable container listing (we already have the body).
  if (state.bytes + bytes > budget.maxBytes) {
    state.budgetHit = true;
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes,
      skipped: 'large-resource',
    });
    if (container && canRead) enumerateContainer(item, decodeBody(buf), discovered);
    return discovered;
  }

  state.warmed += 1;
  state.bytes += bytes;
  if (canRead) enumerateChildren(item, decodeBody(buf), container, discovered);
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status: res.status,
    bytes,
  });
  enqueueAcl(item, res.headers.get('link'), state, discovered);
  return discovered;
}

/** The size-skip reason for a response, or `undefined` to pull its bytes. */
function sizeSkipReason(
  contentType: string | null,
  contentLength: string | null,
): 'large-binary' | 'large-resource' | undefined {
  if (isBinaryType(contentType)) return 'large-binary';
  if (bodyBytes(null, contentLength) > LARGE_RESOURCE_BYTES) return 'large-resource';
  return undefined;
}

/** Whether to treat a fetched resource's body as a container listing to enumerate. */
function isContainerListing(item: FrontierItem, contentType: string | null): boolean {
  return (
    isContainer(item.url) ||
    Boolean(
      contentType?.toLowerCase().includes('text/turtle') && wantsContainerEnumeration(item.kind),
    )
  );
}

/** Enumerate the children of a warmed resource body (type-index targets + container members). */
function enumerateChildren(
  item: FrontierItem,
  body: string,
  container: boolean,
  discovered: FrontierItem[],
): void {
  if (item.kind === 'typeIndex') {
    for (const t of typeIndexTargets(item.url, body)) {
      discovered.push({ url: t, kind: 'child', depth: item.depth + 1 });
    }
  }
  if (container || wantsContainerEnumeration(item.kind)) {
    enumerateContainer(item, body, discovered);
  }
}

/** Enqueue the ACL document for a warmed resource (read its WAC; cheap, RDF). */
function enqueueAcl(
  item: FrontierItem,
  linkHeader: string | null,
  state: CrawlState,
  discovered: FrontierItem[],
): void {
  const acl = aclUrlFor(item.url, linkHeader);
  if (acl && !state.enqueued.has(acl) && !state.negative.has(acl)) {
    discovered.push({ url: acl, kind: 'acl', depth: item.depth + 1 });
  }
}

/** Decode a fetched body buffer to text (empty string when the buffer is null). */
function decodeBody(buf: ArrayBuffer | null): string {
  return buf ? new TextDecoder().decode(buf) : '';
}

/** A `fetch-error` visit record (a network error or a non-2xx non-403/404 status). */
function errorVisit(item: FrontierItem, status: number): WarmVisit {
  return {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status,
    bytes: 0,
    skipped: 'fetch-error',
  };
}

/** Record a 403/404 as negative-cached + pruned, and stop descent. */
function pruneForbidden(
  item: FrontierItem,
  status: number,
  state: CrawlState,
  deps: WarmDeps,
  discovered: FrontierItem[],
): FrontierItem[] {
  state.negative.add(item.url);
  state.pruned.push(item.url);
  deps.negativeCache?.(item.url, status);
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status,
    bytes: 0,
    skipped: status === 403 ? 'forbidden' : 'not-found',
  });
  return discovered; // prune: do not enumerate children of a forbidden/missing node
}

/** Build a HEAD probe request (metadata only — no byte body to cache). */
function headRequest(url: string): Request {
  return new Request(url, { method: 'HEAD', headers: { accept: 'text/turtle' } });
}

/** Enumerate ldp:contains members of a container listing into the frontier. */
function enumerateContainer(item: FrontierItem, body: string, discovered: FrontierItem[]): void {
  for (const child of containerChildren(item.url, body)) {
    discovered.push({ url: child, kind: 'child', depth: item.depth + 1 });
  }
}

/** Seed kinds whose body we always treat as a container listing to enumerate. */
function wantsContainerEnumeration(kind: SeedKind | 'child'): boolean {
  return kind === 'storage' || kind === 'inbox' || kind === 'child';
}

function budgetExceeded(state: CrawlState, budget: ResolvedWarmBudget): boolean {
  // Check RESERVATIONS, not just completed `warmed` (the #10 LOW corrective): once
  // `reserved` hits the cap, admitting more frontier items would only generate
  // more HEAD probes for resources we'll never warm. `reserved >= warmed` always,
  // so this is the tighter (correct) gate.
  if (state.reserved >= budget.maxResources || state.warmed >= budget.maxResources) {
    state.budgetHit = true;
    return true;
  }
  if (state.bytes >= budget.maxBytes) {
    state.budgetHit = true;
    return true;
  }
  return false;
}

async function safeArrayBuffer(res: Response): Promise<ArrayBuffer | null> {
  try {
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** Build a GET asking for Turtle (matches the SW's canonical RDF variant). */
function rdfRequest(url: string): Request {
  return new Request(url, {
    method: 'GET',
    headers: { accept: 'text/turtle' },
  });
}

function recordVisit(state: CrawlState, deps: WarmDeps, visit: WarmVisit): void {
  state.visits.push(visit);
  deps.onVisit?.(visit);
}

function finalize(state: CrawlState): WarmResult {
  return {
    warmed: state.warmed,
    visited: state.visited,
    bytes: state.bytes,
    pruned: state.pruned,
    budgetHit: state.budgetHit,
    visits: state.visits,
  };
}

/**
 * Bounded-concurrency drain: run `worker(item)` for each item with at most
 * `concurrency` in flight. Pure async; no timers.
 */
async function drain<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, concurrency);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  async function runOne(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      const item = items[idx];
      if (item === undefined) continue;
      await worker(item);
    }
  }
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(runOne());
  }
  await Promise.all(runners);
}

// ────────────────────────────────────────────────────────────────────────────
// Triggers (browser-only; excluded from coverage). Post-login idle + reconnect.
// ────────────────────────────────────────────────────────────────────────────

/** Resolve a partial budget (from config) against decision-6 defaults. */
export function resolveBudget(partial?: {
  maxResources?: number;
  resources?: number;
  maxBytes?: number;
  bytes?: number;
  maxDepth?: number;
  depth?: number;
  concurrency?: number;
}): ResolvedWarmBudget {
  return {
    maxResources: partial?.maxResources ?? partial?.resources ?? DEFAULT_WARM_BUDGET.maxResources,
    maxBytes: partial?.maxBytes ?? partial?.bytes ?? DEFAULT_WARM_BUDGET.maxBytes,
    maxDepth: partial?.maxDepth ?? partial?.depth ?? DEFAULT_WARM_BUDGET.maxDepth,
    concurrency: partial?.concurrency ?? DEFAULT_WARM_BUDGET.concurrency,
  };
}

/**
 * Schedule `task` for the next idle period (post-login warm), with a timeout
 * fallback where `requestIdleCallback` is unavailable (Safari/SW-less contexts).
 * Returns a cancel function.
 */
export function onIdle(task: () => void, timeoutMs = 2000): () => void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  ).requestIdleCallback;
  const cic = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(task, { timeout: timeoutMs });
    return () => cic?.(id);
  }
  const t = setTimeout(task, 0);
  return () => clearTimeout(t);
}

/**
 * A warm controller: runs the initial warm post-login (on idle), and on
 * reconnect runs a dedicated ETag-RESYNC SWEEP (NOT a full re-warm).
 *
 * P3 REFACTOR (the gap P2 flagged): P2 re-issued the entire BFS on `online` and
 * relied on the SWR layer to make it cheap. That re-did discovery/traversal for
 * no new information. P3 replaces it: on reconnect we invoke `onReconnect` — a
 * dedicated flat ETag-resync sweep of the already-warmed set (`invalidation.resyncSweep`,
 * driven through the SW by the notifications client) — and do NOT re-crawl. A
 * full re-warm only happens on an explicit `run()`.
 */
export interface WarmController {
  /** Run (or re-run) the FULL warm now (BFS). Resolves with the result. */
  run(): Promise<WarmResult>;
  /**
   * Resolve with the result of the next warm to COMPLETE — without forcing a new
   * crawl. If a warm is already in flight (e.g. the post-login idle warm),
   * resolves with that; if one is scheduled (idle) it resolves once it runs.
   * Used by notification topic-derivation so it reuses the scheduled warm rather
   * than triggering a duplicate full crawl (#13).
   */
  result(): Promise<WarmResult>;
  /** Stop listening for reconnect events and cancel any pending idle task. */
  stop(): void;
}

export interface WarmControllerOptions {
  webId: string;
  deps: WarmDeps;
  budget?: ResolvedWarmBudget;
  /** Reuse an already-fetched profile body (avoids a refetch on first run). */
  profileTurtle?: string;
  /** Explicit custom seed URLs (#16, `WarmConfig.seeds`), crawled alongside derived seeds. */
  seeds?: string[];
  /** Run the first warm on idle after construction (default true). */
  warmOnLogin?: boolean;
  /** React to reconnect (default true). */
  rewarmOnReconnect?: boolean;
  /**
   * P3: the reconnect handler. When supplied, reconnect invokes THIS dedicated
   * ETag-resync sweep instead of re-running the full BFS — the P2-gap refactor.
   * `index.ts` wires this to the SW's `resyncSweep` via the notifications client.
   * When omitted (back-compat / no notifications), reconnect falls back to a
   * full `run()` as in P2.
   */
  onReconnect?: () => void;
}

export function createWarmController(opts: WarmControllerOptions): WarmController {
  const budget = opts.budget ?? DEFAULT_WARM_BUDGET;
  let cancelIdle: (() => void) | undefined;
  let onlineHandler: (() => void) | undefined;
  let running: Promise<WarmResult> | undefined;
  // Waiters on the next completed warm (see `result()`), so topic derivation can
  // reuse the scheduled warm instead of forcing a new crawl (#13). We track BOTH
  // resolve and reject so a FAILED warm settles waiters rather than hanging them
  // forever (and never leaves an unhandled rejection on the coalescing branch).
  let pendingResultWaiters: Array<{
    resolve: (r: WarmResult) => void;
    reject: (e: unknown) => void;
  }> = [];

  function run(): Promise<WarmResult> {
    // Coalesce concurrent runs (e.g. login + reconnect racing).
    if (running) return running;
    running = warm(opts.webId, opts.deps, budget, opts.profileTurtle, {
      ...(opts.seeds ? { seeds: opts.seeds } : {}),
    }).finally(() => {
      running = undefined;
    });
    // Settle pending `result()` waiters on BOTH success and failure. We attach a
    // dedicated handler (not the returned promise) so a `result()` consumer's
    // failure handling can't reject the caller of `run()`, and a missing waiter
    // can't surface as an unhandled rejection here.
    running.then(
      (r) => {
        const waiters = pendingResultWaiters;
        pendingResultWaiters = [];
        for (const w of waiters) w.resolve(r);
      },
      (e) => {
        const waiters = pendingResultWaiters;
        pendingResultWaiters = [];
        for (const w of waiters) w.reject(e);
      },
    );
    return running;
  }

  function result(): Promise<WarmResult> {
    // A warm is in flight → reuse it.
    if (running) return running;
    // Otherwise wait for the NEXT warm to settle (e.g. the scheduled idle warm) —
    // resolves on success, rejects on failure (never hangs).
    return new Promise<WarmResult>((resolve, reject) => {
      pendingResultWaiters.push({ resolve, reject });
    });
  }

  if (opts.warmOnLogin !== false) {
    cancelIdle = onIdle(() => {
      void run();
    });
  }

  if (opts.rewarmOnReconnect !== false && typeof globalThis.addEventListener === 'function') {
    // P3: prefer the dedicated ETag-resync sweep; only fall back to a full BFS
    // re-warm when no sweep was wired (no notifications path).
    onlineHandler = opts.onReconnect
      ? () => opts.onReconnect?.()
      : () => {
          void run();
        };
    globalThis.addEventListener('online', onlineHandler);
  }

  return {
    run,
    result,
    stop(): void {
      cancelIdle?.();
      if (onlineHandler && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('online', onlineHandler);
      }
      // Reject any outstanding waiters so callers don't hang after teardown.
      const waiters = pendingResultWaiters;
      pendingResultWaiters = [];
      for (const w of waiters) w.reject(new Error('[solid-offline] warm controller stopped'));
    },
  };
}
