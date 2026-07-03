// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Solid node's per-operation logic, factored OUT of the n8n `INodeType`
// wiring so it is unit-testable against a fake `request` function (a Map-backed
// fake pod) WITHOUT constructing an `IExecuteFunctions`. The node's `execute`
// method (Solid.node.ts) resolves n8n parameters + credentials, then calls these.
//
// Transport: the caller supplies a `request` callback that performs ONE HTTP
// request. In the node this is n8n's `httpRequestWithAuthentication` (n8n injects
// the Bearer header and owns the transport). The token never reaches this module.

import { parseContainerListing } from "../../src/container.js";
import {
  isContainerUrl,
  normalizePodBase,
  type ResolvedTarget,
  redactUserinfo,
  resolveTarget,
} from "../../src/scope.js";

/** The operations the node supports, namespaced by resource. */
export type SolidResource = "resource" | "container";
export type ResourceOperation = "read" | "create" | "update" | "delete";
export type ContainerOperation = "list";

/** Minimal HTTP response shape the operations need from the transport. */
export interface SolidHttpResponse {
  /** HTTP status code. */
  statusCode: number;
  /** Response headers, lower-cased keys. */
  headers: Record<string, string | undefined>;
  /** Response body as text (the transport must return the body as a string). */
  body: string;
}

/** Minimal HTTP request the operations issue against the pod. */
export interface SolidHttpRequest {
  method: "GET" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  /** Request body (PUT only). */
  body?: string;
}

/**
 * The transport callback: perform one authenticated request and return the
 * response. MUST NOT throw on a non-2xx status — it returns the status so the
 * operations can map it to a Solid-aware error/result. (n8n's httpRequest is
 * configured with `returnFullResponse: true` + `ignoreHttpStatusErrors: true` to
 * satisfy this; see Solid.node.ts.)
 *
 * SECURITY CONTRACT: the transport MUST NOT follow redirects — it returns the
 * 3xx response as-is so the operations can REFUSE it (assertNotRedirect). A
 * transport that transparently follows a redirect on an authenticated request
 * can be steered off-pod by a poisoned in-pod resource, forwarding the Bearer
 * token to an attacker origin (in the node this is enforced with
 * `disableFollowRedirect: true`; see Solid.node.ts).
 */
export type SolidTransport = (req: SolidHttpRequest) => Promise<SolidHttpResponse>;

/** Inputs shared by every operation, already validated/normalised. */
export interface SolidOperationInput {
  /** The configured pod base URL (raw, from the credential). */
  podBaseUrl: string;
  /** The workflow-supplied target (absolute URL or base-relative path). */
  target: string;
  /** The transport callback. */
  request: SolidTransport;
}

/** Read/Create/Update extra inputs. */
export interface ResourceWriteInput extends SolidOperationInput {
  /** The resource body to write (Create/Update). */
  content: string;
  /** The Content-Type to store (Create/Update). */
  contentType: string;
}

/** A normalised result row returned to n8n as item JSON. */
export interface SolidResult {
  [key: string]: unknown;
}

const ACCEPT_RDF = "text/turtle, application/ld+json;q=0.9";

/** Build a Solid-aware Error for a non-2xx response on `op` at `url`. */
function httpError(op: string, url: string, res: SolidHttpResponse): Error {
  return new Error(`[n8n-nodes-solid] ${op} ${url} failed: HTTP ${res.statusCode}`);
}

/**
 * REFUSE any redirect answer, fail-closed (security guard — see the wave-3
 * review). The transport never follows redirects (`disableFollowRedirect`), so a
 * 3xx surfaces here. Following one on an authenticated pod request would let a
 * poisoned in-pod resource `302` the request off-pod WITH the Bearer header
 * attached (n8n's axios transport forwards credentials on cross-origin redirects
 * by default) — a token-exfiltration vector; a redirected PUT could additionally
 * steer a WRITE outside the pod. The `Location` is echoed userinfo-redacted for
 * debuggability (this message surfaces as item JSON under `continueOnFail`).
 */
function assertNotRedirect(op: string, url: string, res: SolidHttpResponse): void {
  if (res.statusCode >= 300 && res.statusCode < 400) {
    const location = res.headers.location;
    const to = location ? ` to ${redactUserinfo(location)}` : "";
    throw new Error(
      `[n8n-nodes-solid] ${op} ${url} answered a redirect (HTTP ${res.statusCode}${to}) — refused: ` +
        "an authenticated pod request never follows redirects (token-leak / pod-escape guard)",
    );
  }
}

