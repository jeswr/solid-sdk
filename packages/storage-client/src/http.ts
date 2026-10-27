// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// HTTP plumbing shared by the network backends: scope-checked requests, network-error mapping,
// Link / WAC-Allow parsing and ReadResult construction (ADR-003 §2, §6, §7). Not exported.
import { assertWithinPodScope, redactUserinfo } from "@jeswr/guarded-fetch";
import { parseLinkHeaders, parseWacAllow } from "@jeswr/storage-capabilities";
import { StorageError, storageErrorFrom } from "./errors.js";
import { throwIfAborted } from "./internal.js";
import type { AuthFetch, Body, LinkTarget, ReadResult, ResourceKind } from "./types.js";

/**
 * `value` with any userinfo removed. Parse first so every authority spelling (backslashes, mixed
 * slashes) is normalised to `//` before redaction; unparseable text has its backslashes folded.
 */
function redacted(value: unknown): string {
  const text = String(value);
  return redactUserinfo(URL.canParse(text) ? new URL(text).href : text.replaceAll("\\", "/"));
}

/**
 * Fail closed before any request: `url` must lie within the storage `root` (guarded-fetch
 * pod-scope rules: same origin, path boundary, no credentials, no encoded delimiters).
 * Returns the canonical URL, which is the one fetched.
 */
export function scoped(root: string, method: string, url: string): string {
  try {
    // Absolute URLs only: guarded-fetch would resolve a relative reference against the root.
    if (typeof url !== "string" || !URL.canParse(url)) throw new TypeError("not an absolute URL");
    const canonical = assertWithinPodScope(root, url);
    // The slashless alias of the root is the root (guarded-fetch accepts both spellings), with
    // any query or fragment kept, so parents and listings never step above the storage.
    // The suffix is sliced from the href, not rebuilt from URL.search/hash, which report an
    // empty `?` or `#` as "" and would silently drop it.
    const parsed = new URL(canonical);
    parsed.search = "";
    parsed.hash = "";
    const suffix = canonical.slice(parsed.href.length);
    return `${parsed.href}/` === root ? `${root}${suffix}` : canonical;
  } catch (cause) {
    // Never echo embedded credentials (guarded-fetch redacts its own messages too).
    const shown = redacted(url);
    throw new StorageError("scope", {
      method,
      url: shown,
      cause,
      message: `${method} ${shown} is outside the storage ${redacted(root)}`,
    });
  }
}

/**
 * Send one request. Redirects are never followed (a 3xx surfaces as `invalid-response`).
 * Transport failures become `network` (retryable), aborts become non-retryable `network`.
 */
export async function send(
  fetch: AuthFetch,
  method: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  body?: Body,
): Promise<Response> {
  throwIfAborted(method, url, signal);
  try {
    return await fetch(url, {
      method,
      headers,
      redirect: "manual",
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : { body: body as NonNullable<Parameters<AuthFetch>[1]>["body"] }),
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    });
  } catch (cause) {
    throwIfAborted(method, url, signal);
    throw new StorageError("network", {
      method,
      url,
      cause,
      retryable: !(body instanceof ReadableStream),
      message: `${method} ${url} failed: network`,
    });
  }
}

/** Release an unread body without waiting (a tee'd body's cancel can stay pending). */
export function discard(body: ReadableStream<Uint8Array> | null): void {
  body?.cancel().catch(() => undefined);
}

/**
 * Throw the mapped StorageError for a non-success response. An abort while its error body is
 * read becomes the non-retryable abort error, never a retryable server error.
 */
export async function failed(
  method: string,
  url: string,
  response: Response,
  signal?: AbortSignal,
): Promise<never> {
  const error = await storageErrorFrom(method, url, response);
  throwIfAborted(method, url, signal);
  throw error;
}

/** Lower-cased media type of a Content-Type value, without parameters, or null. */
export function mediaTypeOf(value: string | null): string | null {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

/** `rel → targets` for links whose context is the response URL (anchored links are ignored). */
export function linksOf(response: Response, url: string): Map<string, LinkTarget[]> {
  const links = new Map<string, LinkTarget[]>();
  for (const link of parseLinkHeaders(response.headers.get("link"), url)) {
    if (link.context !== url) continue;
    const params: Record<string, string> = {};
    for (const [name, value] of link.parameters) {
      if (name !== "rel" && name !== "anchor" && !(name in params)) params[name] = value;
    }
    for (const rel of link.rel) {
      links.set(rel, [...(links.get(rel) ?? []), { target: link.target, params }]);
    }
  }
  return links;
}

/** The caller's WAC-Allow `user` permissions, or null when the header is absent or malformed. */
export function allowOf(response: Response): ReadResult["allow"] {
  const value = response.headers.get("wac-allow");
  const parsed = value === null ? undefined : parseWacAllow(value);
  if (!parsed) return null;
  const has = (mode: "read" | "write" | "append" | "control") => parsed.user.includes(mode);
  return { read: has("read"), write: has("write"), append: has("append"), control: has("control") };
}

/** A valid HTTP-date, or null. */
export function dateOf(value: string | null): Date | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export interface ReadShape {
  status: 200 | 206 | 304;
  kind: ResourceKind;
  parent: string | null;
  metadataUrl: string | null;
  allow: ReadResult["allow"];
  links: Map<string, LinkTarget[]>;
  /** False for HEAD and 304: no body. */
  withBody: boolean;
}

/** A failed response body as a StorageError: `network`, non-retryable when `signal` aborted. */
function bodyFailure(url: string, signal: AbortSignal | undefined, cause: unknown): StorageError {
  try {
    throwIfAborted("GET", url, signal);
  } catch (aborted) {
    return aborted as StorageError;
  }
  return new StorageError("network", {
    method: "GET",
    url,
    cause,
    message: `GET ${url}: the response body failed`,
  });
}

/** Re-expose a response body so that transport failures surface as StorageError, not TypeError. */
function mappedBody(
  body: ReadableStream<Uint8Array>,
  url: string,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        } catch (cause) {
          controller.error(bodyFailure(url, signal, cause));
        }
      },
      cancel: (reason) => reader.cancel(reason),
    },
    // Pull only on demand, so a failure is classified (abort or transport) when it is read.
    { highWaterMark: 0 },
  );
}

async function collect(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (body) {
    const reader = body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      chunks.push(chunk.value);
      size += chunk.value.byteLength;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Build a ReadResult over a response. `body` is the live stream (its failures are `network`
 * StorageErrors); `bytes()/text()/blob()` buffer that same stream once and return copies, so use
 * either the stream or the buffered accessors, not both.
 */
export function readResultFrom(
  response: Response,
  url: string,
  shape: ReadShape,
  signal?: AbortSignal,
): ReadResult {
  const contentType = response.headers.get("content-type");
  if (!shape.withBody) discard(response.body);
  const body = shape.withBody && response.body ? mappedBody(response.body, url, signal) : null;
  let buffered: Promise<Uint8Array> | undefined;
  const bytes = async () => {
    buffered ??= collect(body);
    return (await buffered).slice();
  };
  return {
    url,
    status: shape.status,
    etag: response.headers.get("etag"),
    contentType,
    lastModified: dateOf(response.headers.get("last-modified")),
    body,
    bytes,
    text: async () => new TextDecoder().decode(await bytes()),
    blob: async () => new Blob([await bytes()], contentType ? { type: contentType } : {}),
    links: shape.links,
    parent: shape.parent,
    metadataUrl: shape.metadataUrl,
    kind: shape.kind,
    allow: shape.allow,
  };
}
