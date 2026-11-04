// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import {
  installServiceWorker,
  PAGES_CACHE_PREFIX,
  PAGES_LIMIT,
  REMEMBER_PAGE,
  SHELL_CACHE_PREFIX,
  SHELL_ROUTES,
  serviceWorkerSource,
  type WorkerScope,
} from "../src/shell/lib/service-worker";

const origin = "https://suite.example";
const html = (body: string) =>
  `<!doctype html><link rel="stylesheet" href="/_next/static/css/app.css"><script src="/_next/static/chunks/${body}.js" async></script><script src="/_next/static/chunks/shared.js"></script><img src="/icon.svg"><h1>${body}</h1>`;

/** Node's Response has type "default"; the browser's same-origin responses are "basic". */
function basic(body: string | null, init: ResponseInit & { redirected?: boolean } = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { value: "basic" });
  if (init.redirected) Object.defineProperty(response, "redirected", { value: true });
  return response;
}
const page = (name: string) =>
  basic(html(name), { headers: { "content-type": "text/html; charset=utf-8" } });

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request | string) {
    return this.entries.get(typeof request === "string" ? request : request.url)?.clone();
  }
  async put(request: Request | string, response: Response) {
    const key = typeof request === "string" ? request : request.url;
    this.entries.delete(key);
    this.entries.set(key, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string) {
    return this.entries.delete(typeof request === "string" ? request : request.url);
  }
}

type Listener = (event: never) => void;
function scope(responses: Record<string, () => Response | Promise<Response>> = {}) {
  const stores = new Map<string, FakeCache>();
  const listeners = new Map<string, Listener>();
  const fetcher = vi.fn(async (request: Request | string) => {
    const url = typeof request === "string" ? request : request.url;
    const respond = responses[url.slice(origin.length)] ?? responses[url];
    if (!respond) throw new TypeError("Failed to fetch");
    return respond();
  });
  const sw = {
    location: { origin },
    navigator: { onLine: true },
    caches: {
      async open(name: string) {
        const cache = stores.get(name) ?? new FakeCache();
        stores.set(name, cache);
        return cache;
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name: string) {
        return stores.delete(name);
      },
    },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    fetch: fetcher,
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    };
    (listeners.get(type) as (event: unknown) => void)(event);
    const result = await response;
    await Promise.all(waits);
    return result;
  };
  return { sw, stores, fetcher, dispatch, listeners };
}
const shellRoutes = Object.fromEntries(
  SHELL_ROUTES.map((route) => [route, () => page(route.slice(1) || "home")]),
);
const assets = {
  "/_next/static/css/app.css": () => basic("body{}"),
  "/_next/static/chunks/shared.js": () => basic("shared"),
  "/_next/static/chunks/offline.js": () => basic("offline"),
};
const navigation = (path: string, init: RequestInit = {}) =>
  new Request(`${origin}${path}`, { ...init, mode: "same-origin" });
/** `mode: "navigate"` cannot be constructed outside a browser; fake the getter. */
function navigate(path: string) {
  const request = navigation(path);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}
async function installed(responses: Record<string, () => Response | Promise<Response>> = {}) {
  const context = scope({ ...shellRoutes, ...assets, ...responses });
  installServiceWorker(context.sw as unknown as WorkerScope, "v2", SHELL_ROUTES);
  await context.dispatch("install");
  return context;
}

describe("service worker source", () => {
  it("is self-contained and carries the version and routes", async () => {
    const source = serviceWorkerSource("abc");
    expect(source.startsWith('"use strict";\n(function installServiceWorker(')).toBe(true);
    expect(source).toContain('"abc", ["/offline","/","/drive/my"');
    const context = scope();
    new Function("self", source)(context.sw);
    expect([...context.listeners.keys()]).toEqual(["install", "activate", "fetch", "message"]);
    expect(serviceWorkerSource("abc", ["/offline"])).toContain('"abc", ["/offline"]);');
  });
  it("names its caches so Clear saved copies removes pages but keeps the shell", () => {
    expect(SHELL_CACHE_PREFIX).toBe("app-shell-");
    expect(PAGES_CACHE_PREFIX).toBe("suite-pages-");
    expect(PAGES_LIMIT).toBe(30);
    expect(REMEMBER_PAGE).toBe("remember-page");
    expect(SHELL_ROUTES[0]).toBe("/offline");
  });
});

