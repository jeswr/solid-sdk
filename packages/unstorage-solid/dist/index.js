// src/index.ts
import { defineDriver } from "unstorage";

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}

// src/container.ts
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";

// src/keys.ts
var TRAVERSAL_SEGMENTS = /* @__PURE__ */ new Set([".", ".."]);
function urlSegmentToKeySegment(urlSegment) {
  const decoded = decodeURIComponent(urlSegment);
  return decoded.replace(/%/g, "%25").replace(/:/g, "%3A").replace(/\//g, "%2F").replace(/\\/g, "%5C");
}
function normalizeBase(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`[unstorage-solid] \`base\` must be an absolute URL, got: ${base}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[unstorage-solid] \`base\` must be an http(s) URL, got protocol: ${url.protocol}`
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
function keyToEncodedSegments(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("[unstorage-solid] key must be a non-empty string");
  }
  if (key.includes("/") || key.includes("\\")) {
    throw new Error(`[unstorage-solid] key must not contain \`/\` or \`\\\`: ${key}`);
  }
  const rawSegments = key.split(":");
  const encoded = [];
  for (const seg of rawSegments) {
    if (seg.length === 0) {
      throw new Error(
        `[unstorage-solid] key has an empty segment (leading/trailing/double \`:\`): ${key}`
      );
    }
    if (TRAVERSAL_SEGMENTS.has(seg)) {
      throw new Error(`[unstorage-solid] key segment \`${seg}\` is not allowed (path traversal)`);
    }
    let decoded;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      throw new Error(`[unstorage-solid] key segment is not valid URI-encodable text: ${seg}`);
    }
    if (TRAVERSAL_SEGMENTS.has(decoded)) {
      throw new Error(
        `[unstorage-solid] key segment decodes to \`${decoded}\` (path traversal): ${seg}`
      );
    }
    encoded.push(encodeURIComponent(decoded));
  }
  return encoded;
}
function keyToUrl(base, key) {
  const segments = keyToEncodedSegments(key);
  const relative = segments.join("/");
  const resolved = new URL(relative, base);
  assertWithinBase(base, resolved.toString());
  return resolved.toString();
}
function keyToContainerUrl(base, key) {
  return `${keyToUrl(base, key)}/`;
}
function assertWithinBase(base, url) {
  const b = new URL(base);
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[unstorage-solid] resolved URL is invalid: ${url}`);
  }
  if (u.origin !== b.origin) {
    throw new Error(
      `[unstorage-solid] resolved URL ${url} escapes base origin ${b.origin} (refused)`
    );
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(
      `[unstorage-solid] resolved URL ${url} escapes base path ${b.pathname} (refused)`
    );
  }
}
function urlToKey(base, memberUrl) {
  const b = new URL(base);
  let u;
  try {
    u = new URL(memberUrl, base);
  } catch {
    return void 0;
  }
  if (u.origin !== b.origin) {
    return void 0;
  }
  let path = u.pathname;
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (!path.startsWith(b.pathname)) {
    return void 0;
  }
  const relative = path.slice(b.pathname.length);
  if (relative.length === 0) {
    return void 0;
  }
  const segments = relative.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return void 0;
  }
  try {
    return segments.map((s) => urlSegmentToKeySegment(s)).join(":");
  } catch {
    return void 0;
  }
}
function isContainerUrl(memberUrl) {
  try {
    return new URL(memberUrl).pathname.endsWith("/");
  } catch {
    return memberUrl.endsWith("/");
  }
}

// src/container.ts
async function listContainer(containerUrl, base, fetchImpl) {
  const res = await fetchImpl(containerUrl, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" }
  });
  if (res.status === 404 || res.status === 410) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `[unstorage-solid] listing container ${containerUrl} failed: ${res.status} ${res.statusText}`
    );
  }
  const body = await res.text();
  const dataset = await parseRdf(body, res.headers.get("content-type"), {
    baseIRI: containerUrl
  });
  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) {
    return [];
  }
  const members = [];
  for (const resource of container.contains) {
    const absolute = new URL(resource.id, containerUrl).toString();
    try {
      assertWithinBase(base, absolute);
    } catch {
      continue;
    }
    if (absolute === containerUrl) {
      continue;
    }
    members.push({ url: absolute, container: isContainerUrl(absolute) });
  }
  return members;
}

// src/scope.ts
var SolidRedirectError = class extends Error {
  url;
  status;
  constructor(url, status) {
    super(
      `[unstorage-solid] refusing to follow a redirect (status ${status}) from ${url} (a redirected pod request could forward credentials off-origin \u2014 SSRF/credential-leak guard)`
    );
    this.name = "SolidRedirectError";
    this.url = url;
    this.status = status;
  }
};
function urlOf(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
function createScopedFetch(base, fetchImpl) {
  const scoped = async (input, init) => {
    const url = urlOf(input);
    assertWithinBase(base, url);
    const res = await fetchImpl(url, { ...init, redirect: "manual" });
    const isOpaqueRedirect = res.type === "opaqueredirect";
    const isReadableRedirect = res.status >= 300 && res.status < 400 && res.status !== 304 && res.headers.has("location");
    if (isOpaqueRedirect || isReadableRedirect) {
      throw new SolidRedirectError(url, res.status);
    }
    return res;
  };
  return scoped;
}

// src/watch.ts
import { DataFactory as DataFactory2 } from "n3";
var STORAGE_DESCRIPTION_REL = "http://www.w3.org/ns/solid/terms#storageDescription";
var WEBSOCKET_CHANNEL_2023 = "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023";
var NOTIFY_SUBSCRIPTION = "http://www.w3.org/ns/solid/notifications#subscription";
var NOTIFY_CHANNEL_TYPE = "http://www.w3.org/ns/solid/notifications#channelType";
var NOTIFICATIONS_CONTEXT = "https://www.w3.org/ns/solid/notifications-context/v1";
function sameOriginUrl(base, raw) {
  let resolved;
  try {
    resolved = new URL(raw, base);
  } catch {
    return void 0;
  }
  if (resolved.origin !== new URL(base).origin) {
    return void 0;
  }
  return resolved.toString();
}
function parseLinkHeader(value) {
  const out = /* @__PURE__ */ new Map();
  if (!value) {
    return out;
  }
  for (const part of value.split(",")) {
    const match = part.match(/<([^>]*)>\s*;\s*(.*)/);
    if (!match) {
      continue;
    }
    const url = match[1];
    const params = match[2];
    if (!url || !params) {
      continue;
    }
    const relMatch = params.match(/rel\s*=\s*"?([^";]+)"?/i);
    if (!relMatch?.[1]) {
      continue;
    }
    for (const rel of relMatch[1].trim().split(/\s+/)) {
      if (!out.has(rel)) {
        out.set(rel, url);
      }
    }
  }
  return out;
}
async function discoverSubscriptionService(base, fetchImpl) {
  const head = await fetchImpl(base, { method: "HEAD" });
  const links = parseLinkHeader(head.headers.get("link"));
  const descUrlRaw = links.get(STORAGE_DESCRIPTION_REL) ?? links.get("describedby");
  if (!descUrlRaw) {
    return void 0;
  }
  const descUrl = sameOriginUrl(base, descUrlRaw);
  if (!descUrl) {
    return void 0;
  }
  const descRes = await fetchImpl(descUrl, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" }
  });
  if (!descRes.ok) {
    return void 0;
  }
  const body = await descRes.text();
  const dataset = await parseRdf(body, descRes.headers.get("content-type"), {
    baseIRI: descUrl
  });
  const channelTypeQuads = [
    ...dataset.match(null, DataFactory2.namedNode(NOTIFY_CHANNEL_TYPE), null)
  ];
  for (const q of channelTypeQuads) {
    if (q.object.value === WEBSOCKET_CHANNEL_2023 && q.subject.termType === "NamedNode") {
      const safe = sameOriginUrl(base, q.subject.value);
      if (safe) {
        return safe;
      }
    }
  }
  const subscriptionQuads = [
    ...dataset.match(null, DataFactory2.namedNode(NOTIFY_SUBSCRIPTION), null)
  ];
  for (const q of subscriptionQuads) {
    if (q.object.termType === "NamedNode") {
      const safe = sameOriginUrl(base, q.object.value);
      if (safe) {
        return safe;
      }
    }
  }
  return void 0;
}
async function startWatch(options) {
  const { base, fetch: fetchImpl, callback, wsFactory, onDegrade } = options;
  const degrade = (reason) => {
    onDegrade?.(reason);
    return { unwatch: () => {
    } };
  };
  const makeSocket = wsFactory ?? (typeof globalThis.WebSocket !== "undefined" ? (url) => new globalThis.WebSocket(url) : void 0);
  if (!makeSocket) {
    return degrade("no WebSocket implementation available (pass wsFactory or run on Node >= 22)");
  }
  let serviceUrl;
  try {
    serviceUrl = await discoverSubscriptionService(base, fetchImpl);
  } catch (err) {
    return degrade(`notification discovery failed: ${String(err)}`);
  }
  if (!serviceUrl) {
    return degrade("server advertises no WebSocketChannel2023 subscription service");
  }
  let receiveFrom;
  try {
    const subRes = await fetchImpl(serviceUrl, {
      method: "POST",
      headers: { "content-type": "application/ld+json" },
      body: JSON.stringify({
        "@context": NOTIFICATIONS_CONTEXT,
        type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
        topic: base
      })
    });
    if (!subRes.ok) {
      return degrade(`subscribe failed: ${subRes.status} ${subRes.statusText}`);
    }
    const channel = await subRes.json();
    if (typeof channel.receiveFrom !== "string") {
      return degrade("subscription response had no `receiveFrom` URL");
    }
    receiveFrom = channel.receiveFrom;
  } catch (err) {
    return degrade(`subscribe request failed: ${String(err)}`);
  }
  let socket;
  try {
    socket = makeSocket(receiveFrom);
  } catch (err) {
    return degrade(`opening notification socket failed: ${String(err)}`);
  }
  socket.addEventListener("message", (ev) => {
    handleNotification(ev.data, base, callback, onDegrade);
  });
  socket.addEventListener("error", () => {
  });
  socket.addEventListener("close", () => {
  });
  return {
    unwatch: () => {
      try {
        socket.close();
      } catch {
      }
    }
  };
}
function handleNotification(data, base, callback, onDegrade) {
  let text;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof Uint8Array) {
    text = new TextDecoder().decode(data);
  } else {
    onDegrade?.("notification payload was neither string nor bytes; ignored");
    return;
  }
  let activity;
  try {
    activity = JSON.parse(text);
  } catch {
    onDegrade?.("notification payload was not valid JSON; ignored");
    return;
  }
  const objectUrl = extractObjectUrl(activity.object);
  if (!objectUrl) {
    return;
  }
  const key = urlToKey(base, objectUrl);
  if (!key) {
    return;
  }
  const event = isRemoval(activity.type) ? "remove" : "update";
  try {
    callback(event, key);
  } catch {
  }
}
function extractObjectUrl(object) {
  if (typeof object === "string") {
    return object;
  }
  if (object && typeof object === "object") {
    const o = object;
    if (typeof o.id === "string") {
      return o.id;
    }
    if (typeof o["@id"] === "string") {
      return o["@id"];
    }
  }
  return void 0;
}
function isRemoval(type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (typeof t !== "string") {
      return false;
    }
    return /(?:^|[#/])(Delete|Remove)$/.test(t);
  });
}

// src/index.ts
var DRIVER_NAME = "solid";
var SolidPreconditionFailedError = class extends Error {
  url;
  status;
  constructor(url, status) {
    super(`[unstorage-solid] precondition failed (If-Match) for ${url}: ${status}`);
    this.name = "SolidPreconditionFailedError";
    this.url = url;
    this.status = status;
  }
};
var SolidHttpError = class extends Error {
  url;
  status;
  constructor(method, url, status, statusText) {
    super(`[unstorage-solid] ${method} ${url} failed: ${status} ${statusText}`);
    this.name = "SolidHttpError";
    this.url = url;
    this.status = status;
  }
};
function buildHeaders(driverHeaders, txHeaders, extra) {
  return { ...driverHeaders, ...extra, ...txHeaders };
}
function asTx(opts) {
  return opts && typeof opts === "object" ? opts : {};
}
function relativePrefixKey(base_) {
  if (typeof base_ !== "string" || base_.length === 0) {
    return void 0;
  }
  const stripped = base_.endsWith(":") ? base_.slice(0, -1) : base_;
  return stripped.length > 0 ? stripped : void 0;
}
var solidDriver = defineDriver((options) => {
  if (!options || typeof options.base !== "string" || options.base.length === 0) {
    throw new Error("[unstorage-solid] `base` option is required");
  }
  const base = normalizeBase(options.base);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("[unstorage-solid] no `fetch` available (pass `fetch` in options)");
  }
  const defaultContentType = options.defaultContentType ?? "text/plain; charset=utf-8";
  const watchEnabled = options.watch === true;
  const activeWatches = /* @__PURE__ */ new Set();
  const doFetch = createScopedFetch(base, fetchImpl);
  const ensureParentContainers = async (resourceUrl, headers) => {
    const u = new URL(resourceUrl);
    const baseUrl = new URL(base);
    const rel = u.pathname.slice(baseUrl.pathname.length);
    const parts = rel.split("/").filter((s) => s.length > 0);
    parts.pop();
    let current = base;
    for (const part of parts) {
      current = `${current}${part}/`;
      const res = await doFetch(current, {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "text/turtle",
          link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
        }
      });
      if (!res.ok && res.status !== 409 && res.status !== 412 && res.status !== 405) {
        throw new SolidHttpError("PUT", current, res.status, res.statusText);
      }
    }
  };
  const putResource = async (url, body, contentType2, tx) => {
    const headers = buildHeaders(options.headers, tx.headers, { "content-type": contentType2 });
    if (tx.etag) {
      headers["if-match"] = tx.etag;
    }
    let res = await doFetch(url, { method: "PUT", headers, body });
    if (res.status === 412 || res.status === 428) {
      throw new SolidPreconditionFailedError(url, res.status);
    }
    if ((res.status === 404 || res.status === 409) && !tx.etag) {
      await ensureParentContainers(url, buildHeaders(options.headers, tx.headers));
      res = await doFetch(url, { method: "PUT", headers, body });
    }
    if (!res.ok) {
      throw new SolidHttpError("PUT", url, res.status, res.statusText);
    }
  };
  const driver = {
    name: DRIVER_NAME,
    options,
    flags: { maxDepth: true },
    async hasItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      let res = await doFetch(url, { method: "HEAD", headers });
      if (res.status === 405) {
        res = await doFetch(url, { method: "GET", headers });
      }
      if (res.status === 404 || res.status === 410) {
        return false;
      }
      if (!res.ok) {
        throw new SolidHttpError("HEAD", url, res.status, res.statusText);
      }
      return true;
    },
    async getItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      const res = await doFetch(url, { method: "GET", headers });
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("GET", url, res.status, res.statusText);
      }
      return await res.text();
    },
    async getItemRaw(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers, {
        accept: "application/octet-stream"
      });
      const res = await doFetch(url, { method: "GET", headers });
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("GET", url, res.status, res.statusText);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    },
    async setItem(key, value, opts) {
      const tx = asTx(opts);
      const url = keyToUrl(base, key);
      await putResource(url, value, tx.contentType ?? defaultContentType, tx);
    },
    async setItemRaw(key, value, opts) {
      const tx = asTx(opts);
      const url = keyToUrl(base, key);
      const body = toBodyInit(value);
      await putResource(url, body, tx.contentType ?? "application/octet-stream", tx);
    },
    async removeItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      const res = await doFetch(url, { method: "DELETE", headers });
      if (res.ok || res.status === 404 || res.status === 410) {
        return;
      }
      throw new SolidHttpError("DELETE", url, res.status, res.statusText);
    },
    async getMeta(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      let res = await doFetch(url, { method: "HEAD", headers });
      if (res.status === 405) {
        res = await doFetch(url, { method: "GET", headers });
      }
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("HEAD", url, res.status, res.statusText);
      }
      const meta = { status: res.status };
      const lastModified = res.headers.get("last-modified");
      if (lastModified) {
        const d = new Date(lastModified);
        if (!Number.isNaN(d.getTime())) {
          meta.mtime = d;
        }
      }
      const length = res.headers.get("content-length");
      if (length !== null && length !== "") {
        const n = Number(length);
        if (Number.isFinite(n)) {
          meta.size = n;
        }
      }
      const etag = res.headers.get("etag");
      if (etag) {
        meta.etag = etag;
      }
      const contentType2 = res.headers.get("content-type");
      if (contentType2) {
        meta.mimeType = contentType2;
      }
      return meta;
    },
    async getKeys(base_, opts) {
      const maxDepth = typeof opts?.maxDepth === "number" ? opts.maxDepth : Number.POSITIVE_INFINITY;
      const prefix = relativePrefixKey(base_);
      const startContainer = prefix ? keyToContainerUrl(base, prefix) : base;
      const keys = [];
      const txHeaders = asTx(opts).headers;
      await collectKeys(
        startContainer,
        base,
        doFetch,
        txHeaders,
        options.headers,
        0,
        maxDepth,
        keys
      );
      return keys;
    },
    async clear(base_, opts) {
      const prefix = relativePrefixKey(base_);
      const startContainer = prefix ? keyToContainerUrl(base, prefix) : base;
      const txHeaders = asTx(opts).headers;
      const headers = buildHeaders(options.headers, txHeaders);
      await clearContainer(startContainer, base, doFetch, headers, prefix !== void 0);
    },
    async watch(callback) {
      if (!watchEnabled) {
        options.onWatchDegrade?.("watch disabled (set `watch: true` in driver options)");
        return () => {
        };
      }
      const baseOrigin = new URL(base).origin;
      const isSameOrigin = (input) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        try {
          return new URL(raw, base).origin === baseOrigin;
        } catch {
          return false;
        }
      };
      const watchFetch = (input, init) => fetchImpl(input, {
        ...init,
        headers: isSameOrigin(input) ? { ...options.headers, ...init?.headers } : init?.headers ?? {}
      });
      const startOpts = {
        base,
        fetch: watchFetch,
        callback,
        ...options.wsFactory ? { wsFactory: options.wsFactory } : {},
        ...options.onWatchDegrade ? { onDegrade: options.onWatchDegrade } : {}
      };
      const active = await startWatch(startOpts);
      activeWatches.add(active);
      return () => {
        active.unwatch();
        activeWatches.delete(active);
      };
    },
    dispose() {
      for (const active of activeWatches) {
        active.unwatch();
      }
      activeWatches.clear();
    }
  };
  return driver;
});
async function collectKeys(containerUrl, base, fetchImpl, txHeaders, driverHeaders, depth, maxDepth, out) {
  const headers = buildHeaders(driverHeaders, txHeaders);
  const members = await listContainerWithHeaders(containerUrl, base, fetchImpl, headers);
  if (members === null) {
    return;
  }
  for (const member of members) {
    if (member.container) {
      if (depth + 1 <= maxDepth) {
        await collectKeys(
          member.url,
          base,
          fetchImpl,
          txHeaders,
          driverHeaders,
          depth + 1,
          maxDepth,
          out
        );
      }
    } else {
      const key = urlToKey(base, member.url);
      if (key) {
        out.push(key);
      }
    }
  }
}
async function clearContainer(containerUrl, base, fetchImpl, headers, deleteSelf) {
  const members = await listContainerWithHeaders(containerUrl, base, fetchImpl, headers);
  if (members !== null) {
    for (const member of members) {
      if (member.container) {
        await clearContainer(member.url, base, fetchImpl, headers, true);
      } else {
        assertWithinBase(base, member.url);
        const res = await fetchImpl(member.url, { method: "DELETE", headers });
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new SolidHttpError("DELETE", member.url, res.status, res.statusText);
        }
      }
    }
  }
  if (deleteSelf) {
    assertWithinBase(base, containerUrl);
    const res = await fetchImpl(containerUrl, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new SolidHttpError("DELETE", containerUrl, res.status, res.statusText);
    }
  }
}
async function listContainerWithHeaders(containerUrl, base, fetchImpl, headers) {
  const wrapped = (input, init) => fetchImpl(input, { ...init, headers: { ...headers, ...init?.headers } });
  return listContainer(containerUrl, base, wrapped);
}
function toBodyInit(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.slice().buffer;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}
var index_default = solidDriver;
export {
  SolidHttpError,
  SolidPreconditionFailedError,
  SolidRedirectError,
  index_default as default
};
//# sourceMappingURL=index.js.map
