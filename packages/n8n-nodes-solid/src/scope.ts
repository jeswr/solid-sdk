// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pod-scope guard for the n8n Solid node.
//
// A workflow supplies a target resource/container as EITHER an absolute URL OR a
// path relative to the configured pod base. Whatever the form, the node only ever
// issues an authenticated HTTP request to a URL it has confirmed lies under the
// pod base. This module is the node's primary SECURITY surface — a buggy or
// hostile workflow input must NEVER cause the node to read or write a resource on
// a different origin, escape the pod sub-tree via `..`, or be coerced into an
// SSRF against an arbitrary host.
//
// Guarantees (documented here and in the README — keep both in sync):
//   - The pod base must be an absolute http(s) URL; it is normalised to exactly
//     one trailing `/` (a container address) with no query/fragment.
//   - A target may be absolute (must be same-origin AND path-prefixed by the
//     base) or relative (resolved against the base via the WHATWG URL parser,
//     which collapses `.`/`..`); either way the RESULT is re-validated to be the
//     base itself or a strict descendant — fail-closed.
//   - Only http: / https: targets are accepted; any other scheme (file:, data:,
//     gopher:, …) is rejected outright (SSRF / scheme-confusion guard).
//   - A `..` segment that would climb above the base is rejected even though the
//     URL parser already collapsed it, because the collapsed result is the thing
//     we validate — there is no path by which an escaping target slips through.

/** A target whose resolved URL must lie under the pod base. */
export interface ResolvedTarget {
  /** The absolute, validated URL to request. */
  readonly url: string;
  /** True iff the target is a container (LDP convention: a trailing slash). */
  readonly container: boolean;
}

/**
 * Redact any embedded userinfo (`scheme://user:pass@host…` or a scheme-relative
 * `//user:pass@host…`) from a URL-ish string BEFORE it is interpolated into an
 * error message. Every validation error here echoes a user-controlled value, and
 * the node surfaces those messages as item JSON under `continueOnFail` (and into
 * logs) — so a target like `https://u:p@host/x` must never leak its credentials
 * through an error.
 *
 * This is a deliberately BROAD, best-effort textual scrub that also works on
 * MALFORMED input (where `new URL` threw, so we cannot trust the parser — and a
 * value like `ht!tp://u:p@host/` has no RFC-valid scheme yet still carries a
 * secret). It replaces EVERY `//…@` authority-userinfo span in the string
 * (global, scheme-prefix-agnostic) with `//<redacted>@`.
 *
 * The userinfo is taken as ALL characters from `//` up to the last `@` that
 * occurs BEFORE the first authority terminator (`/`, `?`, `#`). Crucially the
 * span is `[^/?#]` (NOT `[^/?#@\s]`): it must include whitespace and control
 * chars and even an embedded `@`, because a malformed target like
 * `https://alice:s3 cr3t@ho st/x` (space in the password) would otherwise slip
 * the scrub and leak the credential through the invalid-target error path. Over-
 * redaction is safe here (these are error strings, not requests); under-redaction
 * would leak — so the rule errs toward redacting. A `//` not followed by
 * userinfo-then-`@` before a terminator (e.g. a `//a/b` path) is left alone.
 */