describe("install and activate", () => {
  it("precaches the shell routes and the assets they load first", async () => {
    const { stores, sw, fetcher } = await installed();
    const shell = stores.get("app-shell-v2") as FakeCache;
    expect([...shell.entries.keys()]).toEqual(
      expect.arrayContaining([
        `${origin}/offline`,
        `${origin}/drive/my`,
        `${origin}/_next/static/css/app.css`,
        `${origin}/_next/static/chunks/shared.js`,
        `${origin}/_next/static/chunks/offline.js`,
      ]),
    );
    // A missing asset is fetched on first use; images outside /_next/static are never cached.
    expect(shell.entries.has(`${origin}/_next/static/chunks/search.js`)).toBe(false);
    expect(shell.entries.has(`${origin}/icon.svg`)).toBe(false);
    // Shared assets are fetched once.
    expect(
      fetcher.mock.calls.filter(([url]) => url === `${origin}/_next/static/chunks/shared.js`),
    ).toHaveLength(1);
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });

  it("fails install without the offline page and tolerates other missing routes", async () => {
    const missing = scope({ ...assets });
    installServiceWorker(missing.sw as unknown as WorkerScope, "v2", SHELL_ROUTES);
    await expect(missing.dispatch("install")).rejects.toThrow("Failed to fetch");
    const partial = scope({ "/offline": () => page("offline") });
    installServiceWorker(partial.sw as unknown as WorkerScope, "v2", ["/offline", "/missing"]);
    await partial.dispatch("install");
    expect(partial.stores.get("app-shell-v2")?.entries.has(`${origin}/offline`)).toBe(true);
    expect(partial.sw.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each([
    ["an error", () => basic("no", { status: 500, headers: { "content-type": "text/html" } })],
    [
      "a redirect",
      () => basic("x", { redirected: true, headers: { "content-type": "text/html" } }),
    ],
    ["not HTML", () => basic("{}", { headers: { "content-type": "application/json" } })],
    ["no content type", () => basic(null)],
    ["cross-origin", () => new Response("x", { headers: { "content-type": "text/html" } })],
  ])("never stores %s as a page", async (_name, respond) => {
    const context = scope({ "/offline": respond });
    installServiceWorker(context.sw as unknown as WorkerScope, "v2", SHELL_ROUTES);
    await expect(context.dispatch("install")).rejects.toThrow("Offline page unavailable");
  });

  it("removes old versions of its own caches and takes control", async () => {
    const context = await installed();
    for (const name of ["app-shell-v1", "suite-pages-v1", "suite-pages-v2", "other-app"])
      await context.sw.caches.open(name);
    await context.dispatch("activate");
    expect([...context.stores.keys()].sort()).toEqual(
      ["app-shell-v2", "other-app", "suite-pages-v2"].sort(),
    );
    expect(context.sw.clients.claim).toHaveBeenCalledOnce();
  });

  it.each([false, true])("enables supported navigation preload (failure: %s)", async (fails) => {
    const context = await installed();
    const enable = vi.fn(async () => {
      if (fails) throw new Error("unavailable");
    });
    Object.assign(context.sw, { registration: { navigationPreload: { enable } } });
    await context.dispatch("activate");
    expect(enable).toHaveBeenCalledOnce();
    expect(context.sw.clients.claim).toHaveBeenCalledOnce();
    Object.assign(context.sw, { registration: {} });
    await context.dispatch("activate");
  });

  it("discovers assets with query strings and decodes HTML ampersands", async () => {
    const asset = "/_next/static/app.js?v=1&build=2";
    const { stores, fetcher } = await installed({
      "/offline": () =>
        basic('<script src="/_next/static/app.js?v=1&amp;build=2"></script>', {
          headers: { "content-type": "text/html" },
        }),
      [asset]: () => basic("queried"),
    });
    expect(fetcher).toHaveBeenCalledWith(`${origin}${asset}`);
    expect(stores.get("app-shell-v2")?.entries.has(`${origin}${asset}`)).toBe(true);
  });
});

describe("fetch", () => {
  it("never handles writes, credentialed, cross-origin or storage requests", async () => {
    const { dispatch } = await installed();
    for (const request of [
      new Request(`${origin}/_next/static/chunks/shared.js`, { method: "POST", body: "x" }),
      new Request(`${origin}/_next/static/chunks/shared.js`, {
        headers: { Authorization: "DPoP token" },
      }),
      new Request(`${origin}/_next/static/chunks/shared.js`, { headers: { DPoP: "proof" } }),
      new Request("https://alice.example.org/_next/static/chunks/shared.js"),
      new Request("https://alice.example.org/notes.ttl"),
      new Request(`${origin}/drive/my?_rsc=1`, { headers: { RSC: "1" } }),
    ])
      expect(await dispatch("fetch", { request })).toBeUndefined();
  });

  it("serves static assets cache-first and caches successful misses", async () => {
    let served = 0;
    const { dispatch, stores } = await installed({
      "/_next/static/chunks/late.js": () => basic(`late ${++served}`),
      "/_next/static/chunks/broken.js": () => basic("gone", { status: 404 }),
    });
    const hit = await dispatch("fetch", {
      request: new Request(`${origin}/_next/static/chunks/shared.js`),
    });
    expect(await hit?.text()).toBe("shared");
    const late = () =>
      dispatch("fetch", { request: new Request(`${origin}/_next/static/chunks/late.js`) });
    expect(await (await late())?.text()).toBe("late 1");
    expect(await (await late())?.text()).toBe("late 1");
    const broken = await dispatch("fetch", {
      request: new Request(`${origin}/_next/static/chunks/broken.js`),
    });
    expect(broken?.status).toBe(404);
    expect(stores.get("app-shell-v2")?.entries.has(`${origin}/_next/static/chunks/broken.js`)).toBe(
      false,
    );
  });

  it("returns online navigations untouched and falls back even if the browser reports online", async () => {
    const response = page("tasks live");
    const { dispatch, sw } = await installed({ "/tasks/upcoming": () => response });
    expect(await dispatch("fetch", { request: navigate("/tasks/upcoming") })).toBe(response);
    expect(sw.navigator.onLine).toBe(true);
    expect(
      await (await dispatch("fetch", { request: navigate("/unreachable") }))?.text(),
    ).toContain("<h1>offline</h1>");
  });

  it("uses navigation preload and fetches normally if it fails", async () => {
    const { dispatch } = await installed({ "/docs": () => page("network") });
    const preloaded = page("preloaded");
    expect(
      await dispatch("fetch", {
        request: navigate("/docs"),
        preloadResponse: Promise.resolve(preloaded),
      }),
    ).toBe(preloaded);
    expect(
      await (
        await dispatch("fetch", {
          request: navigate("/docs"),
          preloadResponse: Promise.reject(new Error("preload failed")),
        })
      )?.text(),
    ).toContain("network");
    expect(
      await (
        await dispatch("fetch", {
          request: navigate("/docs"),
          preloadResponse: Promise.resolve(undefined),
        })
      )?.text(),
    ).toContain("network");
  });

  it.each([
    "open",
    "match",
    "put",
  ] as const)("returns online assets when cache %s fails", async (operation) => {
    const { sw, dispatch, stores } = await installed({
      "/_next/static/new.js": () => basic("online"),
    });
    if (operation === "open") vi.spyOn(sw.caches, "open").mockRejectedValue(new Error("blocked"));
    else
      vi.spyOn(stores.get("app-shell-v2") as FakeCache, operation).mockRejectedValue(
        new Error("full"),
      );
    expect(
      await (
        await dispatch("fetch", { request: new Request(`${origin}/_next/static/new.js`) })
      )?.text(),
    ).toBe("online");
  });

  it("returns an asset before its cache write finishes", async () => {
    const { listeners, stores } = await installed({
      "/_next/static/new.js": () => basic("online"),
    });
    let finish!: () => void;
    vi.spyOn(stores.get("app-shell-v2") as FakeCache, "put").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const waits: Promise<unknown>[] = [];
    let response!: Promise<Response>;
    (listeners.get("fetch") as (event: unknown) => void)({
      request: new Request(`${origin}/_next/static/new.js`),
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    expect(await (await response).text()).toBe("online");
    expect(waits).toHaveLength(1);
    finish();
    await Promise.all(waits);
  });

  it.each([
    ["redirected", () => basic("redirect", { redirected: true })],
    ["cross-origin", () => new Response("opaque")],
  ])("never caches %s assets", async (_name, respond) => {
    const { dispatch, stores } = await installed({ "/_next/static/unsafe.js": respond });
    await dispatch("fetch", { request: new Request(`${origin}/_next/static/unsafe.js`) });
    expect(stores.get("app-shell-v2")?.entries.has(`${origin}/_next/static/unsafe.js`)).toBe(false);
  });

  it("offline: tries the network, then saved pages, then the shell, then /offline", async () => {
    let network = false;
    const { dispatch, sw, stores } = await installed({
      "/tasks/today": () => {
        if (network) return page("tasks live");
        throw new TypeError("Failed to fetch");
      },
    });
    sw.navigator.onLine = false;
    await (await sw.caches.open("suite-pages-v2")).put(`${origin}/docs`, page("docs saved"));
    const body = async (path: string) =>
      (await (await dispatch("fetch", { request: navigate(path) }))?.text()) ?? "";
    expect(await body("/docs?x=1")).toContain("docs saved");
    expect(await body("/search")).toContain("<h1>search</h1>");
    expect(await body("/tasks/upcoming")).toContain("<h1>offline</h1>");
    network = true;
    expect(await body("/tasks/today")).toContain("tasks live");
    stores.get("app-shell-v2")?.entries.delete(`${origin}/offline`);
    const last = await dispatch("fetch", { request: navigate("/tasks/upcoming") });
    expect(last?.status).toBe(503);
    expect(await last?.text()).toBe("You're offline.");
  });
});

describe("remember-page", () => {
  it("ignores anything but a same-origin page path while online", async () => {
    const { dispatch, sw, fetcher } = await installed();
    const calls = fetcher.mock.calls.length;
    for (const data of [
      null,
      "remember-page",
      { type: "other", path: "/search" },
      { type: REMEMBER_PAGE },
      { type: REMEMBER_PAGE, path: "//evil.example/" },
      { type: REMEMBER_PAGE, path: "https://evil.example/" },
      { type: REMEMBER_PAGE, path: "/search?q=secret" },
      { type: REMEMBER_PAGE, path: "/_next/static/chunks/shared.js" },
      { type: REMEMBER_PAGE, path: "/api/session" },
    ])
      await dispatch("message", { data });
    sw.navigator.onLine = false;
    await dispatch("message", { data: { type: REMEMBER_PAGE, path: "/search" } });
    expect(fetcher.mock.calls.length).toBe(calls);
  });

  it("keeps the most recent pages and their assets", async () => {
    const pages = Object.fromEntries(
      Array.from({ length: PAGES_LIMIT + 2 }, (_, i) => [`/p/${i}`, () => page(`p${i}`)]),
    );
    const { dispatch, stores } = await installed({
      ...pages,
      "/_next/static/chunks/p0.js": () => basic("p0"),
      "/_next/static/chunks/p1.js": () => {
        throw new TypeError("Failed to fetch");
      },
      "/_next/static/chunks/p2.js": () => basic("gone", { status: 404 }),
    });
    for (let i = 0; i < PAGES_LIMIT + 2; i++)
      await dispatch("message", { data: { type: REMEMBER_PAGE, path: `/p/${i}` } });
    const saved = stores.get("suite-pages-v2") as FakeCache;
    expect(saved.entries.size).toBe(PAGES_LIMIT);
    expect(saved.entries.has(`${origin}/p/0`)).toBe(false);
    expect(saved.entries.has(`${origin}/p/${PAGES_LIMIT + 1}`)).toBe(true);
    const shell = stores.get("app-shell-v2") as FakeCache;
    expect(shell.entries.has(`${origin}/_next/static/chunks/p0.js`)).toBe(true);
    expect(shell.entries.has(`${origin}/_next/static/chunks/p1.js`)).toBe(false);
    expect(shell.entries.has(`${origin}/_next/static/chunks/p2.js`)).toBe(false);
    // A page that fails to load is not remembered and keeps nothing stale.
    await dispatch("message", { data: { type: REMEMBER_PAGE, path: "/missing" } });
    expect(saved.entries.has(`${origin}/missing`)).toBe(false);
  });
});
