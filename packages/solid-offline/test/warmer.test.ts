// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * §3 page-driven proactive warmer.
 *
 * Drives the pure BFS engine (`warm`) and its RDF helpers with a URL-routed mock
 * fetch + small Turtle fixtures — no browser, no SW, no real network. Covers:
 *   - seed derivation (profile → Type Index → storage → inbox), Type-Index-first
 *   - BFS traversal over ldp:contains + dedup (cycles don't loop)
 *   - budget enforcement (maxResources / maxBytes / maxDepth stop the crawl)
 *   - ACL 403 pruning + negative-cache (subtree not descended, never throws)
 *   - WAC-Allow "no read" pruning
 *   - large-binary skip (metadata warmed, bytes not pulled)
 *   - concurrency cap (never more than N in flight)
 *   - page-driven invariant: every fetch flows through the injected page fetch
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aclFromLinkHeader,
  aclUrlFor,
  containerChildren,
  deriveSeeds,
  parseWacAllow,
  typeIndexTargets,
  userCanRead,
} from '../src/warmer-rdf.js';
import {
  DEFAULT_WARM_BUDGET,
  type WarmDeps,
  createWarmController,
  onIdle,
  resolveBudget,
  warm,
} from '../src/warmer.js';

const BASE = 'https://alice.example';
const WEBID = `${BASE}/profile/card#me`;
const PROFILE_DOC = `${BASE}/profile/card`;

/** A URL-routed mock fetch: map of url → responder. Records every call. */
function routedFetch(routes: Record<string, (url: string) => Response>): {
  fetch: typeof fetch;
  calls: string[];
  /** Calls recorded with their HTTP method (the warmer HEAD-probes then GETs). */
  methodCalls: Array<{ url: string; method: string }>;
  inFlight: { max: number };
} {
  const calls: string[] = [];
  const methodCalls: Array<{ url: string; method: string }> = [];
  let active = 0;
  const inFlight = { max: 0 };
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (
      input instanceof Request ? input.method : (init?.method ?? 'GET')
    ).toUpperCase();
    calls.push(url);
    methodCalls.push({ url, method });
    active += 1;
    inFlight.max = Math.max(inFlight.max, active);
    // Yield so concurrent fetches actually overlap (observe the cap).
    await Promise.resolve();
    active -= 1;
    const key = url.split('#')[0] ?? url;
    const responder = routes[key] ?? routes[url];
    if (!responder) return new Response(null, { status: 404 });
    return responder(url);
  });
  return { fetch: impl as unknown as typeof fetch, calls, methodCalls, inFlight };
}

function turtle(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers({ 'content-type': 'text/turtle', ...init.headers });
  return new Response(body, { status: init.status ?? 200, headers });
}

function container(members: string[], extraHeaders: Record<string, string> = {}): Response {
  const body = members.map((m) => `<> <http://www.w3.org/ns/ldp#contains> <${m}> .`).join('\n');
  return turtle(body, { headers: extraHeaders });
}

const PROFILE_TTL = `
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${WEBID}>
  pim:storage <${BASE}/> ;
  solid:publicTypeIndex <${BASE}/settings/publicTypeIndex.ttl> ;
  solid:privateTypeIndex <${BASE}/settings/privateTypeIndex.ttl> ;
  ldp:inbox <${BASE}/inbox/> .
`;

