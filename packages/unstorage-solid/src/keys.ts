// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Key <-> LDP-path mapping for the Solid unstorage driver.
//
// unstorage keys are `:`-delimited (e.g. `foo:bar:baz`). This module maps a key
// to an LDP resource URL UNDER a fixed `base` container, and maps a member URL
// discovered in a container listing back to a key. The round-trip MUST be exact.
//
// The mapping is the driver's primary SECURITY surface: a key ultimately becomes
// a URL we issue an authenticated request to. So it is fail-closed against path
// traversal (`..`) and absolute / scheme-bearing segments — a key can NEVER
// escape the `base` container, point at a different origin, or smuggle a
// `..`/`.`/`//` past us.
//
// Mapping rules (documented here and in the README — keep both in sync):
//   - `base` is normalised to exactly one trailing `/` (a container URL).
//   - The key is split on `:` into segments. Each non-empty segment is
//     `encodeURIComponent`-encoded and the segments are joined with `/`.
//   - Empty segments (a leading/trailing/double `:`) are rejected — they would
//     produce `//` or a trailing `/` and so blur the resource/container line.
//   - A decoded segment equal to `.` or `..` is rejected (traversal guard).
//   - Encoded path delimiters (`%2F` / `%5C`) are refused by the scope guard.
//   - The resulting URL is resolved against `base` and re-validated to be a
//     strict descendant of `base` (defence in depth against any encoding trick).

import { assertWithinPodScope, PodScopeError } from "@jeswr/guarded-fetch";

/** A key segment that, decoded, would traverse the path. */
const TRAVERSAL_SEGMENTS = new Set([".", ".."]);

/**
 * Map a single URL path segment back to a KEY segment that round-trips exactly
 * through {@link keyToUrl}.
 *
 * The segment is decoded for readability (so a space stays a space, `#`/`?` stay
 * literal), BUT the four characters that carry meaning at the KEY level — `%`
 * (escape introducer), `:` (the key separator), and `/`/`\` (rejected as raw
 * traversal vectors) — are re-escaped so the produced key segment:
 *   - contains no raw `:`/`/`/`\` (cannot introduce a false separator or be
 *     rejected by the raw-slash guard), and
 *   - decodes cleanly back to the original value (escaping `%` first keeps any
 *     literal `%` in the decoded value a well-formed `%25`).
 *
 * So a single URL segment always maps to a single key segment, and
 * `keyToUrl(base, urlToKey(base, url)) === url` for every scope-checked member URL
 * we emit. Encoded path delimiters are refused by the scope guard.
 * (A "nice" segment with none of those four characters is returned decoded
 * verbatim — the human-readable canonical form.)
 */
function urlSegmentToKeySegment(urlSegment: string): string {
  const decoded = decodeURIComponent(urlSegment);
  // Escape `%` FIRST (so an already-literal `%` becomes `%25` and the result is
  // well-formed), then the key-level separators `:`, `/`, `\`.
  return decoded
    .replace(/%/g, "%25")
    .replace(/:/g, "%3A")
    .replace(/\//g, "%2F")
    .replace(/\\/g, "%5C");
}

/**
 * Normalise a base container URL to exactly one trailing slash. Throws if the
 * base is not an absolute http(s) URL.
 */
export function normalizeBase(base: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`[unstorage-solid] \`base\` must be an absolute URL, got: ${base}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[unstorage-solid] \`base\` must be an http(s) URL, got protocol: ${url.protocol}`,
    );
  }
  // Collapse the path to a single trailing slash; preserve everything else.
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  // A base must not carry a query or fragment — it is a container address.
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Validate + split a key into encoded path segments. Throws on any traversal /
 * empty / malformed segment. Returns the segments still ENCODED (ready to join).
 */
function keyToEncodedSegments(key: string): string[] {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("[unstorage-solid] key must be a non-empty string");
  }
  // A raw `/` or `\` in a key is ambiguous against our `:`-as-separator scheme
  // and is the classic traversal vector — reject outright. (unstorage itself
  // normalises `/`,`\` to `:` before the driver is called, so a key reaching us
  // with a raw slash is anomalous; fail closed.)
  if (key.includes("/") || key.includes("\\")) {
    throw new Error(`[unstorage-solid] key must not contain \`/\` or \`\\\`: ${key}`);
  }
  const rawSegments = key.split(":");
  const encoded: string[] = [];
  for (const seg of rawSegments) {
    if (seg.length === 0) {
      throw new Error(
        `[unstorage-solid] key has an empty segment (leading/trailing/double \`:\`): ${key}`,
      );
    }
    if (TRAVERSAL_SEGMENTS.has(seg)) {
      throw new Error(`[unstorage-solid] key segment \`${seg}\` is not allowed (path traversal)`);
    }
    // Decode-then-check too: a segment like `%2e%2e` decodes to `..` and would
    // otherwise slip past the literal check above.
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      throw new Error(`[unstorage-solid] key segment is not valid URI-encodable text: ${seg}`);
    }
    if (TRAVERSAL_SEGMENTS.has(decoded)) {
      throw new Error(
        `[unstorage-solid] key segment decodes to \`${decoded}\` (path traversal): ${seg}`,
      );
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw new Error("[unstorage-solid] key segment contains an encoded path delimiter (%2F/%5C)");
    }
    // Re-encode the DECODED form so a key passed in either raw or pre-encoded
    // shape maps to the same URL (idempotent encoding).
    encoded.push(encodeURIComponent(decoded));
  }
  return encoded;
}

