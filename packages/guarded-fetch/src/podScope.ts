// AUTHORED-BY Claude Fable 5
/**
 * The POD-SCOPE guard — the suite's ONE reviewed home for "is this URL within the
 * configured pod (sub-)container?", consolidating the ~8 bespoke `assertWithinBase` /
 * pod-scope-guard copies (rxdb-solid, y-solid, n8n-nodes-solid, solid-mcp, unite,
 * solid-components, solid-granary, matrix-chat-to-pod), each of which was separately
 * roborev-hardened against the same adversarial cases. This module is the UNION of every
 * defence any one of them had, fail-closed on any doubt.
 *
 * The scope is a capability boundary, distinct from the SSRF guard in `./guard.ts`:
 *   - the SSRF guard decides "is this host SAFE to fetch at all?" (public-address policy);
 *   - the pod-scope guard decides "is this URL within the ONE sub-tree this component was
 *     configured to touch?" — so a hostile listing entry, workflow input, or poisoned
 *     redirect can never point an authenticated fetch at a foreign origin or at a pod
 *     resource above/beside the configured base.
 * They compose: `createPodScopedFetch(base, { fetch: createGuardedFetch(...) })`.
 *
 * The enforced contract (every rule below is load-bearing; each came from at least one of
 * the consolidated copies):
 *   - the BASE must be an absolute http(s) URL; it is normalised to exactly one trailing
 *     `/` (a container address) with no query/fragment, and must not embed credentials or
 *     an encoded path delimiter;
 *   - only `http:` / `https:` candidates are accepted — `file:`, `data:`, `blob:`,
 *     `javascript:`, … are refused outright (scheme-confusion / SSRF guard);
 *   - a scheme-relative candidate (`//host/…`) is refused BEFORE parsing — it silently
 *     re-points the origin;
 *   - embedded credentials (`https://user:pass@…`) are refused, and the refusal message
 *     never echoes them (nor does any other error here — see {@link redactUserinfo});
 *   - the candidate must be SAME-ORIGIN with the base (scheme + host + port all match);
 *   - the path check is a real SEGMENT-BOUNDARY prefix on the slash-terminated base path —
 *     `/podfoo` is NOT under `/pod/`;
 *   - `.` / `..` traversal (raw, `%2e`-encoded, or backslash-written) is collapsed by the
 *     WHATWG parser FIRST and the COLLAPSED result is what gets validated, so a traversal
 *     that escapes the base simply fails the prefix check;
 *   - an ENCODED path delimiter (`%2F` / `%5C`) surviving in the resolved path is refused
 *     outright: the request URL itself stays in scope, but a server that percent-decodes
 *     before path-normalisation would alias it OUTSIDE the base — the ambiguity is refused
 *     rather than trusting every server's decode order;
 *   - a relative candidate is resolved against the base. A ROOT-ABSOLUTE reference
 *     (`/x`) is deliberately NOT re-rooted under the base: it resolves at the origin root
 *     and is then refused unless the base is the origin root — silent re-rooting would
 *     mask an escaping input.
 *
 * The base itself counts as "within scope" by DEFAULT (`allowRoot: true`) — reading or
 * listing the configured container is in scope. Stores that mint documents strictly UNDER
 * the base (rxdb-solid / y-solid semantics, where touching the container document itself is
 * a footgun) pass `{ allowRoot: false }` to require a strict descendant.
 *
 * **Pure core, no platform:** only the WHATWG `URL` global — browser-safe, no `node:*`.
 */
import { isRedirect, normalizeRequest, rewriteInitForRedirect, sameOrigin } from "./redirect.js";

/** Raised when the pod-scope guard refuses a base, a candidate URL, or a redirect hop. */
export class PodScopeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PodScopeError";
  }
}

/** Options for the pod-scope checks. */
export interface PodScopeOptions {
  /**
   * Whether the base itself (the configured container, slash-terminated or not) counts as
   * within scope. Default `true` — reading/listing the configured container is in scope.
   * Set `false` for a WRITE-TARGET guard where documents are minted strictly UNDER the
   * base and touching the container document itself would clobber it (the rxdb-solid /
   * y-solid store semantics).
   */
  readonly allowRoot?: boolean;
}

