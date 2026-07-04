// AUTHORED-BY Claude Fable 5
/**
 * sanitize-dist — the PURE sanitisers for the committed `dist/` artifacts, split out
 * of `build-dist.mjs` so they can be unit-tested without running esbuild or touching
 * the filesystem. `build-dist.mjs` wires these into the actual file read/write.
 *
 * esbuild embeds machine paths in two places — module-boundary banner comments in
 * `index.js` and `sources[]` in `index.js.map` — which would otherwise (a) leak the
 * builder's home directory (`/Users/<name>/…`) into the committed bytes and (b) make
 * those bytes non-deterministic across machines / worktrees / a scratch-dir rebuild.
 * These helpers rewrite those path FIELDS to a stable, package-relative label and then
 * FAIL the build if any host path survives — including paths that contain a SPACE
 * (e.g. `/Users/Jesse Wright/…`), which a whitespace-excluding matcher would silently
 * miss.
 */

/**
 * Host/home absolute-path prefixes that must NEVER survive in a committed artifact.
 */
export const FORBIDDEN_PATH_PREFIXES = ["/Users/", "/home/", "/root/", "/private/", "/var/"];

/**
 * Matches an esbuild module-boundary banner line: `// <path>` where <path> ends in a
 * source extension. The payload is matched PERMISSIVELY (`.+`, so a path containing a
 * space such as `/Users/Jesse Wright/…/src/foo.ts` is captured in full and cannot slip
 * past the rewrite/guard). Classification of the captured value happens in
 * `pkgRelativePath` (URLs and non-build-path prose are left untouched there).
 */
export const JS_BANNER_RE = /^\/\/ (.+\.(?:js|cjs|mjs|ts|tsx|jsx))$/gm;

/**
 * A comment line that is essentially a bare host path — a leaked module banner esbuild
 * emitted for a module with NO recognised source extension (so the rewrite could not
 * classify it) or a value the classifier could not reduce. Matches `// /Users/…`,
 * `// ../../home/…`, etc. Anchored so ordinary prose (`// see /var/log …`) does not
 * match — only a line that STARTS (after `// `, optional `./`/`../`, optional `/`)
 * with a forbidden root segment.
 */
const LEAKED_BANNER_RE = /^\/\/ (?:\.{1,2}\/)*\/?(?:Users|home|root|private|var)\//;

/** A `scheme://` URL — not a filesystem build path, so it is left untouched. */
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Reduce a build path to a stable, location-independent package-relative label: an
 * inlined dep collapses to `node_modules/…`, our own code to `src/…`. Anchoring on the
 * LAST occurrence of the package-internal marker (`lastIndexOf`) — not the first — is
 * load-bearing: a checkout located under a parent dir that itself contains a
 * `/node_modules/` or `/src/` segment (e.g. `/Users/x/projects/src/nested/pkg/src/…`)
 * would otherwise retain the parent components, leaking a local path AND making the
 * dist non-deterministic. `lastIndexOf` always anchors on the package's OWN segment.
 * URLs are recognised and returned unchanged (a `https://…/x.js` in a preserved source
 * comment must not be mangled into `x.js`). A path with no marker is returned as-is so
 * that `assertNoHostPath` / `assertNoLeakedBanner` can still catch a residual host
 * prefix rather than have it silently stripped.
 */
export function pkgRelativePath(p) {
  if (URL_RE.test(p)) {
    return p;
  }
  const nm = p.lastIndexOf("/node_modules/");
  if (nm !== -1) {
    return p.slice(nm + 1);
  }
  const sc = p.lastIndexOf("/src/");
  if (sc !== -1) {
    return p.slice(sc + 1);
  }
  return p;
}

/**
 * Fail the build if any host/home absolute-path prefix survives in the given build
 * PATH fields (the `.js` banner comment paths + the sourcemap `sources[]`/`sourceRoot`
 * entries). Scans ONLY the path fields passed in — NEVER `sourcesContent` (inlined
 * source bodies) or arbitrary `.js` string content — so a legitimate string / URL /
 * fixture / prose comment containing `/var/` or `/private/` cannot false-fail.
 */
export function assertNoHostPath(name, paths) {
  for (const p of paths) {
    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      if (typeof p === "string" && p.includes(prefix)) {
        throw new Error(
          `build-dist: committed dist/${name} still embeds a host path (${prefix}…): ` +
            `${JSON.stringify(p)}. The sanitiser must reduce every build path to a ` +
            "package-relative one before commit.",
        );
      }
    }
  }
}

/**
 * Fallback guard against a leaked banner the extension-based rewrite could not classify
 * (e.g. a module with no source extension, or a path with a space the classifier could
 * not reduce). Scans the emitted `.js` COMMENT LINES only (via `LEAKED_BANNER_RE`), so
 * code/string content is never scanned. Any surviving bare host-path banner FAILS the
 * build — the guard cannot be defeated by a space in the path.
 */
export function assertNoLeakedBanner(name, js) {
  for (const line of js.split("\n")) {
    if (LEAKED_BANNER_RE.test(line)) {
      throw new Error(
        `build-dist: committed dist/${name} has an unclassified absolute-path module ` +
          `banner (a leak the classifier could not reduce): ${JSON.stringify(line.slice(0, 120))}.`,
      );
    }
  }
}

/**
 * Rewrite each `index.js` module-boundary banner path to its package-relative label,
 * then fail closed if any host path survives (both via the per-banner host-path check
 * and the bare-banner fallback). Returns the sanitised JS text.
 */
export function sanitizeJs(js) {
  const bannerPaths = [];
  const out = js.replace(JS_BANNER_RE, (_m, p) => {
    const rel = pkgRelativePath(p);
    bannerPaths.push(rel);
    return `// ${rel}`;
  });
  assertNoHostPath("index.js", bannerPaths);
  assertNoLeakedBanner("index.js", out);
  return out;
}

/**
 * Rewrite an `index.js.map` object in place: relativise every `sources[]` entry to the
 * SAME plain label form used for the `.js` banners, and CLEAR any non-empty
 * `sourceRoot` (which is prepended to every `sources[]` entry and can itself carry a
 * host path — clearing IS the sanitisation, since the committed map is self-contained
 * via `sourcesContent`). Then validate the sanitised `sources[]` AND the cleared
 * `sourceRoot` so no path-bearing field is silently unhandled. `sourcesContent` is left
 * untouched. Returns the (mutated) map object.
 */
export function sanitizeMap(map) {
  const sources = Array.isArray(map.sources) ? map.sources.map(pkgRelativePath) : [];
  if (Array.isArray(map.sources)) {
    map.sources = sources;
  }
  if (typeof map.sourceRoot === "string" && map.sourceRoot.length > 0) {
    map.sourceRoot = "";
  }
  const sourceRoot = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
  assertNoHostPath("index.js.map", [...sources, sourceRoot]);
  return map;
}
