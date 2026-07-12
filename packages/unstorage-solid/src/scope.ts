// AUTHORED-BY Claude Fable 5
//
// The single credentialed-fetch choke point for the data path.
//
// Every pod request the driver issues (read / write / delete / container listing)
// goes through {@link createScopedFetch}. It enforces TWO fail-closed invariants,
// in ONE place, so a reviewer audits the network boundary once rather than per
// call site:
//
//   1. Base containment of the INITIAL target — the URL must be `base` itself or a
//      strict descendant (via `assertWithinBase`). The key→URL mapper already
//      guarantees this, so this is defence in depth against a caller that forgets.
//
//   2. Redirect refusal (the credential-leak / SSRF guard). `fetch` follows 3xx
//      redirects by default, and `assertWithinBase` only vets the FIRST URL — so a
//      poisoned in-pod resource (e.g. one an attacker with append access planted in
//      a shared pod) could answer a credentialed GET/PUT with a `302` to a foreign
//      origin, and the underlying `fetch` would follow it, forwarding the
//      caller-supplied request headers (which may carry `Authorization` / a DPoP
//      proof) off-origin. We force `redirect: "manual"` and REFUSE any redirect
//      rather than follow it: a Solid pod addressed by exact, normalised URLs never
//      legitimately redirects a data request, so a redirect is anomalous and is
//      treated as hostile. This is deliberately stricter than "re-validate the hop
//      and follow if in-base": refusing outright is portable across Node (a
//      readable 3xx) and the browser (an opaque `type: "opaqueredirect"` response
//      whose `Location` the platform hides), needs no environment branch, and is
//      trivially reviewable — there is no redirect-following state machine to audit.
//
// A `304 Not Modified` is a 3xx but carries no `Location` and is NOT a redirect —
// it passes through unchanged so conditional requests keep working.

import { assertWithinBase } from "./keys.js";

/**
 * A redirect response the driver refused to follow (credential-leak / SSRF guard).
 * A Solid pod addressed by exact URLs should not redirect a data request; when one
 * does, the driver fails closed rather than forwarding credentials to the redirect
 * target.
 */
export class SolidRedirectError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(
      `[unstorage-solid] refusing to follow a redirect (status ${status}) from ${url} ` +
        "(a redirected pod request could forward credentials off-origin — SSRF/credential-leak guard)",
    );
    this.name = "SolidRedirectError";
    this.url = url;
    this.status = status;
  }
}

/** Resolve a `fetch` input to its request URL string. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * True iff `res` is a redirect the driver must refuse. A browser surfaces a
 * manual-mode redirect as an opaque response (`type: "opaqueredirect"`, status 0);
 * Node/undici surfaces the actual 3xx with a readable `Location`. A `304 Not
 * Modified` is a 3xx but not a redirect (no `Location`) and is NOT refused.
 */
function isRefusableRedirect(res: Response): boolean {
  if (res.type === "opaqueredirect") {
    return true;
  }
  return res.status >= 300 && res.status < 400 && res.status !== 304 && res.headers.has("location");
}

/**
 * Wrap `fetchImpl` into the driver's data-path fetch: it asserts the target is
 * within `base`, forces manual redirect handling, and throws
 * {@link SolidRedirectError} on any redirect (leaving `304 Not Modified`, which is
 * not a redirect, untouched). `base` must already be normalised
 * (see `normalizeBase`).
 */
export function createScopedFetch(
  base: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const scoped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    // (1) Defence in depth: the target must lie within the driver base.
    assertWithinBase(base, url);
    // (2) Force manual redirect handling so a 3xx cannot silently forward the
    //     caller's (credentialed) headers off-origin.
    const res = await fetchImpl(url, { ...init, redirect: "manual" });
    if (isRefusableRedirect(res)) {
      throw new SolidRedirectError(url, res.status);
    }
    return res;
  };
  return scoped as typeof globalThis.fetch;
}

/**
 * Wrap `fetchImpl` into the WATCH-path fetch: it asserts the target stays on
 * `origin` and refuses redirects, but — unlike {@link createScopedFetch} — does
 * NOT apply the base-PATH containment check.
 *
 * WHY a separate variant: notification discovery legitimately addresses
 * same-origin URLs OUTSIDE the driver `base` sub-tree (the pod's storage-description
 * document, the notification subscription endpoint), so the path-prefix check of
 * `createScopedFetch` would wrongly reject them. But those requests still carry the
 * caller's (possibly credentialed) headers, so they need the SAME redirect-refusal
 * guard: without it a pod-controlled same-origin description doc could `302` off
 * to a foreign origin and the underlying `fetch` would forward the headers there.
 * We force `redirect: "manual"` and throw {@link SolidRedirectError} on any
 * redirect (the watch layer catches it and degrades to a no-op). A cross-origin
 * TARGET is refused outright (fail-closed) so a credentialed request never leaves
 * `origin`.
 */
export function createSameOriginRedirectRefusingFetch(
  origin: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error(`[unstorage-solid] watch request URL is invalid: ${url}`);
    }
    // Same-origin guard (fail-closed): a credentialed watch request must never
    // leave the pod origin.
    if (target.origin !== origin) {
      throw new Error(
        `[unstorage-solid] watch request to ${url} escapes pod origin ${origin} (refused)`,
      );
    }
    const res = await fetchImpl(url, { ...init, redirect: "manual" });
    if (isRefusableRedirect(res)) {
      throw new SolidRedirectError(url, res.status);
    }
    return res;
  };
  return guarded as typeof globalThis.fetch;
}
