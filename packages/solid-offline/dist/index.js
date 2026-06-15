import { Parser } from 'n3';

// src/scope.ts
var CACHE_FORMAT = "v2";
var DB_PREFIX = `solid-offline-${CACHE_FORMAT}:`;
var CACHE_PREFIX = `solid-offline-cache-${CACHE_FORMAT}:`;
var ANONYMOUS_SCOPE = "anonymous";
var DEFAULT_DB_NAME = `${DB_PREFIX}${ANONYMOUS_SCOPE}`;
var DEFAULT_CACHE_NAME = `${CACHE_PREFIX}${ANONYMOUS_SCOPE}`;
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

// src/logout.ts
function resolveCaches(deps) {
  if (deps.caches) return deps.caches;
  if (typeof caches !== "undefined") return caches;
  return void 0;
}
function resolveIdb(deps) {
  return deps.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : void 0);
}
function deleteDatabase(factory, name) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = factory.deleteDatabase(name);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve("deleted");
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error);
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      resolve("blocked");
    };
  });
}
async function purgeForWebId(webId, deps = {}) {
  const cacheName = cacheNameForWebId(webId);
  const dbName = dbNameForWebId(webId);
  const result = {
    cacheName,
    dbName,
    cacheDeleted: false,
    dbDeleted: false,
    dbBlocked: false,
    errors: []
  };
  const cacheStore = resolveCaches(deps);
  if (cacheStore) {
    try {
      result.cacheDeleted = await cacheStore.delete(cacheName);
    } catch (error) {
      result.errors.push(error);
    }
  }
  const idb = resolveIdb(deps);
  if (idb) {
    try {
      const outcome = await deleteDatabase(idb, dbName);
      if (outcome === "deleted") {
        result.dbDeleted = true;
      } else {
        result.dbBlocked = true;
      }
    } catch (error) {
      result.errors.push(error);
    }
  }
  return result;
}
var NS = {
  pimStorage: "http://www.w3.org/ns/pim/space#storage",
  ldpContains: "http://www.w3.org/ns/ldp#contains",
  solidPublicTypeIndex: "http://www.w3.org/ns/solid/terms#publicTypeIndex",
  solidPrivateTypeIndex: "http://www.w3.org/ns/solid/terms#privateTypeIndex",
  ldpInbox: "http://www.w3.org/ns/ldp#inbox",
  // Type Index registration → instance / instanceContainer.
  solidInstance: "http://www.w3.org/ns/solid/terms#instance",
  solidInstanceContainer: "http://www.w3.org/ns/solid/terms#instanceContainer"
};
function parseTurtle(body, baseIRI) {
  try {
    const parser = new Parser(baseIRI ? { baseIRI } : void 0);
    return parser.parse(body);
  } catch {
    return [];
  }
}
function objectsOf(quads, predicate) {
  const out = [];
  for (const q of quads) {
    if (q.predicate.value === predicate && q.object.termType === "NamedNode") {
      out.push(q.object.value);
    }
  }
  return out;
}
function objectsOfSubject(quads, subject, predicate) {
  const out = [];
  for (const q of quads) {
    if (q.subject.value === subject && q.predicate.value === predicate && q.object.termType === "NamedNode") {
      out.push(q.object.value);
    }
  }
  return out;
}
function absolutize(iri, base) {
  try {
    return new URL(iri, base).toString();
  } catch {
    return void 0;
  }
}
function deriveSeeds(webId, profileTurtle) {
  const quads = parseTurtle(profileTurtle, webId);
  const seeds = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (raw, kind) => {
    const abs = absolutize(raw, webId);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    seeds.push({ url: abs, kind });
  };
  const subjects = profileSubjects(webId);
  const objectsForSelf = (predicate) => {
    for (const subject of subjects) {
      const hits = objectsOfSubject(quads, subject, predicate);
      if (hits.length > 0) return hits;
    }
    return [];
  };
  for (const t of objectsForSelf(NS.solidPublicTypeIndex)) add(t, "typeIndex");
  for (const t of objectsForSelf(NS.solidPrivateTypeIndex)) add(t, "typeIndex");
  for (const s of objectsForSelf(NS.pimStorage)) add(s, "storage");
  for (const i of objectsForSelf(NS.ldpInbox)) add(i, "inbox");
  return seeds;
}
function profileSubjects(webId) {
  const subjects = [webId];
  try {
    const u = new URL(webId);
    if (u.hash) {
      u.hash = "";
      const doc = u.toString();
      if (doc !== webId) subjects.push(doc);
    }
  } catch {
  }
  return subjects;
}
function containerChildren(containerUrl, listingTurtle) {
  const quads = parseTurtle(listingTurtle, containerUrl);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
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
function typeIndexTargets(typeIndexUrl, indexTurtle) {
  const quads = parseTurtle(indexTurtle, typeIndexUrl);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
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
function isContainer(url) {
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return false;
  }
}
function aclUrlFor(resourceUrl, linkHeader) {
  const fromLink = aclFromLinkHeader(resourceUrl, linkHeader);
  if (fromLink) return fromLink;
  try {
    const u = new URL(resourceUrl);
    if (u.pathname.endsWith(".acl")) return void 0;
    return `${resourceUrl}${resourceUrl.endsWith("/") ? "" : ""}.acl`;
  } catch {
    return void 0;
  }
}
function aclFromLinkHeader(base, linkHeader) {
  if (!linkHeader) return void 0;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*(.*)/);
    if (!m) continue;
    const target = m[1];
    const params = m[2]?.toLowerCase() ?? "";
    if (target && /rel\s*=\s*"?acl"?/.test(params)) {
      return absolutize(target, base);
    }
  }
  return void 0;
}
function parseWacAllow(header) {
  const result = { user: /* @__PURE__ */ new Set(), public: /* @__PURE__ */ new Set() };
  if (!header) return result;
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m = re.exec(header);
  while (m !== null) {
    const group = m[1]?.toLowerCase();
    const modes = (m[2] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (group === "user") for (const mode of modes) result.user.add(mode);
    else if (group === "public") for (const mode of modes) result.public.add(mode);
    m = re.exec(header);
  }
  return result;
}
function userCanRead(header) {
  const wac = parseWacAllow(header);
  if (!header) return true;
  return wac.user.has("read") || wac.public.has("read");
}

// src/notifications.ts
var NOTIFY_SUBSCRIPTION = "http://www.w3.org/ns/solid/notifications#subscription";
var STORAGE_DESCRIPTION_REL = "http://www.w3.org/ns/solid/terms#storageDescription";
var KNOWN_ACTIVITY_TYPES = [
  "Create",
  "Update",
  "Delete",
  "Add",
  "Remove"
];
var DEFAULTS = {
  maxChannels: 50,
  backoffBaseMs: 1e3,
  backoffMaxMs: 3e4,
  pollIntervalMs: 6e4
};
async function discoverSubscriptionUrl(resourceUrl, fetchImpl) {
  let descriptionUrl;
  try {
    const head = await fetchImpl(new Request(resourceUrl, { method: "HEAD" }));
    descriptionUrl = storageDescriptionFromLink(resourceUrl, head.headers.get("link"));
  } catch {
    descriptionUrl = void 0;
  }
  if (!descriptionUrl) {
    descriptionUrl = await wellKnownStorageDescription(resourceUrl, fetchImpl);
  }
  if (!descriptionUrl) return void 0;
  try {
    const res = await fetchImpl(
      new Request(descriptionUrl, { method: "GET", headers: { accept: "text/turtle" } })
    );
    if (!res.ok) return void 0;
    const quads = parseTurtle(await res.text(), descriptionUrl);
    for (const q of quads) {
      if (q.predicate.value === NOTIFY_SUBSCRIPTION && q.object.termType === "NamedNode") {
        return q.object.value;
      }
    }
  } catch {
  }
  return void 0;
}
function storageDescriptionFromLink(base, linkHeader) {
  if (!linkHeader) return void 0;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*(.*)/);
    if (!m) continue;
    const target = m[1];
    const params = (m[2] ?? "").toLowerCase();
    if (target && (params.includes(STORAGE_DESCRIPTION_REL.toLowerCase()) || /rel\s*=\s*"?storagedescription"?/.test(params))) {
      try {
        return new URL(target, base).toString();
      } catch {
        return void 0;
      }
    }
  }
  return void 0;
}
async function wellKnownStorageDescription(resourceUrl, fetchImpl) {
  let wellKnown;
  try {
    wellKnown = new URL("/.well-known/solid", resourceUrl).toString();
  } catch {
    return void 0;
  }
  try {
    const res = await fetchImpl(new Request(wellKnown, { method: "GET" }));
    if (!res.ok) return void 0;
    const doc = await res.json();
    return typeof doc.storageDescription === "string" ? doc.storageDescription : void 0;
  } catch {
    return void 0;
  }
}
async function subscribe(subscriptionUrl, topic, fetchImpl) {
  try {
    const res = await fetchImpl(
      new Request(subscriptionUrl, {
        method: "POST",
        headers: { "content-type": "application/ld+json" },
        body: JSON.stringify({
          "@context": ["https://www.w3.org/ns/solid/notification/v1"],
          type: "WebSocketChannel2023",
          topic
        })
      })
    );
    if (!res.ok) return void 0;
    const doc = await res.json();
    return typeof doc.receiveFrom === "string" ? doc.receiveFrom : void 0;
  } catch {
    return void 0;
  }
}
function parseFrame(data) {
  let doc;
  if (typeof data === "string") {
    try {
      doc = JSON.parse(data);
    } catch {
      return void 0;
    }
  } else if (data && typeof data === "object") {
    doc = data;
  } else {
    return void 0;
  }
  const obj = doc;
  const type = obj.type;
  const activity = (Array.isArray(type) ? type : [type]).find(
    (t) => KNOWN_ACTIVITY_TYPES.includes(t)
  );
  if (!activity) return void 0;
  const object = flattenRef(obj.object);
  if (!object) return void 0;
  const frame = { type: activity, object };
  const target = flattenRef(obj.target);
  if (target !== void 0) frame.target = target;
  if (typeof obj.state === "string") frame.state = obj.state;
  return frame;
}
function flattenRef(ref) {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && typeof ref.id === "string") {
    return ref.id;
  }
  return void 0;
}
function backoffDelay(attempt, baseMs, maxMs) {
  const delay = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxMs);
}
function createNotificationsClient(deps, config) {
  const timers = deps.timers ?? globalThis;
  const isOnline = deps.isOnline ?? (() => true);
  const maxChannels = config.maxChannels ?? DEFAULTS.maxChannels;
  const backoffBase = config.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  const backoffMax = config.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
  const pollInterval = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
  const topics = [...config.containers, ...config.resources ?? []].slice(0, maxChannels);
  const channels = topics.map((topic) => ({ topic, closed: false }));
  let subscriptionUrlCache;
  let openSockets = 0;
  let pollTimer;
  let stopped = false;
  async function discover() {
    if (subscriptionUrlCache) return subscriptionUrlCache;
    const seed = topics[0];
    if (!seed) return void 0;
    subscriptionUrlCache = await discoverSubscriptionUrl(seed, deps.fetch);
    return subscriptionUrlCache;
  }
  async function connectChannel(channel, attempt) {
    if (stopped || channel.closed) return;
    if (!isOnline()) {
      schedulePoll();
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    const subscriptionUrl = await discover();
    if (!subscriptionUrl) {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    const receiveFrom = await subscribe(subscriptionUrl, channel.topic, deps.fetch);
    if (!receiveFrom) {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    openSocket(channel, receiveFrom, attempt);
  }
  function openSocket(channel, receiveFrom, attempt) {
    if (stopped || channel.closed) return;
    let socket;
    try {
      socket = deps.socketFactory(receiveFrom);
    } catch {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    channel.socket = socket;
    socket.addEventListener("open", () => {
      openSockets += 1;
      cancelPoll();
      deps.requestResync();
    });
    socket.addEventListener("message", (ev) => {
      const data = ev?.data ?? ev;
      const frame = parseFrame(data);
      if (frame) deps.postToWorker(frame);
    });
    socket.addEventListener("close", () => {
      if (channel.socket === socket) channel.socket = void 0;
      openSockets = Math.max(0, openSockets - 1);
      scheduleReconnect(channel, attempt + 1);
    });
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
      }
    });
  }
  function scheduleReconnect(channel, attempt) {
    if (stopped || channel.closed) return;
    schedulePoll();
    const delay = backoffDelay(attempt, backoffBase, backoffMax);
    timers.setTimeout(() => {
      void connectChannel(channel, attempt);
    }, delay);
  }
  function schedulePoll() {
    if (stopped || pollTimer !== void 0 || openSockets > 0) return;
    pollTimer = timers.setTimeout(function tick() {
      if (stopped || openSockets > 0) {
        pollTimer = void 0;
        return;
      }
      deps.requestPoll();
      pollTimer = timers.setTimeout(tick, pollInterval);
    }, pollInterval);
  }
  function cancelPoll() {
    if (pollTimer !== void 0) {
      timers.clearTimeout(pollTimer);
      pollTimer = void 0;
    }
  }
  return {
    async start() {
      stopped = false;
      await Promise.all(channels.map((c) => connectChannel(c, 0)));
    },
    stop() {
      stopped = true;
      cancelPoll();
      for (const channel of channels) {
        channel.closed = true;
        try {
          channel.socket?.close();
        } catch {
        }
        channel.socket = void 0;
      }
      openSockets = 0;
    },
    get connected() {
      return openSockets > 0;
    }
  };
}

// src/status.ts
var DEFAULT_CHANNEL_NAME = "solid-offline";
function defaultIsOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
function defaultConnectivity() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined" && "addEventListener" in globalThis) {
    return globalThis;
  }
  return void 0;
}
function defaultChannel(name) {
  if (typeof BroadcastChannel === "undefined") return void 0;
  return new BroadcastChannel(name);
}
function createStatusSurface(options = {}) {
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const channel = options.channel ?? defaultChannel(channelName);
  const connectivity = options.connectivity ?? defaultConnectivity();
  const listeners = /* @__PURE__ */ new Set();
  const resources = /* @__PURE__ */ new Map();
  let online = isOnline();
  let snapshot = computeSnapshot();
  function computeSnapshot() {
    let pending = 0;
    let stale = 0;
    let updated = 0;
    const map = {};
    for (const [url, freshness] of resources) {
      map[url] = freshness;
      if (freshness === "pending") pending += 1;
      else if (freshness === "stale") stale += 1;
      else if (freshness === "updated") updated += 1;
    }
    return { online, pending, stale, updated, resources: map };
  }
  function emit() {
    snapshot = computeSnapshot();
    for (const listener of listeners) listener();
  }
  function setFreshness(url, freshness) {
    if (resources.get(url) === freshness) return;
    resources.set(url, freshness);
    emit();
  }
  const onMessage = (event) => {
    const data = event.data;
    if (!data || data.event !== "updated") return;
    if (resources.has(data.url)) setFreshness(data.url, "updated");
  };
  const onOnline = () => {
    if (online) return;
    online = true;
    emit();
  };
  const onOffline = () => {
    if (!online) return;
    online = false;
    emit();
  };
  channel?.addEventListener("message", onMessage);
  connectivity?.addEventListener("online", onOnline);
  connectivity?.addEventListener("offline", onOffline);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    markPending(url) {
      setFreshness(url, "pending");
    },
    markFresh(url) {
      setFreshness(url, "fresh");
    },
    markStale(url) {
      setFreshness(url, "stale");
    },
    forget(url) {
      if (!resources.delete(url)) return;
      emit();
    },
    close() {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      connectivity?.removeEventListener("online", onOnline);
      connectivity?.removeEventListener("offline", onOffline);
      listeners.clear();
      resources.clear();
    }
  };
}