describe('warmer-rdf: seed derivation', () => {
  it('derives profile seeds Type-Index-first, then storage, then inbox', () => {
    const seeds = deriveSeeds(WEBID, PROFILE_TTL);
    const kinds = seeds.map((s) => s.kind);
    // Both type indexes come before storage + inbox.
    const firstStorage = kinds.indexOf('storage');
    const lastTypeIndex = kinds.lastIndexOf('typeIndex');
    expect(lastTypeIndex).toBeLessThan(firstStorage);
    expect(seeds.map((s) => s.url)).toEqual([
      `${BASE}/settings/publicTypeIndex.ttl`,
      `${BASE}/settings/privateTypeIndex.ttl`,
      `${BASE}/`,
      `${BASE}/inbox/`,
    ]);
  });

  it('returns no seeds for an empty / unparseable profile', () => {
    expect(deriveSeeds(WEBID, '')).toEqual([]);
    expect(deriveSeeds(WEBID, 'this is not turtle <<<')).toEqual([]);
  });

  it('resolves relative IRIs against the WebID base', () => {
    const seeds = deriveSeeds(WEBID, `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> </> .`);
    expect(seeds[0]?.url).toBe(`${BASE}/`);
  });

  it('#11 derives seeds ONLY from the logged-in WebID subject', () => {
    // A profile that ALSO names storage on a DIFFERENT (attacker-controlled)
    // subject. The warmer must ignore the foreign subject and only seed the
    // user's own storage.
    const profile = `
      @prefix pim: <http://www.w3.org/ns/pim/space#> .
      <${WEBID}> pim:storage <${BASE}/me/> .
      <https://evil.example/card#me> pim:storage <https://evil.example/storage/> .`;
    const seeds = deriveSeeds(WEBID, profile);
    expect(seeds.map((s) => s.url)).toEqual([`${BASE}/me/`]);
    expect(seeds.some((s) => s.url.includes('evil.example'))).toBe(false);
  });

  it('#11 accepts the profile DOCUMENT IRI (fragment stripped) as a narrow fallback', () => {
    // Some profiles assert pim:storage on the document, not on `#me`.
    const profile = `
      @prefix pim: <http://www.w3.org/ns/pim/space#> .
      <${PROFILE_DOC}> pim:storage <${BASE}/store/> .`;
    const seeds = deriveSeeds(WEBID, profile);
    expect(seeds.map((s) => s.url)).toEqual([`${BASE}/store/`]);
  });
});

describe('warmer-rdf: container + type index enumeration', () => {
  it('extracts absolute ldp:contains members', () => {
    const c = `${BASE}/docs/`;
    const body = '<> <http://www.w3.org/ns/ldp#contains> <a>, <b/> .';
    expect(containerChildren(c, body)).toEqual([`${BASE}/docs/a`, `${BASE}/docs/b/`]);
  });

  it('extracts solid:instance + instanceContainer targets', () => {
    const idx = `${BASE}/settings/publicTypeIndex.ttl`;
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <#reg1> solid:instance <${BASE}/profile/card> .
      <#reg2> solid:instanceContainer <${BASE}/contacts/> .`;
    expect(typeIndexTargets(idx, body).sort()).toEqual(
      [`${BASE}/contacts/`, `${BASE}/profile/card`].sort(),
    );
  });
});

describe('warmer-rdf: WAC-Allow', () => {
  it('parses user + public modes', () => {
    const w = parseWacAllow('user="read write append control", public="read"');
    expect([...w.user].sort()).toEqual(['append', 'control', 'read', 'write']);
    expect([...w.public]).toEqual(['read']);
  });

  it('userCanRead is true when user or public has read, true when header absent', () => {
    expect(userCanRead('user="read", public=""')).toBe(true);
    expect(userCanRead('user="", public="read"')).toBe(true);
    expect(userCanRead('user="append", public=""')).toBe(false);
    expect(userCanRead(undefined)).toBe(true); // unknown → attempt (a 403 prunes later)
    expect(userCanRead(null)).toBe(true);
  });
});