/**
 * Map an unstorage key to the absolute LDP resource URL under `base`.
 * `base` must already be normalised (see {@link normalizeBase}).
 *
 * @throws if the key contains a traversal / empty / malformed segment, or if the
 *   resolved URL would escape `base` (defence in depth).
 */
export function keyToUrl(base: string, key: string): string {
  const segments = keyToEncodedSegments(key);
  const relative = segments.join("/");
  const resolved = new URL(relative, base);
  assertWithinBase(base, resolved.toString());
  return resolved.toString();
}

/**
 * Map an unstorage key to the absolute LDP CONTAINER URL under `base` (trailing
 * slash). Used by getKeys/clear when a key denotes a sub-container.
 */
export function keyToContainerUrl(base: string, key: string): string {
  return `${keyToUrl(base, key)}/`;
}

/**
 * Fail-closed assertion that `url` is `base` itself or a strict descendant of it
 * (same origin, path prefixed by base path). Guards against any
 * encoding/normalisation trick producing a URL outside the pod sub-tree we own.
 * @deprecated Use `assertWithinPodScope` from `@jeswr/guarded-fetch` for new callers.
 */
export function assertWithinBase(base: string, url: string): void {
  // The legacy API accepts ABSOLUTE targets only; the shared primitive also
  // accepts relative references, so parse without a base before delegating.
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("[unstorage-solid] target URL is invalid");
  }
  try {
    assertWithinPodScope(base, target.href, {
      // The shared primitive aliases `/alice` to `/alice/`. The old API rejects
      // that alias, including `/alice/` for `/alice//`, even for container operations.
      allowRoot: target.pathname === new URL(base).pathname,
    });
  } catch (error) {
    if (!(error instanceof PodScopeError)) throw error;
    // Retain the existing diagnostic vocabulary without copying scope logic.
    throw new Error(`[unstorage-solid] ${error.message.replace("escapes pod", "escapes base")}`, {
      cause: error,
    });
  }
}

/**
 * Map a member URL (absolute, as discovered in a container listing) back to an
 * unstorage key, relative to `base`. Returns `undefined` if the member is `base`
 * itself or does not lie under `base` (defence in depth — a hostile/buggy server
 * cannot inject a foreign URL into the key space).
 *
 * The returned key is `:`-delimited; each path segment is decoded for
 * readability but its key-level meta-characters (`%`, `:`, `/`, `\`) are
 * re-escaped (see {@link urlSegmentToKeySegment}) so the key round-trips exactly
 * through {@link keyToUrl} for scope-checked members. Encoded delimiter URLs
 * cannot be used as keys even if this lexical decoder can represent them. A
 * trailing slash (container member) is stripped before mapping — callers track
 * container-ness separately. Returns `undefined` if any segment is not
 * well-formed percent-encoding (a hostile/buggy server cannot inject a malformed
 * member into the key space).
 */
export function urlToKey(base: string, memberUrl: string): string | undefined {
  const b = new URL(base);
  let u: URL;
  try {
    u = new URL(memberUrl, base);
  } catch {
    return undefined;
  }
  if (/%2f|%5c/i.test(u.pathname)) return undefined;
  if (u.origin !== b.origin) {
    return undefined;
  }
  let path = u.pathname;
  // Strip a trailing slash (container member) — container-ness is tracked by the
  // caller; the KEY is the same whether or not the member is a container.
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (!path.startsWith(b.pathname)) {
    return undefined;
  }
  const relative = path.slice(b.pathname.length);
  if (relative.length === 0) {
    return undefined; // this IS base — not a key.
  }
  const segments = relative.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  try {
    return segments.map((s) => urlSegmentToKeySegment(s)).join(":");
  } catch {
    // A malformed percent-escape in a member URL (decodeURIComponent threw) —
    // refuse it rather than surface a corrupt key (defence in depth).
    return undefined;
  }
}

/** True iff `memberUrl` is a container (LDP convention: a trailing slash). */
export function isContainerUrl(memberUrl: string): boolean {
  // Compare on the path so query/fragment (which a container address never has)
  // cannot fool the check.
  try {
    return new URL(memberUrl).pathname.endsWith("/");
  } catch {
    return memberUrl.endsWith("/");
  }
}