export function redactUserinfo(value: string): string {
  if (typeof value !== "string") {
    return String(value);
  }
  // `[^/?#]*@` is greedy up to the LAST `@` before a terminator, so all userinfo
  // (incl. spaces, control chars, an embedded `@`) is redacted; the trailing `/`
  // in `\/\/` re-anchors per authority for the global replace.
  return value.replace(/\/\/[^/?#]*@/g, "//<redacted>@");
}

/**
 * Normalise a pod base URL to exactly one trailing slash. Throws if the base is
 * not an absolute http(s) URL.
 */
export function normalizePodBase(base: string): string {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] pod base URL must be a non-empty string");
  }
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    throw new Error(
      `[n8n-nodes-solid] pod base URL must be absolute, got: ${redactUserinfo(base)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] pod base URL must be http(s), got protocol: ${url.protocol}`,
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  // A base is a container ADDRESS — it carries no query or fragment.
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Fail-closed assertion that `url` is `base` itself or a strict descendant of it
 * (same origin, path prefixed by the base path, http(s) scheme). Guards against
 * any normalisation/encoding trick producing a URL outside the pod sub-tree.
 *
 * @throws if `url` is not http(s), not same-origin, or not path-prefixed by base.
 */
export function assertWithinPod(base: string, url: string): void {
  const b = new URL(base);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${redactUserinfo(url)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] target URL must be http(s), got protocol: ${u.protocol} (refused)`,
    );
  }
  if (u.origin !== b.origin) {
    throw new Error(
      `[n8n-nodes-solid] target URL ${redactUserinfo(url)} escapes pod origin ${b.origin} (refused)`,
    );
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(
      `[n8n-nodes-solid] target URL ${redactUserinfo(url)} escapes pod path ${b.pathname} (refused)`,
    );
  }
  // Defence in depth: refuse ENCODED path delimiters. The WHATWG parser leaves
  // `%2F`/`%5C` un-decoded, so `data/..%2fsecret` passes the prefix check and the
  // request URL itself stays under the pod — but a server that percent-DECODES
  // before path-normalisation would alias it ABOVE the base (`/secret`). A pod
  // resource address never legitimately encodes a `/` or `\` in a segment, so the
  // ambiguity is refused outright rather than trusting every server's decode
  // order (fail-closed; same posture as the traversal guard above).
  if (/%2f|%5c/i.test(u.pathname)) {
    throw new Error(
      `[n8n-nodes-solid] target URL ${redactUserinfo(url)} contains an encoded path delimiter (%2F/%5C) (refused)`,
    );
  }
}

/**
 * Resolve a workflow-supplied `target` (absolute URL OR base-relative path) to an
 * absolute URL confirmed to lie under the normalised pod `base`.
 *
 * The WHATWG `URL` constructor resolves a relative reference against the base and
 * collapses `.`/`..`; we then re-validate the COLLAPSED result with
 * {@link assertWithinPod}, so a `../../etc` style traversal cannot escape — the
 * thing we check is the already-collapsed URL.
 *
 * @param base - the normalised pod base (see {@link normalizePodBase}).
 * @param target - absolute http(s) URL, or a path relative to `base`.
 * @throws if the target is empty, not http(s), or resolves outside the pod.
 */
export function resolveTarget(base: string, target: string): ResolvedTarget {
  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] target must be a non-empty string");
  }
  const trimmed = target.trim();
  // A scheme-relative reference (`//host/path`) would re-point the origin — the
  // URL parser treats it as a different authority. Reject it explicitly so a
  // relative-looking input can never change origin.
  if (trimmed.startsWith("//")) {
    throw new Error(
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${redactUserinfo(target)} (refused)`,
    );
  }
  let resolved: URL;
  try {
    // Strip a single leading "/" so an absolute-path target is resolved RELATIVE
    // to the base path (a leading-slash path would otherwise resolve to the
    // origin root and escape the base sub-tree). An already-absolute URL ignores
    // the base, which is fine — assertWithinPod re-validates it below.
    const ref = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
    resolved = new URL(ref, base);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${redactUserinfo(target)}`);
  }
  // Embedded userinfo (`https://user:pass@host/…`) does NOT change the origin, so
  // it would slip past the same-origin check — but a pod resource address never
  // carries credentials, and forwarding them on the request would be confusing /
  // credential-leaking. Refuse it outright (defence in depth). The error message
  // deliberately does NOT echo the target: it embeds the very credentials we are
  // refusing, and the node surfaces this message as item JSON under
  // `continueOnFail` (and into logs) — echoing it would leak the secret.
  if (resolved.username !== "" || resolved.password !== "") {
    throw new Error(
      "[n8n-nodes-solid] target URL must not embed credentials (user:pass@) (refused)",
    );
  }
  const url = resolved.toString();
  assertWithinPod(base, url);
  return { url, container: isContainerUrl(url) };
}

/** True iff `url` is a container (LDP convention: the path ends with `/`). */
export function isContainerUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}