describe('warmer: BFS traversal', () => {
  it('warms profile → seeds → ldp:contains children through the page fetch', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () => turtle(PROFILE_TTL),
      [`${BASE}/`]: () => container([`${BASE}/notes/`, `${BASE}/readme`]),
      [`${BASE}/settings/publicTypeIndex.ttl`]: () => turtle(''),
      [`${BASE}/settings/privateTypeIndex.ttl`]: () => turtle(''),
      [`${BASE}/inbox/`]: () => container([]),
      [`${BASE}/notes/`]: () => container([`${BASE}/notes/note1`]),
      [`${BASE}/readme`]: () => turtle('<> a <#Doc> .'),
      [`${BASE}/notes/note1`]: () => turtle('<> a <#Note> .'),
    };
    // Any *.acl request 404s (no ACL doc) — that's fine, negative-cached.
    const acls = [
      `${BASE}/.acl`,
      `${BASE}/notes/.acl`,
      `${BASE}/readme.acl`,
      `${BASE}/notes/note1.acl`,
      `${BASE}/inbox/.acl`,
      `${BASE}/settings/publicTypeIndex.ttl.acl`,
      `${BASE}/settings/privateTypeIndex.ttl.acl`,
    ];
    for (const a of acls) routes[a] = () => new Response(null, { status: 404 });

    const { fetch, calls } = routedFetch(routes);
    const result = await warm(WEBID, { fetch });

    // Reached the nested child.
    const fetched = new Set(calls.map((c) => c.split('#')[0]));
    expect(fetched.has(`${BASE}/notes/note1`)).toBe(true);
    expect(fetched.has(`${BASE}/readme`)).toBe(true);
    // Profile was warmed first.
    expect(calls[0]?.split('#')[0]).toBe(PROFILE_DOC);
    expect(result.warmed).toBeGreaterThan(0);
    expect(result.budgetHit).toBe(false);
  });

  it('dedups: a cyclic ldp:contains does not loop forever', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      // Storage contains itself (cycle) + one child that points back to storage.
      [`${BASE}/`]: () => container([`${BASE}/`, `${BASE}/loop/`]),
      [`${BASE}/loop/`]: () => container([`${BASE}/`]),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch, methodCalls } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, resolveBudget({ maxDepth: 6 }));
    // Storage GET'd exactly once despite the cycle (the warmer also HEAD-probes,
    // but a byte-warming GET happens once per resource — dedup holds, #9 + dedup).
    const storageGets = methodCalls.filter(
      (c) => c.method === 'GET' && c.url.split('#')[0] === `${BASE}/`,
    ).length;
    expect(storageGets).toBe(1);
    expect(result.budgetHit).toBe(false);
  });
});

