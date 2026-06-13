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
  type Seed,
  type SeedKind,
  aclUrlFor,
  containerChildren,
  deriveSeeds,
  isContainer,
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
 */
export async function warm(
  webId: string,
  deps: WarmDeps,
  budget: ResolvedWarmBudget = DEFAULT_WARM_BUDGET,
  profileTurtle?: string,
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
  };

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
      } else {
        // Can't read the profile → nothing to warm.
        return finalize(state);
      }
    } catch {
      return finalize(state);
    }
  }

  // 2. Derive seeds (Type-Index-first ordering baked into deriveSeeds).
  const seeds = deriveSeeds(webId, profile);

  // 3. Build the initial frontier. Seeds are ordered: typeIndex → storage → inbox.
  //    We push them onto a depth-0 frontier preserving that priority order.
  const frontier: FrontierItem[] = [];
  for (const seed of orderSeeds(seeds)) {
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
 */
async function visit(
  item: FrontierItem,
  state: CrawlState,
  deps: WarmDeps,
  budget: ResolvedWarmBudget,
): Promise<FrontierItem[]> {
  const discovered: FrontierItem[] = [];

  let res: Response;
  try {
    res = await deps.fetch(rdfRequest(item.url));
  } catch {
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: 0,
      bytes: 0,
      skipped: 'fetch-error',
    });
    return discovered;
  }

  state.visited += 1;

  // ACL pruning: a 403/404 is negative-cached and the subtree is pruned. Never
  // surfaced as an error (§3). The SW also negative-caches what it sees; we mark
  // it here so re-warm skips the subtree and tests can assert it.
  if (res.status === 403 || res.status === 404) {
    state.negative.add(item.url);
    state.pruned.push(item.url);
    deps.negativeCache?.(item.url, res.status);
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes: 0,
      skipped: res.status === 403 ? 'forbidden' : 'not-found',
    });
    return discovered; // prune: do not enumerate children of a forbidden/missing node
  }

  if (!res.ok) {
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes: 0,
      skipped: 'fetch-error',
    });
    return discovered;
  }

  // ACL-aware descent: read WAC-Allow on the listing. If the authenticated user
  // has no read on this resource, prune its subtree (avoid wasting fetches that
  // would 403). Absent header ⇒ proceed (a child 403 will prune later).
  const wacAllow = res.headers.get('wac-allow');
  const canRead = userCanRead(wacAllow);

  const contentType = res.headers.get('content-type');
  const contentLength = res.headers.get('content-length');
  const container =
    isContainer(item.url) ||
    (contentType?.toLowerCase().includes('text/turtle') && wantsContainerEnumeration(item.kind));

  // Decide whether to pull bytes. Large binaries / large resources: metadata only.
  const declaredLarge = bodyBytes(null, contentLength) > LARGE_RESOURCE_BYTES;
  const binary = isBinaryType(contentType);
  let bytes = 0;
  let skipped: WarmVisit['skipped'];

  if (binary) {
    skipped = 'large-binary';
    bytes = bodyBytes(null, contentLength);
  } else if (declaredLarge) {
    skipped = 'large-resource';
    bytes = bodyBytes(null, contentLength);
  } else {
    // Pull bytes (RDF / small resources). This is what populates the SW cache.
    const buf = await safeArrayBuffer(res);
    bytes = bodyBytes(buf, contentLength);
    if (state.bytes + bytes > budget.maxBytes) {
      // Over the byte budget — count it as visited but don't credit it as warmed.
      state.budgetHit = true;
      recordVisit(state, deps, {
        url: item.url,
        kind: item.kind,
        depth: item.depth,
        status: res.status,
        bytes,
        skipped: 'large-resource',
      });
      // Still enumerate children if this was a readable container listing.
      if (container && canRead) {
        const body = buf ? new TextDecoder().decode(buf) : '';
        enumerateContainer(item, body, discovered);
      }
      return discovered;
    }
    state.warmed += 1;
    state.bytes += bytes;

    // Enumerate children from the body (we already have the bytes).
    if (canRead) {
      const body = buf ? new TextDecoder().decode(buf) : '';
      if (item.kind === 'typeIndex') {
        for (const t of typeIndexTargets(item.url, body)) {
          discovered.push({ url: t, kind: 'child', depth: item.depth + 1 });
        }
      }
      if (container || wantsContainerEnumeration(item.kind)) {
        enumerateContainer(item, body, discovered);
      }
    }

    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes,
    });

    // Enqueue the ACL document for this resource (read its WAC; cheap, RDF).
    const acl = aclUrlFor(item.url, res.headers.get('link'));
    if (acl && !state.enqueued.has(acl) && !state.negative.has(acl)) {
      discovered.push({ url: acl, kind: 'acl', depth: item.depth + 1 });
    }
    return discovered;
  }

  // Skipped-for-size path (binary / declared-large): we still recorded metadata.
  state.bytes += 0; // bytes were never pulled
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status: res.status,
    bytes,
    skipped,
  });
  return discovered;
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
  if (state.warmed >= budget.maxResources) {
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
 * A re-warm controller: runs an initial warm post-login (on idle) and a lighter
 * ETag-revalidation sweep on reconnect. Page-driven; uses the page fetch only.
 *
 * On reconnect we re-issue the same warm (the SW's P1 SWR layer turns each GET
 * into a conditional revalidation — mostly cheap 304s), so we don't duplicate
 * the conditional logic here.
 */
export interface WarmController {
  /** Run (or re-run) the warm now. Resolves with the result. */
  run(): Promise<WarmResult>;
  /** Stop listening for reconnect events and cancel any pending idle task. */
  stop(): void;
}

export interface WarmControllerOptions {
  webId: string;
  deps: WarmDeps;
  budget?: ResolvedWarmBudget;
  /** Reuse an already-fetched profile body (avoids a refetch on first run). */
  profileTurtle?: string;
  /** Run the first warm on idle after construction (default true). */
  warmOnLogin?: boolean;
  /** Re-warm (ETag sweep) when the browser comes back online (default true). */
  rewarmOnReconnect?: boolean;
}

export function createWarmController(opts: WarmControllerOptions): WarmController {
  const budget = opts.budget ?? DEFAULT_WARM_BUDGET;
  let cancelIdle: (() => void) | undefined;
  let onlineHandler: (() => void) | undefined;
  let running: Promise<WarmResult> | undefined;

  function run(): Promise<WarmResult> {
    // Coalesce concurrent runs (e.g. login + reconnect racing).
    if (running) return running;
    running = warm(opts.webId, opts.deps, budget, opts.profileTurtle).finally(() => {
      running = undefined;
    });
    return running;
  }

  if (opts.warmOnLogin !== false) {
    cancelIdle = onIdle(() => {
      void run();
    });
  }

  if (opts.rewarmOnReconnect !== false && typeof globalThis.addEventListener === 'function') {
    onlineHandler = () => {
      void run();
    };
    globalThis.addEventListener('online', onlineHandler);
  }

  return {
    run,
    stop(): void {
      cancelIdle?.();
      if (onlineHandler && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('online', onlineHandler);
      }
    },
  };
}
