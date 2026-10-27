// AUTHORED-BY Codex GPT-6.1-Sol

import { requestHref } from "./request.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_HEADERS = ["Content-Encoding", "Content-Language", "Content-Location", "Content-Type"];

/**
 * Follow visible redirects only after the same live credential gate accepts each hop.
 * `send` upgrades afresh and performs the bounded 401 retry for that hop.
 * This is internal; full-page OAuth login redirects live separately in redirect.ts.
 */
export async function fetchWithCredentialedRedirects(
  request: Request,
  init: RequestInit | undefined,
  matches: (request: Request) => boolean | Promise<boolean>,
  send: (request: Request) => Promise<Response>,
): Promise<Response> {
  // A Request exposes only a stream, with no portable way to recover its source.
  // Buffer only a caller-supplied non-stream BodyInit, never an arbitrary stream.
  const source = init?.body;
  let replayable =
    request.body === null ||
    (source != null && !(typeof source === "object" && "getReader" in source));
  let current = new Request(request, { redirect: "manual" });
  let body: ArrayBuffer | null = null;
  if (current.body !== null && replayable) {
    body = await current.arrayBuffer();
    current = new Request(current, { body });
  }

  for (let hops = 0; ; hops++) {
    const response = await send(current);
    if (response.type === "opaqueredirect" || !REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    const location = response.headers.get("Location");
    if (location === null) return response;
    const href = requestHref(current);
    if (href === undefined) return response;
    const destination = new URL(location, href);
    const rewrite =
      (response.status === 303 && current.method !== "GET" && current.method !== "HEAD") ||
      ((response.status === 301 || response.status === 302) && current.method === "POST");
    // Fetch cannot replay a streaming body. A rewrite discards it, so it is safe.
    if (!rewrite && !replayable) return response;
    const headers = new Headers(current.headers);
    headers.delete("Authorization");
    headers.delete("DPoP");
    if (rewrite) {
      for (const header of BODY_HEADERS) headers.delete(header);
    }
    const next = new Request(destination, {
      method: rewrite ? "GET" : current.method,
      headers,
      body: rewrite ? null : body,
      redirect: "manual",
      cache: current.cache,
      credentials: current.credentials,
      integrity: current.integrity,
      keepalive: current.keepalive,
      mode: current.mode,
      referrer: current.referrer,
      referrerPolicy: current.referrerPolicy,
      signal: current.signal,
    });
    // Never send even an uncredentialed follow-up outside the live allowlist.
    if (!(await matches(next))) return response;
    if (hops === 20) {
      void response.body?.cancel().catch(() => {});
      throw new TypeError("fetch failed: redirect count exceeded");
    }
    // Release a followed response, but leave every returned redirect untouched.
    void response.body?.cancel().catch(() => {});
    if (rewrite) {
      body = null;
      replayable = true;
    }
    current = next;
  }
}
