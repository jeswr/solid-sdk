// AUTHORED-BY Claude Sonnet 5
//
// Pod-scope guard for the n8n Solid node — now a THIN WRAPPER over the suite's
// consolidated pod-scope primitive in `@jeswr/guarded-fetch` (the ONE reviewed
// home for "is this URL within the configured pod (sub-)container?", which the
// ~8 previously-bespoke `assertWithinBase` / pod-scope copies across the suite
// were consolidated onto). This module keeps ONLY the n8n-specific convenience
// that shared primitive deliberately does NOT provide — a leading-slash target
// that re-roots RELATIVE TO THE BASE PATH — and re-exports the generic guards
// verbatim so the package's public API (and every caller) is unchanged.
//
// The full security contract is enforced by (and documented on)
// `@jeswr/guarded-fetch`'s `assertWithinPodScope`:
//   - the BASE must be an absolute http(s) container address (normalised to one
//     trailing `/`, no query/fragment, no credentials, no encoded delimiter);
//   - a target may be absolute (same-origin AND path-prefixed by the base) or
//     relative (resolved against the base, `.`/`..` collapsed, the COLLAPSED
//     result re-validated — traversal cannot escape);
//   - only `http:` / `https:` are accepted; a scheme-relative `//host` reference,
//     embedded credentials (`user:pass@`), and encoded path delimiters
//     (`%2F` / `%5C`) are refused fail-closed;
//   - it RETURNS the canonical (WHATWG-normalised) URL, and callers use THAT
//     returned value for the subsequent request — never the raw input.
// Errors surfaced by that primitive redact any embedded userinfo (see
// `redactUserinfo`, re-exported below) so a credential-carrying target can never
// leak through an error message the node exposes as item JSON / logs.

import {
  assertWithinPodScope,
  isContainerUrl,
  normalizePodBase,
  redactUserinfo,
} from "@jeswr/guarded-fetch";

// Pure re-exports — the generic guards live in @jeswr/guarded-fetch now. Kept on
// this module's surface so callers (and the package `main`) import paths + public
// API are unchanged by the consolidation.
export { isContainerUrl, normalizePodBase, redactUserinfo };

/** A target whose resolved URL must lie under the pod base. */
export interface ResolvedTarget {
  /** The absolute, validated, CANONICAL URL to request. */
  readonly url: string;
  /** True iff the target is a container (LDP convention: a trailing slash). */
  readonly container: boolean;
}

/**
 * Backwards-compatible VOID assertion (public-API stability): throws unless `url`
 * is `base` itself or a descendant of it. Delegates to {@link assertWithinPodScope}
 * with `allowRoot: true` — the base counts as in-scope, matching this node's
 * original semantics (it never rejected the pod root). Prefer the RETURNING
 * `assertWithinPodScope` (re-derivable from `@jeswr/guarded-fetch`) for new code,
 * so the checked URL is the URL that is used.
 *
 * @throws PodScopeError if `url` is not http(s), not same-origin, or escapes the base.
 */
export function assertWithinPod(base: string, url: string): void {
  assertWithinPodScope(base, url, { allowRoot: true });
}

/**
 * Resolve a workflow-supplied `target` (absolute URL OR base-relative path) to an
 * absolute URL confirmed to lie under the pod `base`, returning the CANONICAL
 * (WHATWG-normalised) URL callers must use for the request.
 *
 * This is the n8n-specific wrapper over {@link assertWithinPodScope}. The ONE
 * convenience the shared primitive intentionally does not provide is that a
 * LEADING-SLASH target (`/notes/x.ttl`) re-roots RELATIVE TO THE BASE PATH rather
 * than to the origin root — so `resolveTarget(base, "/notes/x.ttl")` equals
 * `${base}notes/x.ttl`, NOT an escape to the origin root. The step order below is
 * load-bearing:
 *   1. reject an empty target;
 *   2. reject a scheme-relative (`//host`) target FIRST — before the leading-slash
 *      strip, else `//evil.example/x` would get its leading slashes stripped into a
 *      harmless-looking relative path and silently miss the scheme-relative refusal;
 *   3. only THEN, for a non-absolute target, strip leading `/`+ so it resolves
 *      relative to the base path;
 *   4. delegate credentials/origin/path/encoded-delimiter/traversal validation +
 *      canonicalisation to `assertWithinPodScope`, using its RETURNED canonical URL.
 *
 * @param base - the pod base (normalised via {@link normalizePodBase}; passing a
 *   non-normalised base is fine — the primitive normalises it, idempotently).
 * @param target - absolute http(s) URL, or a path relative to `base`.
 * @throws if the target is empty, not http(s), or resolves outside the pod.
 */
export function resolveTarget(base: string, target: string): ResolvedTarget {
  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] target must be a non-empty string");
  }
  const trimmed = target.trim();
  // (2) Refuse a scheme-relative reference (`//host/path`) FIRST — it silently
  // re-points the origin. This MUST precede the leading-slash strip below.
  if (trimmed.startsWith("//")) {
    throw new Error(
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${redactUserinfo(target)} (refused)`,
    );
  }
  // (3) Strip a single/leading "/" so an absolute-path target resolves RELATIVE to
  // the base path (an origin-root path would escape the base sub-tree). An
  // already-absolute http(s) URL is passed through unchanged (it ignores the base;
  // assertWithinPodScope re-validates it as same-origin + in-path).
  const ref = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
  // (4) Delegate the rest to the shared primitive and USE its returned canonical URL.
  const url = assertWithinPodScope(base, ref, { allowRoot: true });
  return { url, container: isContainerUrl(url) };
}