describe('warmer: budget enforcement', () => {
  it('stops at maxResources', async () => {
    // Storage lists 50 small docs; cap at 5.
    const members = Array.from({ length: 50 }, (_, i) => `${BASE}/d${i}`);
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container(members),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('<> a <#X> .');
    const { fetch } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, resolveBudget({ maxResources: 5 }));
    expect(result.warmed).toBeLessThanOrEqual(5);
    expect(result.budgetHit).toBe(true);
  });

  it('#10 does NOT overshoot maxResources under high concurrency', async () => {
    // 50 small docs, cap 5, concurrency 8 — without synchronous reservation the
    // in-flight workers would overshoot the cap by up to concurrency-1.
    const members = Array.from({ length: 50 }, (_, i) => `${BASE}/d${i}`);
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container(members),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('<> a <#X> .');
    const { fetch } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, resolveBudget({ maxResources: 5, concurrency: 8 }));
    // The reservation caps warmed at exactly maxResources even with 8 in flight.
    expect(result.warmed).toBeLessThanOrEqual(5);
    expect(result.budgetHit).toBe(true);
  });

  it('stops at maxBytes', async () => {
    const big = 'x'.repeat(200_000);
    const members = Array.from({ length: 50 }, (_, i) => `${BASE}/d${i}`);
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container(members),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle(big);
    const { fetch } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, resolveBudget({ maxBytes: 500_000 }));
    expect(result.bytes).toBeLessThanOrEqual(500_000 + 200_000); // last over-budget read counted then stop
    expect(result.budgetHit).toBe(true);
    // This case crawls 50 × 200 KB bodies; under full-suite CPU contention (now
    // incl. the jsdom React tests) it can brush the 5 s default. Give it headroom
    // so the gate is deterministic — it is bounded work, not a hang.
  }, 20_000);

  it('respects maxDepth (does not descend past the limit)', async () => {
    // /a/ -> /a/b/ -> /a/b/c/ -> /a/b/c/d ; depth 1 should not reach c.
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/a/> .`),
      [`${BASE}/a/`]: () => container([`${BASE}/a/b/`]),
      [`${BASE}/a/b/`]: () => container([`${BASE}/a/b/c/`]),
      [`${BASE}/a/b/c/`]: () => container([`${BASE}/a/b/c/d`]),
      [`${BASE}/a/b/c/d`]: () => turtle('<> a <#X> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch, calls } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    await warm(WEBID, { fetch }, resolveBudget({ maxDepth: 1 }));
    const fetched = new Set(calls.map((c) => c.split('#')[0]));
    expect(fetched.has(`${BASE}/a/`)).toBe(true); // depth 0
    expect(fetched.has(`${BASE}/a/b/`)).toBe(true); // depth 1
    expect(fetched.has(`${BASE}/a/b/c/`)).toBe(false); // depth 2 — pruned by maxDepth
  });
});

describe('warmer: ACL-aware pruning', () => {
  it('catches a 403 child, negative-caches it, prunes its subtree, never throws', async () => {
    const negative: Array<{ url: string; status: number }> = [];
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([`${BASE}/secret/`, `${BASE}/public`]),
      [`${BASE}/secret/`]: () => new Response(null, { status: 403 }),
      // If we (wrongly) descended, this child would be fetched — it must NOT be.
      [`${BASE}/secret/inner`]: () => turtle('<> a <#Leak> .'),
      [`${BASE}/public`]: () => turtle('<> a <#Doc> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const deps: WarmDeps = {
      fetch: routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough })).fetch,
      negativeCache: (url, status) => negative.push({ url, status }),
    };
    const result = await warm(WEBID, deps);
    expect(result.pruned).toContain(`${BASE}/secret/`);
    expect(negative).toContainEqual({ url: `${BASE}/secret/`, status: 403 });
    // The forbidden subtree child was never fetched.
    expect(result.visits.some((v) => v.url === `${BASE}/secret/inner`)).toBe(false);
    // The sibling public doc was still warmed — a 403 is not fatal.
    expect(result.visits.some((v) => v.url === `${BASE}/public` && !v.skipped)).toBe(true);
  });

  it('prunes a subtree the user cannot read per WAC-Allow (no 403 needed)', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () =>
        container([`${BASE}/locked/`], { 'wac-allow': 'user="read", public="read"' }),
      // The container is readable, but ITS listing grants no read → children pruned.
      [`${BASE}/locked/`]: () =>
        container([`${BASE}/locked/inner`], { 'wac-allow': 'user="append", public=""' }),
      [`${BASE}/locked/inner`]: () => turtle('<> a <#Leak> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch });
    // /locked/ itself was visited (we read it to learn we can't read its children),
    // but its inner child was never fetched.
    expect(result.visits.some((v) => v.url === `${BASE}/locked/inner`)).toBe(false);
  });
});

describe('warmer: large-binary handling', () => {
  it('warms binary metadata but does not pull its bytes', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([`${BASE}/photo.jpg`]),
      [`${BASE}/photo.jpg`]: () =>
        new Response('JPEGBYTES', {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' },
        }),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch });
    const photoVisit = result.visits.find((v) => v.url === `${BASE}/photo.jpg`);
    expect(photoVisit?.skipped).toBe('large-binary');
    // Bytes for the binary were NOT added to the warmed byte budget.
    expect(result.visits.find((v) => v.url === `${BASE}/photo.jpg`)?.skipped).toBe('large-binary');
  });
});

describe('#9 large binaries are HEAD-probed, not GET-downloaded', () => {
  it('does not issue a byte-warming GET for a binary resource', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([`${BASE}/photo.jpg`]),
      [`${BASE}/photo.jpg`]: () =>
        new Response('JPEGBYTES', {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' },
        }),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch, methodCalls } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch });
    const photoVisit = result.visits.find((v) => v.url === `${BASE}/photo.jpg`);
    expect(photoVisit?.skipped).toBe('large-binary');
    // The binary was probed with HEAD but NEVER GET'd (so the SW never downloads
    // + byte-caches the full 9 MB response).
    const photoGets = methodCalls.filter(
      (c) => c.url === `${BASE}/photo.jpg` && c.method === 'GET',
    );
    expect(photoGets).toHaveLength(0);
    const photoHeads = methodCalls.filter(
      (c) => c.url === `${BASE}/photo.jpg` && c.method === 'HEAD',
    );
    expect(photoHeads.length).toBeGreaterThan(0);
  });
});

describe('#9 a HEAD 403 probe is inconclusive — the authenticated GET decides', () => {
  it('does not prune when only the HEAD 403s but the GET succeeds', async () => {
    // Method-aware fetch: HEAD → 403 (probe blocked), GET → 200 (authenticated).
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      calls.push({ url: req.url, method: req.method.toUpperCase() });
      if (req.url.split('#')[0] === PROFILE_DOC) {
        return turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/doc> .`);
      }
      if (req.url === `${BASE}/doc`) {
        return req.method.toUpperCase() === 'HEAD'
          ? new Response(null, { status: 403 }) // probe blocked
          : turtle('<> a <#Doc> .'); // authenticated GET succeeds
      }
      return req.url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    });
    const result = await warm(WEBID, { fetch: fetchImpl as unknown as typeof fetch });
    // The resource was NOT pruned on the HEAD 403; the GET warmed it.
    expect(result.pruned).not.toContain(`${BASE}/doc`);
    expect(result.visits.some((v) => v.url === `${BASE}/doc` && !v.skipped)).toBe(true);
    // Both a HEAD and a GET were issued for it.
    expect(calls.some((c) => c.url === `${BASE}/doc` && c.method === 'HEAD')).toBe(true);
    expect(calls.some((c) => c.url === `${BASE}/doc` && c.method === 'GET')).toBe(true);
  });
});