// src/warmer.ts
var DEFAULT_WARM_BUDGET = {
  maxResources: 500,
  maxBytes: 5e7,
  maxDepth: 6,
  concurrency: 4
};
var BINARY_TYPE_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "application/octet-stream",
  "application/pdf",
  "application/zip"
];
var LARGE_RESOURCE_BYTES = 5e6;
function isBinaryType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return BINARY_TYPE_PREFIXES.some((p) => ct.startsWith(p));
}
function bodyBytes(buf, contentLength) {
  if (buf) return buf.byteLength;
  const n = contentLength ? Number.parseInt(contentLength, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
async function warm(webId, deps, budget = DEFAULT_WARM_BUDGET, profileTurtle, opts) {
  const state = {
    enqueued: /* @__PURE__ */ new Set(),
    negative: /* @__PURE__ */ new Set(),
    warmed: 0,
    visited: 0,
    bytes: 0,
    pruned: [],
    budgetHit: false,
    visits: [],
    reserved: 0
  };
  const customSeeds = (opts?.seeds ?? []).map((url) => ({ url, kind: "storage" }));
  let profile = profileTurtle;
  if (profile === void 0) {
    try {
      const res = await deps.fetch(rdfRequest(webId));
      if (res.ok) {
        profile = await res.text();
        recordVisit(state, deps, {
          url: webId,
          kind: "profile",
          depth: 0,
          status: res.status,
          bytes: byteLen(profile)
        });
      }
    } catch {
    }
  }
  const seeds = profile !== void 0 ? deriveSeeds(webId, profile) : [];
  if (seeds.length === 0 && customSeeds.length === 0) {
    return finalize(state);
  }
  const frontier = [];
  for (const seed of orderSeeds([...seeds, ...customSeeds])) {
    enqueue(state, frontier, seed.url, seed.kind, 0);
  }
  let depth = 0;
  let current = frontier.splice(0);
  while (current.length > 0 && !budgetExceeded(state, budget)) {
    if (depth > budget.maxDepth) break;
    const next = [];
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
function orderSeeds(seeds) {
  const rank = {
    typeIndex: 0,
    storage: 1,
    inbox: 2,
    acl: 3,
    profile: 4
  };
  return [...seeds].sort((a, b) => rank[a.kind] - rank[b.kind]);
}
function enqueue(state, frontier, url, kind, depth) {
  if (state.enqueued.has(url) || state.negative.has(url)) return;
  state.enqueued.add(url);
  frontier.push({ url, kind, depth });
}
async function visit(item, state, deps, budget) {
  const discovered = [];
  let head;
  try {
    head = await deps.fetch(headRequest(item.url));
  } catch {
    head = void 0;
  }
  if (head?.ok) {
    const ct = head.headers.get("content-type");
    const cl = head.headers.get("content-length");
    const probedLarge = bodyBytes(null, cl) > LARGE_RESOURCE_BYTES;
    const probedBinary = isBinaryType(ct);
    if (probedBinary || probedLarge) {
      state.visited += 1;
      recordVisit(state, deps, {
        url: item.url,
        kind: item.kind,
        depth: item.depth,
        status: head.status,
        bytes: bodyBytes(null, cl),
        skipped: probedBinary ? "large-binary" : "large-resource"
      });
      return discovered;
    }
  }
  if (state.reserved >= budget.maxResources) {
    state.budgetHit = true;
    return discovered;
  }
  state.reserved += 1;
  let res;
  try {
    res = await deps.fetch(rdfRequest(item.url));
  } catch {
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: 0,
      bytes: 0,
      skipped: "fetch-error"
    });
    return discovered;
  }
  state.visited += 1;
  if (res.status === 403 || res.status === 404) {
    return pruneForbidden(item, res.status, state, deps, discovered);
  }
  if (!res.ok) {
    recordVisit(state, deps, {
      url: item.url,
      kind: item.kind,
      depth: item.depth,
      status: res.status,
      bytes: 0,
      skipped: "fetch-error"
    });
    return discovered;
  }
  const wacAllow = res.headers.get("wac-allow");
  const canRead = userCanRead(wacAllow);
  const contentType = res.headers.get("content-type");
  const contentLength = res.headers.get("content-length");
  const container = isContainer(item.url) || contentType?.toLowerCase().includes("text/turtle") && wantsContainerEnumeration(item.kind);
  const declaredLarge = bodyBytes(null, contentLength) > LARGE_RESOURCE_BYTES;
  const binary = isBinaryType(contentType);
  let bytes = 0;
  let skipped;
  if (binary) {
    skipped = "large-binary";
    bytes = bodyBytes(null, contentLength);
  } else if (declaredLarge) {
    skipped = "large-resource";
    bytes = bodyBytes(null, contentLength);
  } else {
    const buf = await safeArrayBuffer(res);
    bytes = bodyBytes(buf, contentLength);
    if (state.bytes + bytes > budget.maxBytes) {
      state.budgetHit = true;
      recordVisit(state, deps, {
        url: item.url,
        kind: item.kind,
        depth: item.depth,
        status: res.status,
        bytes,
        skipped: "large-resource"
      });
      if (container && canRead) {
        const body = buf ? new TextDecoder().decode(buf) : "";
        enumerateContainer(item, body, discovered);
      }
      return discovered;
    }
    state.warmed += 1;
    state.bytes += bytes;
    if (canRead) {
      const body = buf ? new TextDecoder().decode(buf) : "";
      if (item.kind === "typeIndex") {
        for (const t of typeIndexTargets(item.url, body)) {
          discovered.push({ url: t, kind: "child", depth: item.depth + 1 });
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
      bytes
    });
    const acl = aclUrlFor(item.url, res.headers.get("link"));
    if (acl && !state.enqueued.has(acl) && !state.negative.has(acl)) {
      discovered.push({ url: acl, kind: "acl", depth: item.depth + 1 });
    }
    return discovered;
  }
  state.bytes += 0;
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status: res.status,
    bytes,
    skipped
  });
  return discovered;
}
function pruneForbidden(item, status, state, deps, discovered) {
  state.negative.add(item.url);
  state.pruned.push(item.url);
  deps.negativeCache?.(item.url, status);
  recordVisit(state, deps, {
    url: item.url,
    kind: item.kind,
    depth: item.depth,
    status,
    bytes: 0,
    skipped: status === 403 ? "forbidden" : "not-found"
  });
  return discovered;
}
function headRequest(url) {
  return new Request(url, { method: "HEAD", headers: { accept: "text/turtle" } });
}
function enumerateContainer(item, body, discovered) {
  for (const child of containerChildren(item.url, body)) {
    discovered.push({ url: child, kind: "child", depth: item.depth + 1 });
  }
}
function wantsContainerEnumeration(kind) {
  return kind === "storage" || kind === "inbox" || kind === "child";
}
function budgetExceeded(state, budget) {
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
async function safeArrayBuffer(res) {
  try {
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
function byteLen(s) {
  return new TextEncoder().encode(s).byteLength;
}
function rdfRequest(url) {
  return new Request(url, {
    method: "GET",
    headers: { accept: "text/turtle" }
  });
}
function recordVisit(state, deps, visit2) {
  state.visits.push(visit2);
  deps.onVisit?.(visit2);
}
function finalize(state) {
  return {
    warmed: state.warmed,
    visited: state.visited,
    bytes: state.bytes,
    pruned: state.pruned,
    budgetHit: state.budgetHit,
    visits: state.visits
  };
}
async function drain(items, concurrency, worker) {
  const limit = Math.max(1, concurrency);
  let cursor = 0;
  const runners = [];
  async function runOne() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      const item = items[idx];
      if (item === void 0) continue;
      await worker(item);
    }
  }
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(runOne());
  }
  await Promise.all(runners);
}
function resolveBudget(partial) {
  return {
    maxResources: partial?.maxResources ?? partial?.resources ?? DEFAULT_WARM_BUDGET.maxResources,
    maxBytes: partial?.maxBytes ?? partial?.bytes ?? DEFAULT_WARM_BUDGET.maxBytes,
    maxDepth: partial?.maxDepth ?? partial?.depth ?? DEFAULT_WARM_BUDGET.maxDepth,
    concurrency: partial?.concurrency ?? DEFAULT_WARM_BUDGET.concurrency
  };
}
function onIdle(task, timeoutMs = 2e3) {
  const ric = globalThis.requestIdleCallback;
  const cic = globalThis.cancelIdleCallback;
  if (typeof ric === "function") {
    const id = ric(task, { timeout: timeoutMs });
    return () => cic?.(id);
  }
  const t = setTimeout(task, 0);
  return () => clearTimeout(t);
}
function createWarmController(opts) {
  const budget = opts.budget ?? DEFAULT_WARM_BUDGET;
  let cancelIdle;
  let onlineHandler;
  let running;
  let pendingResultWaiters = [];
  function run() {
    if (running) return running;
    running = warm(opts.webId, opts.deps, budget, opts.profileTurtle, {
      ...opts.seeds ? { seeds: opts.seeds } : {}
    }).finally(() => {
      running = void 0;
    });
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
      }
    );
    return running;
  }
  function result() {
    if (running) return running;
    return new Promise((resolve, reject) => {
      pendingResultWaiters.push({ resolve, reject });
    });
  }
  if (opts.warmOnLogin !== false) {
    cancelIdle = onIdle(() => {
      void run();
    });
  }
  if (opts.rewarmOnReconnect !== false && typeof globalThis.addEventListener === "function") {
    onlineHandler = opts.onReconnect ? () => opts.onReconnect?.() : () => {
      void run();
    };
    globalThis.addEventListener("online", onlineHandler);
  }
  return {
    run,
    result,
    stop() {
      cancelIdle?.();
      if (onlineHandler && typeof globalThis.removeEventListener === "function") {
        globalThis.removeEventListener("online", onlineHandler);
      }
      const waiters = pendingResultWaiters;
      pendingResultWaiters = [];
      for (const w of waiters) w.reject(new Error("[solid-offline] warm controller stopped"));
    }
  };
}

