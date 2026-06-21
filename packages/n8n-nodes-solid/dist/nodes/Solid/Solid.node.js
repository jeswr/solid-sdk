// nodes/Solid/Solid.node.ts
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

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

// src/scope.ts
function normalizePodBase(base) {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] pod base URL must be a non-empty string");
  }
  let url;
  try {
    url = new URL(base.trim());
  } catch {
    throw new Error(`[n8n-nodes-solid] pod base URL must be absolute, got: ${base}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] pod base URL must be http(s), got protocol: ${url.protocol}`
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
function assertWithinPod(base, url) {
  const b = new URL(base);
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] target URL must be http(s), got protocol: ${u.protocol} (refused)`
    );
  }
  if (u.origin !== b.origin) {
    throw new Error(`[n8n-nodes-solid] target URL ${url} escapes pod origin ${b.origin} (refused)`);
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(`[n8n-nodes-solid] target URL ${url} escapes pod path ${b.pathname} (refused)`);
  }
}
function resolveTarget(base, target) {
  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] target must be a non-empty string");
  }
  const trimmed = target.trim();
  if (trimmed.startsWith("//")) {
    throw new Error(
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${target} (refused)`
    );
  }
  let resolved;
  try {
    const ref = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
    resolved = new URL(ref, base);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${target}`);
  }
  const url = resolved.toString();
  assertWithinPod(base, url);
  return { url, container: isContainerUrl(url) };
}
function isContainerUrl(url) {
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}

// src/container.ts
async function parseContainerListing(body, contentType2, containerUrl, base) {
  const dataset = await parseRdf(body, contentType2, { baseIRI: containerUrl });
  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) {
    return [];
  }
  const members = [];
  for (const resource of container.contains) {
    const absolute = new URL(resource.id, containerUrl).toString();
    try {
      assertWithinPod(base, absolute);
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

// nodes/Solid/operations.ts
var ACCEPT_RDF = "text/turtle, application/ld+json;q=0.9";
function httpError(op, url, res) {
  return new Error(`[n8n-nodes-solid] ${op} ${url} failed: HTTP ${res.statusCode}`);
}
function scopedTarget(podBaseUrl, target) {
  const base = normalizePodBase(podBaseUrl);
  return resolveTarget(base, target);
}
async function readResource(input) {
  const { url } = scopedTarget(input.podBaseUrl, input.target);
  const res = await input.request({ method: "GET", url, headers: {} });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("read", url, res);
  }
  return {
    url,
    body: res.body,
    contentType: res.headers["content-type"] ?? null,
    etag: res.headers.etag ?? null,
    statusCode: res.statusCode
  };
}
async function createResource(input) {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target);
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] create target ${url} is a container (trailing slash); use a resource path`
    );
  }
  const res = await input.request({
    method: "PUT",
    url,
    headers: {
      "content-type": input.contentType,
      "if-none-match": "*"
    },
    body: input.content
  });
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] create ${url} failed: resource already exists (412). Use Update to overwrite.`
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("create", url, res);
  }
  return { url, created: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}
async function updateResource(input) {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target);
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] update target ${url} is a container (trailing slash); use a resource path`
    );
  }
  const headers = { "content-type": input.contentType };
  if (input.ifMatch && input.ifMatch.trim().length > 0) {
    headers["if-match"] = input.ifMatch.trim();
  }
  const res = await input.request({ method: "PUT", url, headers, body: input.content });
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] update ${url} failed: precondition failed (412 \u2014 the resource changed since the supplied ETag).`
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("update", url, res);
  }
  return { url, updated: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}
async function deleteResource(input) {
  const { url } = scopedTarget(input.podBaseUrl, input.target);
  const res = await input.request({ method: "DELETE", url, headers: {} });
  if (res.statusCode === 404 || res.statusCode === 410) {
    return { url, deleted: false, notFound: true, statusCode: res.statusCode };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("delete", url, res);
  }
  return { url, deleted: true, statusCode: res.statusCode };
}
async function listContainer(input) {
  const base = normalizePodBase(input.podBaseUrl);
  const { url, container } = resolveTarget(base, input.target);
  const containerUrl = container ? url : resolveTarget(base, `${input.target.replace(/\/+$/, "")}/`).url;
  const res = await input.request({
    method: "GET",
    url: containerUrl,
    headers: { accept: ACCEPT_RDF }
  });
  if (res.statusCode === 404 || res.statusCode === 410) {
    return { members: [], containerUrl };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("list", containerUrl, res);
  }
  const members = await parseContainerListing(
    res.body,
    res.headers["content-type"] ?? null,
    containerUrl,
    base
  );
  return {
    containerUrl,
    members: members.map((m) => ({
      url: m.url,
      container: m.container,
      name: memberName(containerUrl, m.url)
    }))
  };
}
function memberName(containerUrl, memberUrl) {
  try {
    const c = new URL(containerUrl);
    const m = new URL(memberUrl);
    let path = m.pathname;
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    const rel = path.startsWith(c.pathname) ? path.slice(c.pathname.length) : path;
    const seg = rel.split("/").filter((s) => s.length > 0).pop() ?? rel;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  } catch {
    return memberUrl;
  }
}

// nodes/Solid/Solid.node.ts
var Solid = class {
  description = {
    displayName: "Solid",
    name: "solid",
    icon: "file:solid.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Read and write a Solid pod over LDP",
    defaults: { name: "Solid" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "solidApi", required: true }],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Resource",
            value: "resource",
            description: "A single LDP resource (a document)"
          },
          { name: "Container", value: "container", description: "An LDP container (a folder)" }
        ],
        default: "resource"
      },
      // --- Resource operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["resource"] } },
        options: [
          {
            name: "Read",
            value: "read",
            action: "Read a resource",
            description: "Get a resource's contents"
          },
          {
            name: "Create",
            value: "create",
            action: "Create a resource",
            description: "Create a new resource (fails if it already exists)"
          },
          {
            name: "Update",
            value: "update",
            action: "Update a resource",
            description: "Create or overwrite a resource"
          },
          {
            name: "Delete",
            value: "delete",
            action: "Delete a resource",
            description: "Delete a resource"
          }
        ],
        default: "read"
      },
      // --- Container operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["container"] } },
        options: [
          {
            name: "List",
            value: "list",
            action: "List a container",
            description: "List the direct members of a container (ldp:contains)"
          }
        ],
        default: "list"
      },
      // --- Target (all operations) ---
      {
        displayName: "Target",
        name: "target",
        type: "string",
        default: "",
        required: true,
        placeholder: "notes/today.ttl  (or an absolute URL under the pod base)",
        description: "The resource or container to act on. Either an absolute http(s) URL under the pod base, or a path relative to the pod base. Confined to the pod base \u2014 a target that escapes it is refused."
      },
      // --- Body (Create / Update) ---
      {
        displayName: "Content",
        name: "content",
        type: "string",
        typeOptions: { rows: 5 },
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description: "The resource body to write"
      },
      {
        displayName: "Content Type",
        name: "contentType",
        type: "string",
        default: "text/turtle",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description: "The Content-Type to store the body as (e.g. text/turtle, application/json, text/plain)"
      },
      // --- Conditional update (Update only) ---
      {
        displayName: "If-Match ETag",
        name: "ifMatch",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["update"] } },
        description: "Optional. An ETag (from a prior Read) for a conditional, lost-update-safe write. If set and the resource changed, the update fails with 412."
      }
    ]
  };
  async execute() {
    const items = this.getInputData();
    const out = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i);
        const operation = this.getNodeParameter("operation", i);
        const target = this.getNodeParameter("target", i);
        const credentials = await this.getCredentials("solidApi", i);
        const podBaseUrl = String(credentials.podBaseUrl ?? "");
        const request = async (req) => {
          const options = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            returnFullResponse: true,
            ignoreHttpStatusErrors: true,
            // Always treat the body as raw text — Solid resources are opaque
            // bytes/RDF; we never want n8n to JSON-parse the body.
            json: false,
            ...req.body !== void 0 ? { body: req.body } : {}
          };
          const response = await this.helpers.httpRequestWithAuthentication.call(
            this,
            "solidApi",
            options
          );
          return {
            statusCode: response.statusCode,
            headers: normalizeHeaders(response.headers),
            body: bodyToString(response.body)
          };
        };
        const base = { podBaseUrl, target, request };
        if (resource === "resource") {
          if (operation === "read") {
            pushOne(out, await readResource(base), i);
          } else if (operation === "create") {
            pushOne(
              out,
              await createResource({
                ...base,
                content: this.getNodeParameter("content", i, ""),
                contentType: this.getNodeParameter("contentType", i, "text/turtle")
              }),
              i
            );
          } else if (operation === "update") {
            pushOne(
              out,
              await updateResource({
                ...base,
                content: this.getNodeParameter("content", i, ""),
                contentType: this.getNodeParameter("contentType", i, "text/turtle"),
                ifMatch: this.getNodeParameter("ifMatch", i, "")
              }),
              i
            );
          } else if (operation === "delete") {
            pushOne(out, await deleteResource(base), i);
          } else {
            throw new NodeOperationError(
              this.getNode(),
              `Unknown resource operation: ${operation}`,
              {
                itemIndex: i
              }
            );
          }
        } else if (resource === "container") {
          if (operation === "list") {
            const { members, containerUrl } = await listContainer(base);
            if (members.length === 0) {
              pushOne(out, { containerUrl, members: [] }, i);
            } else {
              for (const m of members) {
                pushOne(out, m, i);
              }
            }
          } else {
            throw new NodeOperationError(
              this.getNode(),
              `Unknown container operation: ${operation}`,
              {
                itemIndex: i
              }
            );
          }
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
            itemIndex: i
          });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: error.message },
            pairedItem: { item: i }
          });
          continue;
        }
        if (error instanceof NodeOperationError) {
          throw error;
        }
        throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
      }
    }
    return [out];
  }
};
function pushOne(out, json, itemIndex) {
  out.push({ json, pairedItem: { item: itemIndex } });
}
function normalizeHeaders(headers) {
  const out = {};
  if (!headers) {
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}
function bodyToString(body) {
  if (typeof body === "string") {
    return body;
  }
  if (body == null) {
    return "";
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  return String(body);
}
export {
  Solid
};
//# sourceMappingURL=Solid.node.js.map