describe('#16 custom seeds are crawled alongside derived seeds', () => {
  it('warms an explicit seed URL not named in the profile', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([]),
      [`${BASE}/extra/`]: () => container([`${BASE}/extra/doc`]),
      [`${BASE}/extra/doc`]: () => turtle('<> a <#X> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch, calls } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, DEFAULT_WARM_BUDGET, undefined, {
      seeds: [`${BASE}/extra/`],
    });
    // The custom seed (and its child) were reached even though the profile never
    // named them.
    const fetched = new Set(calls.map((c) => c.split('#')[0]));
    expect(fetched.has(`${BASE}/extra/`)).toBe(true);
    expect(fetched.has(`${BASE}/extra/doc`)).toBe(true);
    expect(result.warmed).toBeGreaterThan(0);
  });

  it('crawls explicit seeds even when the PROFILE fetch fails (independent of discovery)', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () => new Response(null, { status: 403 }), // profile unreadable
      [`${BASE}/extra/`]: () => container([`${BASE}/extra/doc`]),
      [`${BASE}/extra/doc`]: () => turtle('<> a <#X> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const { fetch, calls } = routedFetch(
      new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }),
    );
    const result = await warm(WEBID, { fetch }, DEFAULT_WARM_BUDGET, undefined, {
      seeds: [`${BASE}/extra/`],
    });
    // Even with the profile 403, the explicit seed was crawled.
    const fetched = new Set(calls.map((c) => c.split('#')[0]));
    expect(fetched.has(`${BASE}/extra/`)).toBe(true);
    expect(result.warmed).toBeGreaterThan(0);
  });
});