/** Options for {@link createPodScopedFetch}. */
export interface PodScopedFetchOptions extends PodScopeOptions {
  /**
   * The underlying `fetch` to issue the (scope-checked, `redirect:"manual"`) requests
   * with. Defaults to `globalThis.fetch`. Pass an authenticated fetch here — the guard
   * threads it through unchanged; pass a {@link createGuardedFetch} result to stack the
   * SSRF policy under the scope check.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Maximum redirect hops to follow (default 5). Each hop is re-checked against the scope. */
  readonly maxRedirects?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;

/** Encoded path delimiters (`%2F` / `%5C`), refused when they survive in a resolved path. */
const ENCODED_DELIMITER = /%2f|%5c/i;

/**
 * Redact any embedded userinfo (`scheme://user:pass@host…` or a scheme-relative
 * `//user:pass@host…`) from a URL-ish string BEFORE it is interpolated into an error
 * message. Every validation error here echoes a user-controlled value, and consumers
 * surface those messages into logs / item output — so a target like `https://u:p@host/x`
 * must never leak its credentials through an error.
 *
 * This is a deliberately BROAD, best-effort textual scrub that also works on MALFORMED
 * input (where `new URL` threw, so the parser cannot be trusted — and a value like
 * `ht!tp://u:p@host/` has no RFC-valid scheme yet still carries a secret). It replaces
 * EVERY `//…@` authority-userinfo span (global, scheme-prefix-agnostic) with
 * `//<redacted>@`. The span is `[^/?#]*` (NOT excluding whitespace or `@`): a malformed
 * target like `https://alice:s3 cr3t@ho st/x` would otherwise slip the scrub and leak the
 * credential through the invalid-target error path. Over-redaction is safe here (these are
 * error strings, not requests); under-redaction would leak — so the rule errs toward
 * redacting.
 */
export function redactUserinfo(value: string): string {
  if (typeof value !== "string") {
    return String(value);
  }
  // `[^/?#]*@` is greedy up to the LAST `@` before an authority terminator, so all
  // userinfo (incl. spaces, control chars, an embedded `@`) is redacted.
  return value.replace(/\/\/[^/?#]*@/g, "//<redacted>@");
}

/**
 * Normalise a pod base URL to a canonical container address: an absolute http(s) URL with
 * exactly one trailing `/`, no query/fragment, no embedded credentials, and no encoded
 * path delimiter. Throws {@link PodScopeError} otherwise. Every other function in this
 * module runs its `base` through this first, so callers may pass a non-normalised base —
 * but validating once at config time gives an earlier, clearer failure.
 */
export function normalizePodBase(base: string): string {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new PodScopeError("pod base URL must be a non-empty string.");
  }
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    throw new PodScopeError(
      `pod base URL must be an absolute http(s) URL, got: ${redactUserinfo(base)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PodScopeError(`pod base URL must be http(s), got protocol: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    // Deliberately does NOT echo the base — it embeds the very credentials being refused.
    throw new PodScopeError("pod base URL must not embed credentials (user:pass@).");
  }
  if (ENCODED_DELIMITER.test(url.pathname)) {
    throw new PodScopeError(
      `pod base URL contains an encoded path delimiter (%2F/%5C): ${redactUserinfo(base)}`,
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
 * Fail-closed assertion that `url` is within the pod scope rooted at `base`: same origin
 * AND path-prefixed under the base at a real segment boundary, http(s) only, with every
 * guard documented at the top of this module. `url` may be absolute (validated as-is
 * after WHATWG normalisation) or a relative reference (resolved against the base, then the
 * RESOLVED result is validated — so `.`/`..`/`%2e%2e` traversal is collapsed before the
 * check and cannot smuggle the target out).
 *
 * Returns the CANONICAL resolved URL string (use it as the request target, so the URL that
 * was checked is the URL that is fetched).
 *
 * @throws PodScopeError if the base is invalid or the candidate is out of scope.
 */
export function assertWithinPodScope(base: string, url: string, options?: PodScopeOptions): string {
  const root = normalizePodBase(base);
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new PodScopeError("target URL must be a non-empty string.");
  }
  const trimmed = url.trim();
  // A scheme-relative reference (`//host/path`) re-points the origin while looking like a
  // path — refuse it before the parser can resolve it onto the base's scheme.
  if (trimmed.startsWith("//")) {
    throw new PodScopeError(
      `target URL must not be scheme-relative ("//..."): ${redactUserinfo(url)} (refused)`,
    );
  }
  let resolved: URL;
  try {
    // Resolve relative references against the canonical base; an absolute URL ignores the
    // base. Either way the RESOLVED (dot-segment-collapsed) result is what gets validated.
    resolved = new URL(trimmed, root);
  } catch {
    throw new PodScopeError(`target URL is invalid: ${redactUserinfo(url)}`);
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new PodScopeError(
      `target URL must be http(s), got protocol: ${resolved.protocol} (refused)`,
    );
  }
  if (resolved.username !== "" || resolved.password !== "") {
    // Embedded userinfo does NOT change the WHATWG origin, so it would slip the
    // same-origin check — but a pod resource address never carries credentials, and
    // forwarding them would leak. Refused outright; the message deliberately does NOT
    // echo the target (it embeds the very credentials being refused).
    throw new PodScopeError("target URL must not embed credentials (user:pass@) (refused)");
  }
  const b = new URL(root);
  if (resolved.origin !== b.origin) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} escapes pod origin ${b.origin} (refused)`,
    );
  }
  // Defence in depth: refuse ENCODED path delimiters. The WHATWG parser leaves `%2F`/`%5C`
  // un-decoded, so `data/..%2fsecret` passes the prefix check and the request URL itself
  // stays under the base — but a server that percent-DECODES before path-normalisation
  // would alias it ABOVE the base (`/secret`). A pod resource address never legitimately
  // encodes a `/` or `\` in a segment, so the ambiguity is refused outright rather than
  // trusting every server's decode order (fail-closed).
  if (ENCODED_DELIMITER.test(resolved.pathname)) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} contains an encoded path delimiter (%2F/%5C) (refused)`,
    );
  }
  // The base path is slash-terminated (normalizePodBase), so `startsWith` IS a real
  // path-segment-boundary check: `/podfoo/x` does not start with `/pod/`.
  const basePath = b.pathname;
  // The root may be addressed slash-terminated (`/pod/`) or slashless (`/pod`) — servers
  // commonly alias the two, so both are treated as the ROOT (gated by allowRoot) rather
  // than the slashless form slipping through as an out-of-scope sibling. The path (not the
  // query/fragment) decides root-ness, so `?`/`#` variants of the root cannot slip through.
  const isRoot =
    resolved.pathname === basePath ||
    (basePath !== "/" && resolved.pathname === basePath.slice(0, -1));
  if (!isRoot && !resolved.pathname.startsWith(basePath)) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} escapes pod path ${basePath} (refused)`,
    );
  }
  if (isRoot && options?.allowRoot === false) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} is the pod base itself, not a resource under it (refused; allowRoot is false)`,
    );
  }
  return resolved.toString();
}

