// AUTHORED-BY Claude Fable 5
/**
 * Executes the real `public/sw.js` in a headless mock ServiceWorkerGlobalScope
 * and drives its install/activate/fetch/message handlers. The load-bearing
 * assertion is the SECURITY INVARIANT: cross-origin (pod / third-party) and
 * non-GET requests are never intercepted or cached — so private pod health data
 * cannot enter the shell cache. Also verifies instant-offline behaviour
 * (UX invariant #3): precache on install, offline navigation fallback,
 * cache-first static assets, versioned cache cleanup, and the purge hook.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://coeliac.example";

/** Minimal in-memory Cache keyed by URL (search-stripped for ignoreSearch). */
class FakeCache {
  store = new Map<string, Response>();
  private key(req: unknown): string {
    const url = typeof req === "string" ? new URL(req, `${ORIGIN}/`).href : (req as { url: string }).url;
    const u = new URL(url);
    u.search = "";
    return u.href;
  }
  async match(req: unknown): Promise<Response | undefined> {
    return this.store.get(this.key(req))?.clone();
  }
  async put(req: unknown, res: Response): Promise<void> {
    this.store.set(this.key(req), res);
  }
  async add(req: unknown): Promise<void> {
    const res = await fakeSelf.fetch(req as Request);
    if (!res.ok) throw new Error(`add: ${res.status}`);
    await this.put(req, res);
  }
  async delete(req: unknown): Promise<boolean> {
    return this.store.delete(this.key(req));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

/** A `Request` shim resolving relative URLs against the SW origin (browser SW behaviour). */
class FakeRequest {
  url: string;
  method: string;
  mode: string | undefined;
  constructor(input: string | FakeRequest, init: { method?: string; mode?: string } = {}) {
    if (typeof input === "string") {
      this.url = new URL(input, `${ORIGIN}/`).href;
      this.method = init.method ?? "GET";
      this.mode = init.mode;
    } else {
      this.url = input.url;
      this.method = init.method ?? input.method;
      this.mode = init.mode ?? input.mode;
    }
  }
  clone(): FakeRequest {
    return this;
  }
}

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();

const fakeSelf = {
  caches: new FakeCacheStorage(),
  location: { origin: ORIGIN, href: `${ORIGIN}/` },
  fetch: vi.fn(async (req: unknown): Promise<Response> => {
    void req;
    return new Response("net", { status: 200 });
  }),
  skipWaiting: vi.fn(async () => undefined),
  clients: { claim: vi.fn(async () => undefined) },
  addEventListener: (type: string, cb: Listener) => listeners.set(type, cb),
};

// Evaluate the real worker source with our mocks injected (bare `Request` is
// shadowed so relative-URL construction works headlessly; `Response`/`URL` are
// the Node globals).
const loadWorker = new Function("self", "Request", SW_SOURCE) as (
  self: unknown,
  Request: unknown,
) => void;
loadWorker(fakeSelf, FakeRequest);

/** Build a fetch event, run the captured handler, and return the response (if intercepted). */
async function dispatchFetch(request: {
  url: string;
  method?: string;
  mode?: string;
}): Promise<{ intercepted: boolean; response?: Response }> {
  const handler = listeners.get("fetch");
  if (!handler) throw new Error("no fetch listener");
  let responsePromise: Promise<Response> | undefined;
  const event = {
    request: { method: "GET", ...request },
    respondWith: (p: Promise<Response>) => {
      responsePromise = p;
    },
  };
  handler(event);
  if (!responsePromise) return { intercepted: false };
  return { intercepted: true, response: await responsePromise };
}

async function runLifecycle(type: "install" | "activate"): Promise<void> {
  const handler = listeners.get(type);
  if (!handler) throw new Error(`no ${type} listener`);
  const waits: Promise<unknown>[] = [];
  handler({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

const SHELL_CACHE = "coeliac-shell-v1";

beforeEach(() => {
  fakeSelf.caches = new FakeCacheStorage();
  fakeSelf.fetch = vi.fn(async (req: unknown): Promise<Response> => {
    const url = (req as { url: string }).url;
    return new Response(`body:${url}`, { status: 200 });
  });
  fakeSelf.skipWaiting.mockClear();
  fakeSelf.clients.claim.mockClear();
});

describe("service worker — install/activate", () => {
  it("precaches every shell route and calls skipWaiting", async () => {
    await runLifecycle("install");
    const cache = await fakeSelf.caches.open(SHELL_CACHE);
    for (const route of ["/", "/log", "/symptoms", "/genetics", "/community"]) {
      expect(await cache.match(`${ORIGIN}${route}`)).toBeDefined();
    }
    expect(fakeSelf.skipWaiting).toHaveBeenCalled();
  });

  it("precache is best-effort — one failing route does not abort the rest", async () => {
    fakeSelf.fetch = vi.fn(async (req: unknown): Promise<Response> => {
      const url = (req as { url: string }).url;
      if (url.endsWith("/log")) throw new Error("offline");
      return new Response(`body:${url}`, { status: 200 });
    });
    await runLifecycle("install");
    const cache = await fakeSelf.caches.open(SHELL_CACHE);
    expect(await cache.match(`${ORIGIN}/log`)).toBeUndefined();
    expect(await cache.match(`${ORIGIN}/`)).toBeDefined();
    expect(fakeSelf.skipWaiting).toHaveBeenCalled();
  });

  it("evicts old shell-cache generations on activate and claims clients", async () => {
    await fakeSelf.caches.open("coeliac-shell-v0");
    await fakeSelf.caches.open(SHELL_CACHE);
    await fakeSelf.caches.open("some-unrelated-cache");
    await runLifecycle("activate");
    const remaining = await fakeSelf.caches.keys();
    expect(remaining).not.toContain("coeliac-shell-v0");
    expect(remaining).toContain(SHELL_CACHE);
    expect(remaining).toContain("some-unrelated-cache");
    expect(fakeSelf.clients.claim).toHaveBeenCalled();
  });
});

describe("service worker — SECURITY INVARIANT (never touch pod / credentialed data)", () => {
  it("does NOT intercept cross-origin (pod) GET requests", async () => {
    const { intercepted } = await dispatchFetch({
      url: "https://alice.pod.example/diary/symptoms/2026-07-03",
      method: "GET",
    });
    expect(intercepted).toBe(false);
    expect(fakeSelf.fetch).not.toHaveBeenCalled();
  });

  it("does NOT intercept cross-origin third-party APIs (OFF, trials, EPMC)", async () => {
    for (const url of [
      "https://world.openfoodfacts.org/api/v2/product/123",
      "https://clinicaltrials.gov/api/v2/studies?query.cond=celiac",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
    ]) {
      const { intercepted } = await dispatchFetch({ url, method: "GET" });
      expect(intercepted).toBe(false);
    }
    expect(fakeSelf.fetch).not.toHaveBeenCalled();
  });

  it("does NOT intercept non-GET requests (writes go straight to the network)", async () => {
    const { intercepted } = await dispatchFetch({
      url: `${ORIGIN}/log`,
      method: "PUT",
      mode: "navigate",
    });
    expect(intercepted).toBe(false);
  });

  it("does NOT intercept same-origin non-navigation, non-asset GETs", async () => {
    const { intercepted } = await dispatchFetch({
      url: `${ORIGIN}/clientid.jsonld`,
      method: "GET",
    });
    expect(intercepted).toBe(false);
  });
});

describe("service worker — instant offline load (UX invariant #3)", () => {
  it("serves the exact cached route when a navigation is offline", async () => {
    await runLifecycle("install");
    fakeSelf.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const { intercepted, response } = await dispatchFetch({
      url: `${ORIGIN}/log`,
      method: "GET",
      mode: "navigate",
    });
    expect(intercepted).toBe(true);
    expect(await response!.text()).toBe(`body:${ORIGIN}/log`);
  });

  it("falls back to the '/' shell for an un-cached route while offline", async () => {
    await runLifecycle("install");
    fakeSelf.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const { response } = await dispatchFetch({
      url: `${ORIGIN}/deep/uncached/route`,
      method: "GET",
      mode: "navigate",
    });
    expect(await response!.text()).toBe(`body:${ORIGIN}/`);
  });

  it("returns a 503 offline document when nothing is cached at all", async () => {
    fakeSelf.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const { response } = await dispatchFetch({
      url: `${ORIGIN}/log`,
      method: "GET",
      mode: "navigate",
    });
    expect(response!.status).toBe(503);
  });

  it("serves same-origin static assets cache-first", async () => {
    const asset = `${ORIGIN}/_next/static/chunk.abc123.js`;
    // First request: network miss → fetch + cache.
    fakeSelf.fetch = vi.fn(async () => new Response("JS-V1", { status: 200 }));
    const first = await dispatchFetch({ url: asset, method: "GET" });
    expect(first.intercepted).toBe(true);
    expect(await first.response!.text()).toBe("JS-V1");
    // Second request: cache-first returns the cached copy even if the network changed.
    fakeSelf.fetch = vi.fn(async () => new Response("JS-V2", { status: 200 }));
    const second = await dispatchFetch({ url: asset, method: "GET" });
    expect(await second.response!.text()).toBe("JS-V1");
  });
});

describe("service worker — purge-shell message", () => {
  it("drops the shell cache on a purge-shell message", async () => {
    await runLifecycle("install");
    expect((await fakeSelf.caches.keys())).toContain(SHELL_CACHE);
    const handler = listeners.get("message");
    if (!handler) throw new Error("no message listener");
    const waits: Promise<unknown>[] = [];
    handler({ data: { type: "purge-shell" }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect((await fakeSelf.caches.keys())).not.toContain(SHELL_CACHE);
  });

  it("ignores unknown / malformed messages", async () => {
    const handler = listeners.get("message");
    if (!handler) throw new Error("no message listener");
    expect(() => handler({ data: null })).not.toThrow();
    expect(() => handler({ data: { type: "something-else" } })).not.toThrow();
  });
});