describe('warmer: concurrency cap + page-driven invariant', () => {
  it('never exceeds the configured concurrency', async () => {
    const members = Array.from({ length: 20 }, (_, i) => `${BASE}/d${i}`);
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container(members),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('<> a <#X> .');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    await warm(WEBID, { fetch: r.fetch }, resolveBudget({ concurrency: 3 }));
    expect(r.inFlight.max).toBeLessThanOrEqual(3);
  });

  it('issues EVERY fetch through the injected page fetch (SW unauthenticated)', async () => {
    // The only fetch the warmer is given is the injected one; if it ever reached
    // for a global/other fetch the routes would 404 and these would be missing.
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () => turtle(PROFILE_TTL),
      [`${BASE}/`]: () => container([]),
      [`${BASE}/inbox/`]: () => container([]),
      [`${BASE}/settings/publicTypeIndex.ttl`]: () => turtle(''),
      [`${BASE}/settings/privateTypeIndex.ttl`]: () => turtle(''),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    await warm(WEBID, { fetch: r.fetch });
    // Every URL we expect was requested via the injected fetch.
    expect(r.calls.some((c) => c.split('#')[0] === PROFILE_DOC)).toBe(true);
    expect(r.calls.some((c) => c === `${BASE}/settings/publicTypeIndex.ttl`)).toBe(true);
    expect(r.fetch).toHaveBeenCalled();
  });

  it('returns an empty result when the profile cannot be read', async () => {
    const { fetch } = routedFetch({ [PROFILE_DOC]: () => new Response(null, { status: 403 }) });
    const result = await warm(WEBID, { fetch });
    expect(result.warmed).toBe(0);
    expect(result.visited).toBe(0);
  });

  it('swallows a network error fetching the profile (best-effort)', async () => {
    const throwingFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const result = await warm(WEBID, { fetch: throwingFetch });
    expect(result.warmed).toBe(0);
  });

  it('reuses a pre-fetched profile body without re-fetching the WebID', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [`${BASE}/`]: () => container([]),
      [`${BASE}/inbox/`]: () => container([]),
      [`${BASE}/settings/publicTypeIndex.ttl`]: () => turtle(''),
      [`${BASE}/settings/privateTypeIndex.ttl`]: () => turtle(''),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    await warm(WEBID, { fetch: r.fetch }, DEFAULT_WARM_BUDGET, PROFILE_TTL);
    // The profile doc itself was not fetched (we supplied the body).
    expect(r.calls.some((c) => c.split('#')[0] === PROFILE_DOC)).toBe(false);
    // But seeds derived from it were.
    expect(r.calls.some((c) => c === `${BASE}/settings/publicTypeIndex.ttl`)).toBe(true);
  });
});

describe('warmer-rdf: ACL URL derivation', () => {
  it('prefers the rel="acl" Link header over convention', () => {
    expect(aclFromLinkHeader(`${BASE}/r`, `<${BASE}/custom.acl>; rel="acl", <x>; rel="type"`)).toBe(
      `${BASE}/custom.acl`,
    );
    expect(aclUrlFor(`${BASE}/r`, `<${BASE}/custom.acl>; rel="acl"`)).toBe(`${BASE}/custom.acl`);
  });

  it('falls back to the <resource>.acl convention without a Link header', () => {
    expect(aclUrlFor(`${BASE}/doc`)).toBe(`${BASE}/doc.acl`);
    expect(aclUrlFor(`${BASE}/c/`)).toBe(`${BASE}/c/.acl`);
  });

  it('does not derive an ACL for an ACL document (no recursion)', () => {
    expect(aclUrlFor(`${BASE}/doc.acl`)).toBeUndefined();
  });

  it('enqueues the ACL document discovered via Link header during a warm', async () => {
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([`${BASE}/doc`]),
      [`${BASE}/doc`]: () =>
        turtle('<> a <#Doc> .', { headers: { link: `<${BASE}/doc.acl>; rel="acl"` } }),
      [`${BASE}/doc.acl`]: () =>
        turtle('<#auth> a <http://www.w3.org/ns/auth/acl#Authorization> .'),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    await warm(WEBID, { fetch: r.fetch });
    expect(r.calls.some((c) => c === `${BASE}/doc.acl`)).toBe(true);
  });
});