/**
 * Boolean form of {@link assertWithinPodScope}: `true` iff `url` is within the pod scope
 * rooted at `base`. Fail-closed — ANY doubt (including an invalid base) returns `false`;
 * use {@link normalizePodBase} at config time if an invalid base should fail loudly.
 */
export function isWithinPodScope(base: string, url: string, options?: PodScopeOptions): boolean {
  try {
    assertWithinPodScope(base, url, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Non-throwing FILTER form of {@link assertWithinPodScope}: the canonical in-scope URL
 * string, or `undefined` if `url` is out of scope (or the base is invalid). Use it to
 * DROP untrusted URLs — child entries from a container listing, type-index targets
 * discovered from a profile — rather than aborting the whole operation: a malicious
 * listing that points at an external origin is silently discarded (fail-closed).
 */
export function podScopedUrl(
  base: string,
  url: string,
  options?: PodScopeOptions,
): string | undefined {
  try {
    return assertWithinPodScope(base, url, options);
  } catch {
    return undefined;
  }
}

/** True iff `url` is a container address (LDP convention: the path ends with `/`). */
export function isContainerUrl(url: string): boolean {
  // Compare on the path so a query/fragment cannot fool the check.
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}

/**
 * Build a `fetch`-shaped POD-SCOPED fetch bound to `base`: every request URL AND every
 * redirect hop is checked with {@link assertWithinPodScope} before any bytes move, so a
 * poisoned in-scope resource cannot `302` the authenticated fetch out of the pod
 * (validating only the initial URL is NOT enough — default `fetch` auto-follows 3xx).
 *
 * Redirects are handled manually with standard Fetch semantics (bounded hops, loop
 * detection, method-changing redirects switch to GET and drop the body) via the same
 * shared machinery as {@link createGuardedFetch}. Because every hop must stay in scope,
 * every hop is same-origin by construction — credentials therefore survive an in-scope
 * redirect, and any out-of-scope hop throws {@link PodScopeError} instead of being
 * followed.
 *
 * This wrapper enforces SCOPE, not host safety — the base is trusted config. To also
 * apply the SSRF policy, pass a guarded fetch: `createPodScopedFetch(base, { fetch:
 * createGuardedFetch(opts) })`.
 *
 * @throws PodScopeError from the returned fetch when a request or redirect leaves the scope.
 */
export function createPodScopedFetch(
  base: string,
  options: PodScopedFetchOptions = {},
): typeof globalThis.fetch {
  const root = normalizePodBase(base); // throw at config time, not first call
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const scopeOptions: PodScopeOptions = { allowRoot: options.allowRoot ?? true };

  const scoped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
    let currentUrl = assertWithinPodScope(root, startUrl, scopeOptions);
    let currentInit: RequestInit = { ...(effectiveInit ?? {}) };
    const seen = new Set<string>();
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new PodScopeError(`redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      const res = await fetcher(currentUrl, {
        ...currentInit,
        // Every hop is re-checked by US, so the underlying fetch must NOT auto-follow.
        redirect: "manual",
      });
      if (!isRedirect(res.status)) {
        return res;
      }
      const location = res.headers.get("location");
      if (!location) {
        // A 3xx with no Location is not followable — return it as-is.
        return res;
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new PodScopeError(
          `redirect to a malformed Location (${redactUserinfo(location)}) from ${currentUrl} (refused)`,
        );
      }
      // THE guard: a redirect that leaves the pod scope throws instead of being followed.
      const checkedNext = assertWithinPodScope(root, nextUrl, scopeOptions);
      currentInit = rewriteInitForRedirect(
        currentInit,
        res.status,
        !sameOrigin(currentUrl, checkedNext),
      );
      try {
        await res.body?.cancel();
      } catch {
        // Body already consumed/closed — fine.
      }
      currentUrl = checkedNext;
    }
    throw new PodScopeError(`too many redirects (> ${maxRedirects}) within pod scope ${root}.`);
  };
  return scoped as typeof globalThis.fetch;
}