// src/cache-policy.ts
var CANONICAL_RDF_ACCEPT = "text/turtle";
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
function rdfRequest2(url) {
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
  const req = rdfRequest2(url);
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
  const req = rdfRequest2(container);
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

// src/index.ts
var DEFAULTS2 = {
  workerUrl: "/solid-offline-worker.js",
  scope: "/",
  channelName: "solid-offline"
};
function createOfflineClient(config = {}) {
  const resolved = {
    ...config,
    workerUrl: config.workerUrl ?? DEFAULTS2.workerUrl,
    scope: config.scope ?? DEFAULTS2.scope,
    channelName: config.channelName ?? DEFAULTS2.channelName
  };
  let channel;
  let registration;
  let warmer;
  let notifications;
  let status;
  let onControllerChange;
  let closed = false;
  const listeners = /* @__PURE__ */ new Set();
  function postToWorker(message) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const target = registration?.active ?? navigator.serviceWorker.controller;
    target?.postMessage(message);
  }
  function startNotifications(containers) {
    if (closed) return void 0;
    if (notifications) return notifications;
    if (!config.notifications) return void 0;
    if (typeof WebSocket === "undefined") return void 0;
    const pageFetch = config.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : void 0);
    if (!pageFetch) return void 0;
    const nCfg = config.notifications === true ? {} : config.notifications;
    const topics = nCfg.containers ?? containers;
    if (topics.length === 0 && !nCfg.resources?.length) return void 0;
    notifications = createNotificationsClient(
      {
        fetch: pageFetch,
        socketFactory: (url) => new WebSocket(url),
        postToWorker: (frame) => postToWorker({ type: "notification", frame }),
        requestResync: () => postToWorker({ type: "resync" }),
        requestPoll: () => postToWorker({ type: "poll" }),
        isOnline: () => typeof navigator === "undefined" ? true : navigator.onLine
      },
      {
        containers: topics,
        ...nCfg.resources ? { resources: nCfg.resources } : {},
        ...nCfg.maxChannels !== void 0 ? { maxChannels: nCfg.maxChannels } : {},
        ...nCfg.backoffBaseMs !== void 0 ? { backoffBaseMs: nCfg.backoffBaseMs } : {},
        ...nCfg.backoffMaxMs !== void 0 ? { backoffMaxMs: nCfg.backoffMaxMs } : {},
        ...nCfg.pollIntervalMs !== void 0 ? { pollIntervalMs: nCfg.pollIntervalMs } : {}
      }
    );
    void notifications.start();
    return notifications;
  }
  function startWarmer() {
    if (closed) return void 0;
    if (warmer) return warmer;
    if (config.warm === false || config.warm === void 0) return void 0;
    if (!config.webId) return void 0;
    const pageFetch = config.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : void 0);
    if (!pageFetch) return void 0;
    const warmCfg = config.warm === true ? {} : config.warm;
    warmer = createWarmController({
      webId: config.webId,
      deps: { fetch: pageFetch },
      budget: resolveBudget(warmCfg.budget),
      warmOnLogin: warmCfg.warmOnLogin,
      rewarmOnReconnect: warmCfg.rewarmOnReconnect,
      // #16: pass through custom seeds (WarmConfig.seeds) when an explicit array
      // is supplied ('auto' / undefined keep pure profile derivation).
      ...Array.isArray(warmCfg.seeds) ? { seeds: warmCfg.seeds } : {},
      // P3 (P2-gap refactor): on reconnect, run the dedicated ETag-resync sweep in
      // the SW instead of re-issuing the full BFS. Only wired when notifications
      // are enabled (otherwise the warmer keeps its P2 full re-warm fallback).
      ...config.notifications ? { onReconnect: () => postToWorker({ type: "resync" }) } : {}
    });
    return warmer;
  }
  function ensureChannel() {
    if (channel) return channel;
    if (typeof BroadcastChannel === "undefined") return void 0;
    channel = new BroadcastChannel(resolved.channelName);
    channel.addEventListener("message", (event) => {
      const data = event.data;
      if (data && data.event === "updated") {
        for (const listener of listeners) listener(data);
      }
    });
    return channel;
  }
  function postConfig(target) {
    if (!target) return;
    if (closed) return;
    const { fetch: _pageFetch, ...cloneableConfig } = config;
    const message = {
      type: "config",
      config: { ...cloneableConfig, channelName: resolved.channelName }
    };
    target.postMessage(message);
  }
  async function register() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return void 0;
    }
    closed = false;
    ensureChannel();
    registration = await navigator.serviceWorker.register(resolved.workerUrl, {
      scope: resolved.scope
    });
    if (closed) return registration;
    const active = registration.active ?? navigator.serviceWorker.controller;
    if (active) {
      postConfig(active);
    }
    const installing = registration.installing ?? registration.waiting;
    if (installing) {
      installing.addEventListener("statechange", () => {
        if (installing.state === "activated") postConfig(installing);
      });
    }
    if (!onControllerChange) {
      onControllerChange = () => postConfig(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    startWarmer();
    if (config.notifications) {
      const nCfg = config.notifications === true ? {} : config.notifications;
      const hasExplicitTopics = nCfg.containers && nCfg.containers.length > 0 || nCfg.resources && nCfg.resources.length > 0;
      if (hasExplicitTopics) {
        startNotifications(nCfg.containers ?? []);
      } else {
        const w = startWarmer();
        const autoWarmOff = config.warm !== void 0 && config.warm !== true && config.warm !== false && config.warm.warmOnLogin === false;
        if (w && !autoWarmOff) {
          void w.result().then((result) => {
            startNotifications(containersFromWarm(result));
          }).catch(() => {
          });
        }
      }
    }
    return registration;
  }
  function containersFromWarm(result) {
    const seen = /* @__PURE__ */ new Set();
    for (const visit2 of result.visits) {
      try {
        if (new URL(visit2.url).pathname.endsWith("/")) seen.add(visit2.url);
      } catch {
      }
    }
    return [...seen];
  }
  async function warm2() {
    const w = startWarmer();
    if (!w) return void 0;
    const result = await w.run();
    if (config.notifications && !notifications) {
      const nCfg = config.notifications === true ? {} : config.notifications;
      const hasExplicitTopics = nCfg.containers && nCfg.containers.length > 0 || nCfg.resources && nCfg.resources.length > 0;
      if (!hasExplicitTopics) {
        startNotifications(containersFromWarm(result));
      }
    }
    return result;
  }
  function onUpdated(listener) {
    listeners.add(listener);
    ensureChannel();
    return () => listeners.delete(listener);
  }
  function getStatus() {
    if (!status) {
      status = createStatusSurface({ channelName: resolved.channelName });
    }
    return status;
  }
  async function logout() {
    const result = await purgeForWebId(config.webId);
    close();
    return result;
  }
  function close() {
    closed = true;
    listeners.clear();
    channel?.close();
    channel = void 0;
    warmer?.stop();
    warmer = void 0;
    notifications?.stop();
    notifications = void 0;
    status?.close();
    status = void 0;
    if (onControllerChange && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    }
    onControllerChange = void 0;
  }
  return {
    register,
    warm: warm2,
    close,
    logout,
    onUpdated,
    get status() {
      return getStatus();
    },
    config: resolved
  };
}

export { ANONYMOUS_SCOPE, CACHE_PREFIX, DB_PREFIX, DEFAULT_CACHE_NAME, DEFAULT_DB_NAME, DEFAULT_WARM_BUDGET, backoffDelay, cacheNameForWebId, containerChildren, createNotificationsClient, createOfflineClient, createStatusSurface, createWarmController, dbNameForWebId, deriveSeeds, discoverSubscriptionUrl, handleNotification, isScopeChange, onIdle, parseFrame, parseWacAllow, purgeForWebId, resolveBudget, resyncSweep, scopeFor, scopeHash, storageDescriptionFromLink, subscribe, typeIndexTargets, userCanRead, warm };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map