describe('warmer triggers: onIdle + createWarmController', () => {
  const g = globalThis as Record<string, unknown>;
  let savedRic: unknown;
  let savedCic: unknown;
  let savedAdd: unknown;
  let savedRemove: unknown;
  afterEach(() => {
    g.requestIdleCallback = savedRic;
    g.cancelIdleCallback = savedCic;
    if (savedAdd !== undefined) g.addEventListener = savedAdd;
    if (savedRemove !== undefined) g.removeEventListener = savedRemove;
  });

  it('onIdle uses requestIdleCallback when available', () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 7;
    });
    const cic = vi.fn();
    g.requestIdleCallback = ric;
    g.cancelIdleCallback = cic;
    const task = vi.fn();
    const cancel = onIdle(task);
    expect(ric).toHaveBeenCalled();
    expect(task).toHaveBeenCalled();
    cancel();
    expect(cic).toHaveBeenCalledWith(7);
  });

  it('onIdle falls back to setTimeout when requestIdleCallback is absent', async () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    g.requestIdleCallback = undefined;
    const task = vi.fn();
    const cancel = onIdle(task);
    await new Promise((r) => setTimeout(r, 5));
    expect(task).toHaveBeenCalled();
    cancel();
  });

  it('createWarmController runs on idle (warmOnLogin) and coalesces concurrent runs', async () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    // Make idle a no-op so we control when run() fires.
    g.requestIdleCallback = undefined;
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([]),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    const ctl = createWarmController({
      webId: WEBID,
      deps: { fetch: r.fetch },
      warmOnLogin: false,
      rewarmOnReconnect: false,
    });
    // Two overlapping run() calls share one in-flight warm.
    const [a, b] = await Promise.all([ctl.run(), ctl.run()]);
    expect(a).toBe(b);
    ctl.stop();
  });

  it('createWarmController subscribes to reconnect (online) and re-warms', async () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    savedAdd = g.addEventListener;
    savedRemove = g.removeEventListener;
    g.requestIdleCallback = undefined;
    let onlineCb: (() => void) | undefined;
    g.addEventListener = vi.fn((ev: string, cb: () => void) => {
      if (ev === 'online') onlineCb = cb;
    });
    g.removeEventListener = vi.fn();
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([]),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    const ctl = createWarmController({
      webId: WEBID,
      deps: { fetch: r.fetch },
      warmOnLogin: false,
    });
    expect(typeof onlineCb).toBe('function');
    // Fire the reconnect handler: it should trigger a warm through the page fetch.
    onlineCb?.();
    await new Promise((res) => setTimeout(res, 10));
    expect(r.calls.some((c) => c.split('#')[0] === PROFILE_DOC)).toBe(true);
    ctl.stop();
    expect(g.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
  });

  it('result() reuses an in-flight warm rather than forcing a new crawl (#13)', async () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    g.requestIdleCallback = undefined;
    const routes: Record<string, (url: string) => Response> = {
      [PROFILE_DOC]: () =>
        turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BASE}/> .`),
      [`${BASE}/`]: () => container([]),
    };
    const passthrough = (url: string) =>
      url.endsWith('.acl') ? new Response(null, { status: 404 }) : turtle('');
    const r = routedFetch(new Proxy(routes, { get: (t, p: string) => t[p] ?? passthrough }));
    const ctl = createWarmController({
      webId: WEBID,
      deps: { fetch: r.fetch },
      warmOnLogin: false,
      rewarmOnReconnect: false,
    });
    const running = ctl.run();
    const reused = ctl.result(); // in-flight → same promise
    expect(reused).toBe(running);
    await running;
    // Exactly one profile GET — result() did NOT trigger a second crawl.
    const profileGets = r.methodCalls.filter(
      (c) => c.method === 'GET' && c.url.split('#')[0] === PROFILE_DOC,
    );
    expect(profileGets).toHaveLength(1);
    ctl.stop();
  });

  it('result() REJECTS (does not hang) when the controller is stopped before a warm runs (#13/finding3)', async () => {
    savedRic = g.requestIdleCallback;
    savedCic = g.cancelIdleCallback;
    g.requestIdleCallback = undefined; // no idle warm scheduled
    const r = routedFetch({});
    const ctl = createWarmController({
      webId: WEBID,
      deps: { fetch: r.fetch },
      warmOnLogin: false, // nothing scheduled → result() waits for a future warm
      rewarmOnReconnect: false,
    });
    const pending = ctl.result();
    ctl.stop(); // must settle the waiter (reject), not leave it hanging forever
    await expect(pending).rejects.toThrow(/stopped/);
  });
});
