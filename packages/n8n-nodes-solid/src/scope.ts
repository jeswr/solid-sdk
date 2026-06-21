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
    throw new Error(`[n8n-nodes-solid] pod base URL must be absolute, got: ${base}`);
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
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] target URL must be http(s), got protocol: ${u.protocol} (refused)`,
    );
  }
  if (u.origin !== b.origin) {
    throw new Error(`[n8n-nodes-solid] target URL ${url} escapes pod origin ${b.origin} (refused)`);
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(`[n8n-nodes-solid] target URL ${url} escapes pod path ${b.pathname} (refused)`);
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
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${target} (refused)`,
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
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${target}`);
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
