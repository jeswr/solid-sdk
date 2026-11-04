// AUTHORED-BY Claude Opus 5.5
/**
 * The suite's offline service worker (02-suite-shell §10), served from `/service-worker`.
 *
 * It precaches the shell routes and their static assets and, while the browser is offline,
 * answers navigations from that cache with `/offline` as the fallback. Visited pages the shell
 * asks it to remember are kept too, so the recent items on `/offline` open.
 *
 * SECURITY: it never caches storage. It handles same-origin GETs only, never a request that
 * carries `Authorization` or `DPoP`, never a cross-origin or opaque response, and nothing but
 * the suite's own HTML pages and `/_next/static/` assets. Caching signed-in storage reads
 * needs the solid-offline per-account design and is out of scope here.
 *
 * `installServiceWorker` is serialised with `Function.prototype.toString`, so it must stay
 * self-contained: it may use only its parameters and worker globals (`URL`, `Response`,
 * `Request`, `Promise`, `Set`), never module-level values.
 */

export const SHELL_ROUTES = [
  "/offline",
  "/",
  "/drive/my",
  "/search",
  "/notifications",
  "/settings/account",
] as const;
export const SHELL_CACHE_PREFIX = "app-shell-";
/** Starts with "suite-" so Settings › Offline › Clear saved copies removes remembered pages. */
export const PAGES_CACHE_PREFIX = "suite-pages-";
export const PAGES_LIMIT = 30;
export const REMEMBER_PAGE = "remember-page";

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
}
interface MessageEventLike extends ExtendableEventLike {
  data: unknown;
}
interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  keys(): Promise<readonly Request[]>;
  delete(request: Request | string): Promise<boolean>;
}
export interface WorkerScope {
  location: { origin: string };
  navigator: { onLine: boolean };
  caches: {
    open(name: string): Promise<CacheLike>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
  };
  clients: { claim(): Promise<void> };
  registration?: { navigationPreload?: { enable(): Promise<void> } };
  skipWaiting(): Promise<void>;
  fetch(request: Request | string): Promise<Response>;
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

export function installServiceWorker(
  sw: WorkerScope,
  version: string,
  routes: readonly string[],
): void {
  const shellName = `app-shell-${version}`;
  const pagesName = `suite-pages-${version}`;
  const ownCaches = ["app-shell-", "suite-pages-"];
  const pagesLimit = 30;
  const origin = sw.location.origin;
  const absolute = (path: string) => `${origin}${path}`;
  const isPage = (response: Response) =>
    response.ok &&
    response.type === "basic" &&
    !response.redirected &&
    (response.headers.get("content-type") ?? "").includes("text/html");
  const isAsset = (response: Response) =>
    response.ok && response.type === "basic" && !response.redirected;
  /** The hashed assets a page loads first; anything later is cached when it is fetched. */
  const assetsIn = (html: string) => {
    const found = new Set<string>();
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"#]+)"/g))
      found.add((match[1] as string).replaceAll("&amp;", "&"));
    return [...found];
  };
  /** A page path the shell may ask to remember: same-origin, no query, not an asset. */
  const isPagePath = (path: unknown): path is string =>
    typeof path === "string" &&
    /^\/(?!\/)[^?#\\\s]*$/.test(path) &&
    !path.startsWith("/_next/") &&
    !path.startsWith("/api/");

  async function storePage(cacheName: string, path: string): Promise<boolean> {
    const response = await sw.fetch(absolute(path));
    if (!isPage(response)) return false;
    const html = await response.clone().text();
    const cache = await sw.caches.open(cacheName);
    await cache.put(absolute(path), response);
    const shell = await sw.caches.open(shellName);
    await Promise.all(
      assetsIn(html).map(async (asset) => {
        if (await shell.match(absolute(asset))) return;
        try {
          const file = await sw.fetch(absolute(asset));
          if (isAsset(file)) await shell.put(absolute(asset), file);
        } catch {
          /* Fetched again on first use. */
        }
      }),
    );
    return true;
  }
  async function asset(event: FetchEventLike): Promise<Response> {
    const { request } = event;
    try {
      const hit = await (await sw.caches.open(shellName)).match(request);
      if (hit) return hit;
    } catch {
      /* A disabled or full cache must never prevent an online load. */
    }
    const response = await sw.fetch(request);
    if (isAsset(response)) {
      const copy = response.clone();
      event.waitUntil(
        sw.caches
          .open(shellName)
          .then((shell) => shell.put(request, copy))
          .catch(() => {}),
      );
    }
    return response;
  }
  async function navigate(event: FetchEventLike, path: string): Promise<Response> {
    const preloaded = await event.preloadResponse?.catch(() => undefined);
    if (preloaded) return preloaded;
    try {
      return await sw.fetch(event.request);
    } catch {
      for (const name of [pagesName, shellName]) {
        const hit = await (await sw.caches.open(name)).match(absolute(path));
        if (hit) return hit;
      }
      const fallback = await (await sw.caches.open(shellName)).match(absolute("/offline"));
      return (
        fallback ??
        new Response("You're offline.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      );
    }
  }
  async function remember(path: string): Promise<void> {
    if (!(await storePage(pagesName, path).catch(() => false))) return;
    const pages = await sw.caches.open(pagesName);
    const keys = await pages.keys();
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - pagesLimit)).map((key) => pages.delete(key)),
    );
  }

  sw.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const [fallback = "/offline", ...rest] = routes;
        // The fallback page is required; the other shell routes are best effort.
        if (!(await storePage(shellName, fallback))) throw new Error("Offline page unavailable");
        await Promise.all(rest.map((route) => storePage(shellName, route).catch(() => false)));
        await sw.skipWaiting();
      })(),
    );
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const names = await sw.caches.keys();
        await Promise.all(
          names
            .filter(
              (name) =>
                ownCaches.some((prefix) => name.startsWith(prefix)) &&
                name !== shellName &&
                name !== pagesName,
            )
            .map((name) => sw.caches.delete(name)),
        );
        await sw.registration?.navigationPreload?.enable().catch(() => {});
        await sw.clients.claim();
      })(),
    );
  });
  sw.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    if (request.headers.has("authorization") || request.headers.has("dpop")) return;
    const url = new URL(request.url);
    if (url.origin !== origin) return;
    if (url.pathname.startsWith("/_next/static/")) return event.respondWith(asset(event));
    // Network-first even when the browser has not detected a lost connection.
    if (request.mode === "navigate") event.respondWith(navigate(event, url.pathname));
  });
  sw.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown; path?: unknown } | null;
    if (data?.type !== "remember-page" || !isPagePath(data.path) || !sw.navigator.onLine) return;
    event.waitUntil(remember(data.path));
  });
}

/** The `/service-worker` body: the worker above, invoked with this build's version and routes. */
export function serviceWorkerSource(version: string, routes: readonly string[] = SHELL_ROUTES) {
  return `"use strict";\n(${installServiceWorker.toString()})(self, ${JSON.stringify(version)}, ${JSON.stringify(routes)});\n`;
}
