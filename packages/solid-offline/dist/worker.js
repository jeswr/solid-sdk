// src/app-shell.ts
var SHELL_CACHE_PREFIX = "solid-offline-shell-";
function shellCacheName(version) {
  return `${SHELL_CACHE_PREFIX}${version}`;
}
function resolveAppShellConfig(config) {
  const version = config.version ?? "v1";
  const precache = [...new Set(config.precache)];
  const fallback = config.fallback ?? precache.find((u) => {
    const path = pathOf(u);
    return path.endsWith(".html") || path.endsWith("/");
  });
  return { precache, fallback, version };
}
function sameShellConfig(a, b) {
  return a.version === b.version && a.fallback === b.fallback && a.precache.length === b.precache.length && a.precache.every((url, i) => url === b.precache[i]);
}
function pathOf(url) {
  try {
    return new URL(url, "https://x.invalid/").pathname.toLowerCase();
  } catch {
    return "";
  }
}
async function precacheAppShell(caches, config, onError) {
  const cache = await caches.open(shellCacheName(config.version));
  const cached = [];
  const failed = [];
  await Promise.all(
    config.precache.map(async (url) => {
      try {
        await cache.addAll([url]);
        cached.push(url);
      } catch (error) {
        failed.push(url);
      }
    })
  );
  return { cached, failed };
}
async function cleanupOldShellCaches(caches, currentVersion) {
  const keep = shellCacheName(currentVersion);
  const names = await caches.keys();
  const removed = [];
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith(SHELL_CACHE_PREFIX) && name !== keep) {
        const ok = await caches.delete(name);
        if (ok) removed.push(name);
      }
    })
  );
  return removed;
}
async function shellBucketComplete(caches, config) {
  if (config.precache.length === 0) return false;
  try {
    const cache = await caches.open(shellCacheName(config.version));
    for (const url of config.precache) {
      if (!await cache.match(url)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function configFromBucket(caches, version) {
  let cache;
  try {
    cache = await caches.open(shellCacheName(version));
  } catch {
    return void 0;
  }
  if (typeof cache.keys !== "function") return void 0;
  let requests;
  try {
    requests = await cache.keys();
  } catch {
    return void 0;
  }
  const precache = [...new Set(requests.map((r) => r.url))];
  if (precache.length === 0) return void 0;
  const fallback = precache.find((u) => {
    const path = pathOf(u);
    return path.endsWith(".html") || path.endsWith("/");
  });
  return { precache, fallback, version };
}
async function resolveServingShellConfig(caches, current) {
  if (await shellBucketComplete(caches, current)) return current;
  let names;
  try {
    names = await caches.keys();
  } catch {
    return current;
  }
  const versions = names.filter((n) => n.startsWith(SHELL_CACHE_PREFIX) && n !== shellCacheName(current.version)).map((n) => n.slice(SHELL_CACHE_PREFIX.length)).sort().reverse();
  for (const version of versions) {
    const candidate = await configFromBucket(caches, version);
    if (candidate && await shellBucketComplete(caches, candidate)) return candidate;
  }
  return current;
}
function isPrecachedAsset(requestUrl, config) {
  const reqPath = pathOf(requestUrl);
  if (!reqPath) return false;
  for (const url of config.precache) {
    if (pathOf(url) === reqPath) return true;
  }
  return false;
}
function canonicalShellUrl(requestUrl, config) {
  const reqPath = pathOf(requestUrl);
  if (!reqPath) return void 0;
  if (config.fallback && pathOf(config.fallback) === reqPath) return config.fallback;
  for (const url of config.precache) {
    if (pathOf(url) === reqPath) return url;
  }
  return void 0;
}
function pathAndSearchOf(url) {
  try {
    const u = new URL(url, "https://x.invalid/");
    return `${u.pathname.toLowerCase()}${u.search}`;
  } catch {
    return null;
  }
}
function isExactConfiguredShellUrl(requestUrl, config) {
  const reqPS = pathAndSearchOf(requestUrl);
  if (reqPS === null) return false;
  if (config.fallback && pathAndSearchOf(config.fallback) === reqPS) return true;
  for (const url of config.precache) {
    if (pathAndSearchOf(url) === reqPS) return true;
  }
  return false;
}
async function handleNavigation(request, deps) {
  const cache = await deps.caches.open(shellCacheName(deps.config.version));
  const canonical = canonicalShellUrl(request.url, deps.config);
  if (deps.isOnline()) {
    try {
      const fresh = await deps.fetch(request);
      if (canonical && isExactConfiguredShellUrl(request.url, deps.config) && fresh.ok && isHtmlResponse(fresh)) {
        try {
          await cache.put(canonical, fresh.clone());
          return { response: fresh, source: "shell-network-cached" };
        } catch {
        }
      }
      return { response: fresh, source: "shell-network" };
    } catch {
    }
  }
  if (canonical) {
    const routeHit = await cache.match(canonical);
    if (routeHit) return { response: routeHit, source: "shell-cache-offline" };
  }
  if (deps.config.fallback) {
    const fallbackHit = await cache.match(deps.config.fallback);
    if (fallbackHit) return { response: fallbackHit, source: "shell-cache-fallback" };
  }
  const response = await deps.fetch(request);
  return { response, source: "shell-miss" };
}
async function handlePrecachedAsset(request, deps) {
  const cache = await deps.caches.open(shellCacheName(deps.config.version));
  const hit = await cache.match(request);
  if (hit) return { response: hit, source: "asset-cache-first" };
  const fresh = await deps.fetch(request);
  if (fresh.ok) {
    try {
      await cache.put(request, fresh.clone());
    } catch {
    }
  }
  return { response: fresh, source: "asset-network" };
}
function isHtmlResponse(response) {
  const ct = response.headers.get("content-type") ?? "";
  return ct.toLowerCase().includes("text/html");
}

// src/cache-policy.ts
var CANONICAL_RDF_ACCEPT = "text/turtle";
var NEGATIVE_CACHE_TTL_MS = 3e4;
var RDF_ACCEPT_HINTS = [
  "text/turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/rdf+xml"
];
var NEVER_CACHE_PATH_HINTS = [
  "/.well-known/",
  "/oidc",
  "/token",
  "/authorize",
  "/auth",
  "/login",
  "/register",
  "/credentials",
  "/.account",
  "/subscription",
  "/notifications",
  "/.notifications"
];
function varyHasStar(vary) {
  if (!vary) return false;
  return vary.split(",").map((t) => t.trim()).some((t) => t === "*");
}
function isCacheableMethod(method) {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}
function isNeverCacheEndpoint(url) {
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return true;
  }
  if (url.toLowerCase().startsWith("ws://") || url.toLowerCase().startsWith("wss://")) {
    return true;
  }
  return NEVER_CACHE_PATH_HINTS.some((hint) => path.includes(hint));
}
function parseCacheControl(value) {
  if (!value) return { noStore: false, private: false };
  const directives = value.toLowerCase().split(",").map((d) => d.trim());
  return {
    noStore: directives.includes("no-store"),
    private: directives.includes("private")
  };
}
function requestCacheDirective(req) {
  const cc = req.headers.get("cache-control");
  if (!cc) return "default";
  const directives = cc.toLowerCase().split(",").map((d) => d.trim());
  if (directives.includes("no-store")) return "no-store";
  if (directives.includes("no-cache")) return "no-cache";
  return "default";
}
function classifyResponse(req, res) {
  if (!isCacheableMethod(req.method)) {
    return { cacheable: false, reason: "method-not-get-head", negative: false };
  }
  if (isNeverCacheEndpoint(req.url)) {
    return { cacheable: false, reason: "never-cache-endpoint", negative: false };
  }
  if (res.type === "opaque" || res.type === "opaqueredirect" || res.status === 0) {
    return { cacheable: false, reason: "opaque-cross-origin", negative: false };
  }
  const cc = parseCacheControl(res.headers.get("cache-control"));
  if (cc.noStore) {
    return { cacheable: false, reason: "no-store", negative: false };
  }
  if (cc.private) {
    return { cacheable: false, reason: "private", negative: false };
  }
  if (varyHasStar(res.headers.get("vary"))) {
    return { cacheable: false, reason: "vary-star", negative: false };
  }
  if (res.status === 403 || res.status === 404) {
    return { cacheable: true, reason: "cacheable-negative", negative: true };
  }
  if (res.status >= 400) {
    return { cacheable: false, reason: "error-status", negative: false };
  }
  if (res.status >= 200 && res.status < 300) {
    return { cacheable: true, reason: "cacheable", negative: false };
  }
  return { cacheable: false, reason: "error-status", negative: false };
}
function canonicalAccept(accept) {
  if (!accept) return CANONICAL_RDF_ACCEPT;
  const lower = accept.toLowerCase();
  if (lower.includes("*/*")) return CANONICAL_RDF_ACCEPT;
  const asksForRdf = RDF_ACCEPT_HINTS.some((t) => lower.includes(t));
  if (asksForRdf) return CANONICAL_RDF_ACCEPT;
  return accept.split(",")[0]?.trim() ?? CANONICAL_RDF_ACCEPT;
}
function computeVaryKey(req, res) {
  const vary = res.headers.get("vary");
  if (!vary) {
    return `accept=${canonicalAccept(req.headers.get("accept"))}`;
  }
  if (varyHasStar(vary)) {
    return `vary*=${req.headers.get("accept") ?? ""}`;
  }
  const fields = vary.toLowerCase().split(",").map((f) => f.trim()).filter(Boolean);
  const parts = [];
  for (const field of fields.sort()) {
    if (field === "origin") continue;
    if (field === "accept") {
      parts.push(`accept=${canonicalAccept(req.headers.get("accept"))}`);
    } else {
      parts.push(`${field}=${req.headers.get(field) ?? ""}`);
    }
  }
  if (parts.length === 0) {
    parts.push(`accept=${canonicalAccept(req.headers.get("accept"))}`);
  }
  return parts.join("&");
}
function computeCacheKey(req, res) {
  return `${req.url} ${computeVaryKey(req, res)}`;
}
function makeKey(url, varyKey) {
  return `${url} ${varyKey}`;
}
var CACHE_KEY_ORIGIN = "https://solid-offline.invalid/";
function keyRequest(url, varyKey) {
  const keyUrl = `${CACHE_KEY_ORIGIN}${encodeURIComponent(makeKey(url, varyKey))}`;
  return new Request(keyUrl, { method: "GET" });
}
function aclStatusFor(status) {
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  return "ok";
}

// src/invalidation.ts
var IGNORE_VARY = { ignoreVary: true };
function rdfRequest(url) {
  return new Request(url, { method: "GET", headers: { accept: "text/turtle" } });
}
function resLike(response) {
  return { status: response.status, headers: response.headers, type: response.type };
}
function metadataFromResponse(req, res, now, negative, lastState) {
  return {
    key: computeCacheKey(req, res),
    url: req.url,
    varyKey: computeVaryKey(req, res),
    etag: res.headers.get("etag") ?? void 0,
    contentType: res.headers.get("content-type") ?? void 0,
    fetchedAt: now,
    vary: res.headers.get("vary") ?? void 0,
    aclStatus: aclStatusFor(res.status),
    status: res.status,
    ...lastState !== void 0 ? { lastState } : {},
    ...negative ? { negativeUntil: now + 3e4 } : {}
  };
}
async function handleNotification(frame, deps) {
  try {
    if (frame.type === "Add" || frame.type === "Remove") {
      return await refreshListing(frame, deps);
    }
    if (frame.type === "Delete") {
      return await invalidateResource(frame.object, frame.state, deps, { deleted: true });
    }
    return await invalidateResource(frame.object, frame.state, deps, { deleted: false });
  } catch (error) {
    return { kind: "error", error };
  }
}
async function invalidateResource(url, state, deps, opts) {
  const records = await deps.meta.getByUrl(url);
  if (records.length === 0) {
    return { kind: "not-cached" };
  }
  if (state !== void 0 && records.some((r) => r.etag === state)) {
    await deps.meta.setLastState(url, state);
    return { kind: "short-circuit" };
  }
  if (opts.deleted) {
    return purge(url, records, deps);
  }
  return revalidateResource(url, records, state, deps);
}
async function purge(url, records, deps) {
  const seenKeys = /* @__PURE__ */ new Set();
  for (const record of records) {
    seenKeys.add(record.varyKey);
    await deps.cache.delete(keyRequest(url, record.varyKey), IGNORE_VARY).catch(() => false);
  }
  if (!seenKeys.has("accept=text/turtle")) {
    await deps.cache.delete(keyRequest(url, "accept=text/turtle"), IGNORE_VARY).catch(() => false);
  }
  for (const record of records) {
    await deps.meta.delete(record.key);
  }
  deps.broadcast.postMessage({ url, event: "updated" });
  return { kind: "deleted" };
}
async function putCanonical(rl, response, deps) {
  const varyKey = computeVaryKey(rl, resLike(response));
  await deps.cache.put(keyRequest(rl.url, varyKey), response.clone());
}
async function purgeStaleVariants(url, records, keepVaryKey, deps) {
  for (const record of records) {
    if (record.varyKey === keepVaryKey) continue;
    await deps.cache.delete(keyRequest(url, record.varyKey), IGNORE_VARY).catch(() => false);
    await deps.meta.delete(record.key);
  }
}
async function revalidateResource(url, records, state, deps) {
  const etag = records.find((r) => r.etag)?.etag;
  const req = rdfRequest(url);
  const rl = { url: req.url, method: req.method, headers: req.headers };
  const condHeaders = new Headers(req.headers);
  if (etag) condHeaders.set("If-None-Match", etag);
  const condRequest = new Request(url, { method: "GET", headers: condHeaders });
  const fresh = await deps.fetch(condRequest);
  if (fresh.status === 304) {
    const now = deps.now();
    for (const record of records) {
      record.fetchedAt = now;
      if (state !== void 0) record.lastState = state;
      await deps.meta.put(record);
    }
    return { kind: "304-confirmed" };
  }
  if (fresh.status >= 200 && fresh.status < 300) {
    const decision = classifyResponse(rl, resLike(fresh));
    const newEtag = fresh.headers.get("etag") ?? void 0;
    if (decision.cacheable) {
      await purgeStaleVariants(url, records, computeVaryKey(rl, resLike(fresh)), deps);
      await putCanonical(rl, fresh, deps);
      await deps.meta.put(
        metadataFromResponse(rl, resLike(fresh), deps.now(), decision.negative, state ?? newEtag)
      );
      deps.broadcast.postMessage({ url, event: "updated", etag: newEtag });
      return { kind: "updated", etag: newEtag };
    }
    return purge(url, records, deps);
  }
  if (fresh.status === 403 || fresh.status === 404) {
    return purge(url, records, deps);
  }
  return { kind: "skipped" };
}
async function refreshListing(frame, deps) {
  const container = frame.target ?? frame.object;
  const records = await deps.meta.getByUrl(container);
  if (records.length === 0) {
    return { kind: "not-cached" };
  }
  const req = rdfRequest(container);
  const rl = { url: req.url, method: req.method, headers: req.headers };
  const fresh = await deps.fetch(req);
  if (fresh.status >= 200 && fresh.status < 300) {
    const decision = classifyResponse(rl, resLike(fresh));
    if (!decision.cacheable) {
      return purge(container, records, deps);
    }
    await purgeStaleVariants(container, records, computeVaryKey(rl, resLike(fresh)), deps);
    await putCanonical(rl, fresh, deps);
    await deps.meta.put(
      metadataFromResponse(
        rl,
        resLike(fresh),
        deps.now(),
        decision.negative,
        fresh.headers.get("etag") ?? void 0
      )
    );
    deps.broadcast.postMessage({
      url: container,
      event: "updated",
      etag: fresh.headers.get("etag") ?? void 0
    });
    return { kind: "listing-refreshed" };
  }
  if (fresh.status === 403 || fresh.status === 404) {
    return purge(container, records, deps);
  }
  return { kind: "skipped" };
}
async function resyncSweep(deps) {
  const result = { checked: 0, confirmed: 0, replaced: 0, purged: 0, skipped: 0 };
  const all = await deps.meta.getAll();
  const byUrl = /* @__PURE__ */ new Map();
  for (const record of all) {
    const list = byUrl.get(record.url) ?? [];
    list.push(record);
    byUrl.set(record.url, list);
  }
  for (const [url, records] of byUrl) {
    if (records.every((r) => r.status === 403 || r.status === 404)) continue;
    const etag = records.find((r) => r.etag)?.etag;
    if (!etag) {
      result.skipped += 1;
      continue;
    }
    result.checked += 1;
    const outcome = await revalidateResource(url, records, void 0, deps);
    if (outcome.kind === "304-confirmed") result.confirmed += 1;
    else if (outcome.kind === "updated") result.replaced += 1;
    else if (outcome.kind === "deleted") result.purged += 1;
    else result.skipped += 1;
  }
  return result;
}

// src/scope.ts
var CACHE_FORMAT = "v2";
var DB_PREFIX = `solid-offline-${CACHE_FORMAT}:`;
var CACHE_PREFIX = `solid-offline-cache-${CACHE_FORMAT}:`;
var ANONYMOUS_SCOPE = "anonymous";
function scopeHash(webId) {
  let h = 2166136261;
  for (let i = 0; i < webId.length; i++) {
    h ^= webId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function scopeFor(webId) {
  return webId ? scopeHash(webId) : ANONYMOUS_SCOPE;
}
function dbNameForWebId(webId) {
  return `${DB_PREFIX}${scopeFor(webId)}`;
}
function cacheNameForWebId(webId) {
  return `${CACHE_PREFIX}${scopeFor(webId)}`;
}
function isScopeChange(configured, current, next) {
  return !configured || next !== current;
}

// src/metadata-store.ts
var STORE = "metadata";
var DB_VERSION = 1;
function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function openMetadataDb(dbName, factory = globalThis.indexedDB) {
  if (!factory) {
    throw new Error("[solid-offline] no IndexedDB available in this context");
  }
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "key" });
        os.createIndex("byUrl", "url", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
var MetadataStore = class _MetadataStore {
  constructor(db) {
    this.db = db;
  }
  db;
  static async open(webId, factory) {
    const db = await openMetadataDb(dbNameForWebId(webId), factory);
    return new _MetadataStore(db);
  }
  /** For tests / advanced callers: open against an explicit DB name. */
  static async openNamed(dbName, factory) {
    const db = await openMetadataDb(dbName, factory);
    return new _MetadataStore(db);
  }
  async get(key) {
    const tx = this.db.transaction(STORE, "readonly");
    const result = await promisifyRequest(
      tx.objectStore(STORE).get(key)
    );
    return result;
  }
  async put(record) {
    const tx = this.db.transaction(STORE, "readwrite");
    await promisifyRequest(tx.objectStore(STORE).put(record));
    await txDone(tx);
  }
  async delete(key) {
    const tx = this.db.transaction(STORE, "readwrite");
    await promisifyRequest(tx.objectStore(STORE).delete(key));
    await txDone(tx);
  }
  /** All metadata entries for a given URL (across varyKeys). */
  async getByUrl(url) {
    const tx = this.db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("byUrl");
    return promisifyRequest(index.getAll(url));
  }
  /**
   * All metadata entries (every (url, varyKey)). Used by P3's reconnect
   * ETag-resync sweep and disconnected `If-None-Match` polling to enumerate the
   * warmed set. Cheap relative to the network it saves; the warm budget bounds it.
   */
  async getAll() {
    const tx = this.db.transaction(STORE, "readonly");
    return promisifyRequest(tx.objectStore(STORE).getAll());
  }
  /**
   * Record the last notification `state` (ETag carried in a change frame) for a
   * resource, across every cached variant of that URL. Lets the SW short-circuit
   * a self-caused change (`frame.state === lastState`) without a network round-trip.
   */
  async setLastState(url, state) {
    const records = await this.getByUrl(url);
    for (const record of records) {
      record.lastState = state;
      await this.put(record);
    }
  }
  /** Touch fetchedAt (used on a 304 — confirms provisional bytes are still fresh). */
  async touch(key, at = Date.now()) {
    const existing = await this.get(key);
    if (!existing) return;
    existing.fetchedAt = at;
    await this.put(existing);
  }
  async clear() {
    const tx = this.db.transaction(STORE, "readwrite");
    await promisifyRequest(tx.objectStore(STORE).clear());
    await txDone(tx);
  }
  close() {
    this.db.close();
  }
};
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// src/swr.ts
var IGNORE_VARY2 = { ignoreVary: true };
function reqLike(request) {
  return { url: request.url, method: request.method, headers: request.headers };
}
function resLike2(response) {
  return { status: response.status, headers: response.headers, type: response.type };
}
function withOfflineStale(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Offline", "stale");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
function metadataFromResponse2(req, res, now, negative) {
  const varyKey = computeVaryKey(req, res);
  return {
    key: computeCacheKey(req, res),
    url: req.url,
    varyKey,
    etag: res.headers.get("etag") ?? void 0,
    contentType: res.headers.get("content-type") ?? void 0,
    fetchedAt: now,
    vary: res.headers.get("vary") ?? void 0,
    aclStatus: aclStatusFor(res.status),
    status: res.status,
    ...negative ? { negativeUntil: now + NEGATIVE_CACHE_TTL_MS } : {}
  };
}
async function handleFetch(request, deps) {
  const rl = reqLike(request);
  if (!isPotentiallyCacheable(rl)) {
    const response = await deps.fetch(request);
    return { response, source: "network-no-cache" };
  }
  const now = deps.now();
  if (rl.method.toUpperCase() === "HEAD") {
    const response = await deps.fetch(request);
    const headEtag = response.headers.get("etag") ?? void 0;
    if (response.status >= 200 && response.status < 300 && headEtag !== void 0) {
      const existing = await lookupRecord(rl, deps);
      if (existing && headEtag === existing.etag) {
        await deps.meta.touch(existing.key, deps.now());
      }
    }
    return { response, source: "network-no-cache" };
  }
  const directive = requestCacheDirective(rl);
  if (deps.isOnline() && directive !== "default") {
    if (directive === "no-store") {
      const passthrough = new Request(request, { method: "GET", cache: "no-store" });
      const response = await deps.fetch(passthrough);
      return { response, source: "request-no-store" };
    }
    return forcedRevalidate(request, rl, deps);
  }
  const record = await lookupRecord(rl, deps);
  const keyReq = record ? keyRequest(rl.url, record.varyKey) : keyRequest(rl.url, varyKeyForRequest(rl));
  if (!record) {
    await deps.cache.delete(keyReq, IGNORE_VARY2).catch(() => false);
    if (!deps.isOnline()) {
      const response = await deps.fetch(request);
      return { response, source: "offline-miss" };
    }
    return networkAndMaybeStore(request, rl, deps);
  }
  if (record.status === 403 || record.status === 404) {
    if (record.negativeUntil && now < record.negativeUntil) {
      const negBytes = await deps.cache.match(keyReq, IGNORE_VARY2);
      const response = negBytes ? negBytes.clone() : new Response(null, { status: record.status });
      return { response, source: "cache-hit-negative" };
    }
    return networkAndMaybeStore(request, rl, deps);
  }
  const cached = await deps.cache.match(keyReq, IGNORE_VARY2);
  if (!cached) {
    if (!deps.isOnline()) {
      const response = await deps.fetch(request);
      return { response, source: "offline-miss" };
    }
    return networkAndMaybeStore(request, rl, deps);
  }
  if (deps.isOnline()) {
    const revalidation = revalidate(request, rl, record, deps);
    return {
      response: cached.clone(),
      source: "cache-hit-online",
      revalidation
    };
  }
  return { response: withOfflineStale(cached.clone()), source: "cache-hit-offline" };
}
async function forcedRevalidate(request, rl, deps) {
  const record = await lookupRecord(rl, deps);
  const condHeaders = new Headers(request.headers);
  if (!condHeaders.has("cache-control")) condHeaders.set("cache-control", "no-cache");
  if (record?.etag) condHeaders.set("If-None-Match", record.etag);
  const condRequest = new Request(request, {
    method: "GET",
    headers: condHeaders,
    cache: "no-cache"
  });
  const fresh = await deps.fetch(condRequest);
  if (fresh.status === 304 && record?.etag) {
    const keyReq = keyRequest(rl.url, record.varyKey);
    const cached = await deps.cache.match(keyReq, IGNORE_VARY2);
    await deps.meta.touch(record.key, deps.now());
    if (cached) {
      return { response: cached.clone(), source: "request-no-cache-revalidated" };
    }
  }
  if (fresh.status === 304) {
    await purgeAllVariants(rl.url, deps);
    const unconditional = new Headers(request.headers);
    unconditional.delete("if-none-match");
    unconditional.delete("if-modified-since");
    unconditional.delete("if-match");
    unconditional.delete("if-unmodified-since");
    unconditional.delete("if-range");
    if (!unconditional.has("cache-control")) unconditional.set("cache-control", "no-cache");
    const refetch = await deps.fetch(
      new Request(request, { method: "GET", headers: unconditional, cache: "no-cache" })
    );
    return finalizeForced(rl, refetch, deps);
  }
  return finalizeForced(rl, fresh, deps);
}
async function finalizeForced(rl, fresh, deps) {
  const authoritative = fresh.status >= 200 && fresh.status < 300 || fresh.status === 403 || fresh.status === 404;
  if (!authoritative) {
    return { response: fresh, source: "request-no-cache-revalidated" };
  }
  const decision = classifyResponse(rl, resLike2(fresh));
  await purgeAllVariants(rl.url, deps);
  if (decision.cacheable) await store(rl, fresh, deps, decision.negative);
  deps.broadcast.postMessage({
    url: rl.url,
    event: "updated",
    etag: fresh.headers.get("etag") ?? void 0
  });
  return { response: fresh.clone(), source: "request-no-cache-revalidated" };
}
function isPotentiallyCacheable(req) {
  const decision = classifyResponse(req, {
    status: 200,
    headers: req.headers,
    type: "basic"
  });
  return decision.reason !== "method-not-get-head" && decision.reason !== "never-cache-endpoint";
}
function varyKeyForRequest(rl) {
  return computeVaryKey(rl, { headers: syntheticVaryAccept()});
}
function syntheticVaryAccept() {
  const h = new Headers();
  h.set("vary", "Accept");
  return h;
}
async function lookupRecord(rl, deps) {
  const rows = await deps.meta.getByUrl(rl.url);
  if (rows.length === 0) return void 0;
  for (const row of rows) {
    const requestVaryKey = computeVaryKey(rl, {
      status: row.status,
      headers: varyHeaders(row.vary)});
    if (requestVaryKey === row.varyKey) return row;
  }
  return void 0;
}
function varyHeaders(vary) {
  const h = new Headers();
  h.set("vary", vary ?? "Accept");
  return h;
}
async function purgeAllVariants(url, deps) {
  const rows = await deps.meta.getByUrl(url);
  const seen = /* @__PURE__ */ new Set();
  for (const row of rows) {
    seen.add(row.varyKey);
    await deps.cache.delete(keyRequest(url, row.varyKey), IGNORE_VARY2).catch(() => false);
    await deps.meta.delete(row.key);
  }
  if (!seen.has("accept=text/turtle")) {
    await deps.cache.delete(keyRequest(url, "accept=text/turtle"), IGNORE_VARY2).catch(() => false);
  }
}
async function networkAndMaybeStore(request, rl, deps, _origin) {
  const response = await deps.fetch(request);
  const decision = classifyResponse(rl, resLike2(response));
  if (!decision.cacheable) {
    return { response, source: "network-miss-nostore" };
  }
  await store(rl, response, deps, decision.negative);
  return { response: response.clone(), source: "network-miss-store" };
}
async function store(rl, response, deps, negative) {
  const now = deps.now();
  const res = resLike2(response);
  const varyKey = computeVaryKey(rl, res);
  const keyReq = keyRequest(rl.url, varyKey);
  await deps.cache.put(keyReq, response.clone());
  await deps.meta.put(metadataFromResponse2(rl, res, now, negative));
}
async function revalidate(request, rl, record, deps) {
  if (!record || !record.etag) {
    return { kind: "skipped" };
  }
  const etag = record.etag;
  try {
    const condHeaders = new Headers(request.headers);
    condHeaders.set("If-None-Match", etag);
    const condRequest = new Request(request, { method: "GET", headers: condHeaders });
    const fresh = await deps.fetch(condRequest);
    if (fresh.status === 304) {
      await deps.meta.touch(record.key, deps.now());
      return { kind: "304-confirmed" };
    }
    if (fresh.status >= 200 && fresh.status < 300) {
      const decision = classifyResponse(rl, resLike2(fresh));
      if (decision.cacheable) {
        await purgeAllVariants(rl.url, deps);
        await store(rl, fresh, deps, decision.negative);
      } else {
        await purgeAllVariants(rl.url, deps);
      }
      const newEtag = fresh.headers.get("etag") ?? void 0;
      deps.broadcast.postMessage({ url: rl.url, event: "updated", etag: newEtag });
      return { kind: "200-replaced", etag: newEtag };
    }
    if (fresh.status === 403 || fresh.status === 404) {
      const decision = classifyResponse(rl, resLike2(fresh));
      await purgeAllVariants(rl.url, deps);
      if (decision.cacheable) {
        await store(rl, fresh, deps, decision.negative);
      }
      deps.broadcast.postMessage({ url: rl.url, event: "updated" });
      return { kind: "200-replaced" };
    }
    return { kind: "skipped" };
  } catch (error) {
    return { kind: "error", error };
  }
}

// src/worker.ts
var DEFAULT_CHANNEL_NAME = "solid-offline";
var metaPromise;
var channel;
var configuredWebId;
var webIdConfigured = false;
var channelName = DEFAULT_CHANNEL_NAME;
var shellConfig = self.__SOLID_OFFLINE_SHELL__ && self.__SOLID_OFFLINE_SHELL__.precache.length > 0 ? resolveAppShellConfig(self.__SOLID_OFFLINE_SHELL__) : void 0;
var shellPrecached = false;
var lastServingConfig;
var shellAdoptToken = 0;
function shellCaches() {
  return self.caches;
}
function shellDeps(config) {
  return {
    caches: shellCaches(),
    fetch: (input, init) => self.fetch(input, init),
    isOnline: () => self.navigator.onLine,
    config
  };
}
async function precacheConfig(config) {
  const { failed } = await precacheAppShell(shellCaches(), config);
  return failed.length === 0;
}
async function runPrecache() {
  if (!shellConfig || shellPrecached) return;
  shellPrecached = true;
  try {
    const complete = await precacheConfig(shellConfig);
    if (!complete) {
      shellPrecached = false;
      return;
    }
    await cleanupOldShellCaches(shellCaches(), shellConfig.version).catch(() => []);
  } catch {
    shellPrecached = false;
  }
}
function adoptShellConfig(next, event) {
  if (next.precache.length === 0) return;
  const resolved = resolveAppShellConfig(next);
  if (shellConfig && sameShellConfig(shellConfig, resolved)) {
    if (!shellPrecached) keepAlive(event, runPrecache);
    return;
  }
  if (!shellConfig) {
    shellConfig = resolved;
    shellPrecached = false;
    shellAdoptToken += 1;
    keepAlive(event, runPrecache);
    return;
  }
  shellAdoptToken += 1;
  const myToken = shellAdoptToken;
  keepAlive(event, async () => {
    try {
      const complete = await precacheConfig(resolved);
      if (complete && myToken === shellAdoptToken) {
        shellConfig = resolved;
        shellPrecached = true;
        await cleanupOldShellCaches(shellCaches(), resolved.version).catch(() => []);
      }
    } catch {
    }
  });
}
function getMeta() {
  if (!metaPromise) {
    metaPromise = MetadataStore.open(configuredWebId);
  }
  return metaPromise;
}
function resetMeta() {
  const prev = metaPromise;
  metaPromise = void 0;
  void prev?.then((store2) => store2.close()).catch(() => void 0);
}
function cacheName() {
  return cacheNameForWebId(configuredWebId);
}
function getChannel() {
  if (!channel) {
    channel = new BroadcastChannel(channelName);
  }
  return channel;
}
function setChannelName(name) {
  const resolved = name ?? DEFAULT_CHANNEL_NAME;
  if (resolved === channelName) return;
  channelName = resolved;
  channel?.close();
  channel = void 0;
}
self.addEventListener("install", (event) => {
  event.waitUntil(runPrecache().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (shellConfig && await shellBucketComplete(shellCaches(), shellConfig)) {
        shellPrecached = true;
        await cleanupOldShellCaches(shellCaches(), shellConfig.version).catch(() => []);
      }
      await self.clients.claim();
    })()
  );
});
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "config") {
    setChannelName(data.config.channelName);
    if (data.config.appShell) {
      adoptShellConfig(data.config.appShell, event);
    }
    const nextWebId = data.config.webId;
    const changed = isScopeChange(webIdConfigured, configuredWebId, nextWebId);
    if (changed) {
      configuredWebId = nextWebId;
      webIdConfigured = true;
      resetMeta();
    }
    event.source?.postMessage({ type: "ready" });
  } else if (data.type === "ping") {
    event.source?.postMessage({ type: "pong" });
  } else if (data.type === "notification") {
    const frame = data.frame;
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await handleNotification(frame, deps);
    });
  } else if (data.type === "resync") {
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await resyncSweep(deps);
    });
  } else if (data.type === "poll") {
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await resyncSweep(deps);
    });
  }
});
function keepAlive(event, task) {
  const p = task().catch(() => void 0);
  if (typeof event.waitUntil === "function") event.waitUntil(p);
}
async function invalidateDeps() {
  const cache = await self.caches.open(cacheName());
  const meta = await getMeta();
  return {
    cache,
    meta,
    fetch: (input, init) => self.fetch(input, init),
    broadcast: getChannel(),
    now: () => Date.now()
  };
}
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return;
  }
  if (shellConfig) {
    if (request.mode === "navigate" && method === "GET") {
      event.respondWith(respondShellNavigation(event));
      return;
    }
    if (method === "GET" && isSameOrigin(request.url) && (isPrecachedAsset(request.url, shellConfig) || lastServingConfig !== void 0 && isPrecachedAsset(request.url, lastServingConfig))) {
      event.respondWith(respondShellAsset(event));
      return;
    }
  }
  event.respondWith(respond(event));
});
function isSameOrigin(url) {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch {
    return false;
  }
}
async function servingConfig() {
  if (!shellConfig) return void 0;
  try {
    const resolved = await resolveServingShellConfig(shellCaches(), shellConfig);
    lastServingConfig = resolved;
    return resolved;
  } catch {
    return shellConfig;
  }
}
async function respondShellNavigation(event) {
  const config = await servingConfig();
  if (!config) return self.fetch(event.request);
  try {
    const result = await handleNavigation(event.request, shellDeps(config));
    return result.response;
  } catch {
    return self.fetch(event.request);
  }
}
async function respondShellAsset(event) {
  const config = await servingConfig();
  if (!config) return self.fetch(event.request);
  try {
    const result = await handlePrecachedAsset(event.request, shellDeps(config));
    return result.response;
  } catch {
    return self.fetch(event.request);
  }
}
async function respond(event) {
  const cache = await self.caches.open(cacheName());
  const meta = await getMeta();
  const deps = {
    cache,
    meta,
    fetch: (input, init) => self.fetch(input, init),
    broadcast: getChannel(),
    now: () => Date.now(),
    isOnline: () => self.navigator.onLine
  };
  try {
    const result = await handleFetch(event.request, deps);
    if (result.revalidation && typeof event.waitUntil === "function") {
      event.waitUntil(result.revalidation.then(() => void 0));
    }
    return result.response;
  } catch {
    return self.fetch(event.request);
  }
}
//# sourceMappingURL=worker.js.map
//# sourceMappingURL=worker.js.map