/**
 * Resolve + scope-guard a target against the pod base, returning the validated
 * absolute URL. Throws (fail-closed) if the target escapes the pod.
 */
export function scopedTarget(podBaseUrl: string, target: string): ResolvedTarget {
  const base = normalizePodBase(podBaseUrl);
  return resolveTarget(base, target);
}

/** Resource -> Read: GET the resource, return its body + content-type + etag. */
export async function readResource(input: SolidOperationInput): Promise<SolidResult> {
  const { url } = scopedTarget(input.podBaseUrl, input.target);
  const res = await input.request({ method: "GET", url, headers: {} });
  assertNotRedirect("read", url, res);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("read", url, res);
  }
  return {
    url,
    body: res.body,
    contentType: res.headers["content-type"] ?? null,
    etag: res.headers.etag ?? null,
    statusCode: res.statusCode,
  };
}

/**
 * Resource -> Create: PUT with `If-None-Match: *` so it fails (412) if the
 * resource already exists — Create never silently overwrites.
 */
export async function createResource(input: ResourceWriteInput): Promise<SolidResult> {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target);
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] create target ${url} is a container (trailing slash); use a resource path`,
    );
  }
  const res = await input.request({
    method: "PUT",
    url,
    headers: {
      "content-type": input.contentType,
      "if-none-match": "*",
    },
    body: input.content,
  });
  assertNotRedirect("create", url, res);
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] create ${url} failed: resource already exists (412). Use Update to overwrite.`,
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("create", url, res);
  }
  return { url, created: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}

/**
 * Resource -> Update: PUT, overwriting (or creating) the resource. If an
 * `ifMatch` etag is supplied, send `If-Match` for a conditional (lost-update-safe)
 * write.
 */
export async function updateResource(
  input: ResourceWriteInput & { ifMatch?: string },
): Promise<SolidResult> {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target);
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] update target ${url} is a container (trailing slash); use a resource path`,
    );
  }
  const headers: Record<string, string> = { "content-type": input.contentType };
  if (input.ifMatch && input.ifMatch.trim().length > 0) {
    headers["if-match"] = input.ifMatch.trim();
  }
  const res = await input.request({ method: "PUT", url, headers, body: input.content });
  assertNotRedirect("update", url, res);
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] update ${url} failed: precondition failed (412 — the resource changed since the supplied ETag).`,
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("update", url, res);
  }
  return { url, updated: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}

/** Resource -> Delete: DELETE the resource. A 404 is reported, not thrown. */
export async function deleteResource(input: SolidOperationInput): Promise<SolidResult> {
  const { url } = scopedTarget(input.podBaseUrl, input.target);
  const res = await input.request({ method: "DELETE", url, headers: {} });
  assertNotRedirect("delete", url, res);
  if (res.statusCode === 404 || res.statusCode === 410) {
    return { url, deleted: false, notFound: true, statusCode: res.statusCode };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("delete", url, res);
  }
  return { url, deleted: true, statusCode: res.statusCode };
}

/**
 * Container -> List: GET the container and parse its `ldp:contains` members via
 * `@jeswr/fetch-rdf` + `@solid/object`. Returns one result per member.
 */
export async function listContainer(
  input: SolidOperationInput,
): Promise<{ members: SolidResult[]; containerUrl: string }> {
  const base = normalizePodBase(input.podBaseUrl);
  const { url, container } = resolveTarget(base, input.target);
  // List only makes sense on a container; if the target lacks a trailing slash,
  // treat it as a container address (append `/`) and re-validate under the pod.
  const containerUrl = container
    ? url
    : resolveTarget(base, `${input.target.replace(/\/+$/, "")}/`).url;
  const res = await input.request({
    method: "GET",
    url: containerUrl,
    headers: { accept: ACCEPT_RDF },
  });
  assertNotRedirect("list", containerUrl, res);
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
    base,
  );
  return {
    containerUrl,
    members: members.map((m) => ({
      url: m.url,
      container: m.container,
      name: memberName(containerUrl, m.url),
    })),
  };
}

/** The last path segment of a member URL, relative to its container, decoded. */
function memberName(containerUrl: string, memberUrl: string): string {
  try {
    const c = new URL(containerUrl);
    const m = new URL(memberUrl);
    let path = m.pathname;
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    const rel = path.startsWith(c.pathname) ? path.slice(c.pathname.length) : path;
    const seg =
      rel
        .split("/")
        .filter((s) => s.length > 0)
        .pop() ?? rel;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  } catch {
    return memberUrl;
  }
}

// Re-export for the node + tests.
export { isContainerUrl };
