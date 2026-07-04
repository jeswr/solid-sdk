// AUTHORED-BY Claude Sonnet 5
/**
 * sanitize-dist — the PURE sanitisers for the committed `dist/` artifacts, split out
 * of `build-dist.mjs` so they can be unit-tested without running esbuild or touching
 * the filesystem. `build-dist.mjs` wires these into the actual file read/write.
 *
 * esbuild embeds machine-dependent paths in two places — module-boundary banner
 * comments in `index.js` and `sources[]` in `index.js.map` — which would otherwise
 * (a) leak the builder's home directory (`/Users/<name>/…`) into the committed bytes
 * and (b) make those bytes non-deterministic across machines / worktrees / a
 * scratch-dir rebuild. These helpers rewrite those path FIELDS to a stable,
 * package-relative label and then FAIL the build if any host path survives.
 *
 * ROOT-CAUSE classification (why NOT string-substring). Earlier versions reduced a
 * path with `indexOf`/`lastIndexOf("/src/")` / `lastIndexOf("/node_modules/")`. That
 * is defeatable by CONTEXT: a checkout located under a parent directory that itself
 * contains a `/node_modules/` or `/src/` segment (e.g.
 * `/tmp/node_modules/worktrees/pkg/src/index.ts`) makes own-source mis-reduce to
 * `node_modules/…` and slip past the guard. The fix classifies by PACKAGE-ROOT
 * CONTEXT instead: resolve the esbuild-relative path to an absolute one (against the
 * base it is relative to), then ask `path.relative(packageRoot, abs)` — if the file
 * lives UNDER the package root and NOT inside a `node_modules/` segment of that
 * relative path, it is OWN SOURCE and becomes `src/…` deterministically (immune to
 * ancestor dirs named `src`/`node_modules`, and to spaces — `path.relative` handles
 * them by construction). Anything that escapes the package root is an inlined
 * DEPENDENCY (a dependency genuinely lives under `node_modules`), so the LAST
 * `/node_modules/` of its absolute path is the correct anchor. A residual that
 * matches neither is returned unchanged for the fail-closed guard to reject — never
 * silently stripped.
 */
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Host/home absolute-path prefixes used only to produce a MORE SPECIFIC error message
 * when a residual leaked path happens to match one of these common roots. This list is
 * NOT the guard itself — see `assertNoHostPath`, which fails closed on ANY residual
 * POSIX absolute path (`norm.startsWith("/")`), not merely a fixed allowlist of known
 * prefixes. A substring-allowlist check here previously let an absolute path outside
 * this fixed set (e.g. `/tmp/build/x.ts`, `/opt/ci/x.ts`, `/workspace/x.ts`) silently
 * SURVIVE despite the guard's fail-closed intent, because `pkgRelativePath` always
 * reduces a legitimate path to a relative label (own source → `src/…`, a dependency →
 * `node_modules/…`) — so ANY remaining absolute path at this point is unconditionally a
 * leak, regardless of which root it starts with.
 */
export const FORBIDDEN_PATH_PREFIXES = ["/Users/", "/home/", "/root/", "/private/", "/var/"];

/**
 * A Windows drive-qualified absolute path (`C:/…`, `D:/…`) after POSIX-normalisation.
 * ANY drive-qualified path is a host path — it is machine-specific and must never
 * survive in a committed artifact — even a bare `D:/a/repo/orphan.ts` that contains no
 * Unix forbidden segment. Completes the absolute-path taxonomy alongside the POSIX
 * forbidden prefixes above.
 */
const DRIVE_ABS_RE = /^[A-Za-z]:\//;

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
 * classify it) or a value the classifier could not reduce. Matches EITHER a Windows
 * drive-qualified banner (`// C:/…`, `// D:/a/repo/orphan.ts` — ANY drive path is a host
 * path, even without a Unix forbidden segment) OR a POSIX forbidden-root banner
 * (`// /Users/…`, `// ../../home/…`). Anchored so ordinary prose (`// see /var/log …`)
 * does not match — the POSIX arm requires the line to START (after `// `, optional
 * `./`/`../`, optional `/`) with a forbidden root segment. Callers POSIX-normalise the
 * line (backslashes → `/`) before testing, so a Windows banner is caught too.
 */
const LEAKED_BANNER_RE =
  /^\/\/ (?:[A-Za-z]:\/|(?:\.{1,2}\/)*\/?(?:Users|home|root|private|var)\/)/;

/** A `scheme://` URL — not a filesystem build path, so it is left untouched. */
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Normalise a path to POSIX separators so labels + guard checks are stable cross-OS.
 * Replaces EVERY backslash (not just the OS `sep`) so a Windows-style `…\node_modules\…`
 * emitted on a Windows builder — or fed through on any OS — is classified/rejected the
 * same way as its `/`-separated form. A blanket backslash replace (rather than
 * `split(sep)`) is what makes this OS-agnostic.
 */
function toPosix(p) {
  return p.replace(/\\/g, "/");
}

/**
 * Index at which the LAST real `node_modules/` PATH SEGMENT begins in a POSIX path, or
 * `-1`. Segment-exact: matches only `/node_modules/` (a `/`-bounded segment) or a
 * leading `node_modules/` — never an arbitrary substring like `foonode_modules/`. The
 * return value is the offset of the `n` in `node_modules/` so `slice()` yields
 * `node_modules/<pkg>/…`.
 */
function nodeModulesSegmentStart(posix) {
  const bounded = posix.lastIndexOf("/node_modules/");
  if (bounded !== -1) {
    return bounded + 1;
  }
  if (posix.startsWith("node_modules/")) {
    return 0;
  }
  return -1;
}

/**
 * Reduce an esbuild build path to a stable, location-independent package-relative
 * label by PACKAGE-ROOT CONTEXT (see the module header for the rationale vs the old
 * substring approach).
 *
 * @param p           the raw path esbuild emitted (usually RELATIVE to `baseDir`).
 * @param packageRoot the absolute directory of the package being built (the dir that
 *                    contains its `package.json`). Own source lives under it.
 * @param baseDir     the directory `p` is relative to (esbuild emits banners relative
 *                    to the working dir and sourcemap `sources[]` relative to the map
 *                    file's dir). Defaults to `packageRoot` when omitted.
 *
 * OWN SOURCE (under packageRoot, not inside a node_modules segment) →
 *   `relative(packageRoot, abs)`, e.g. `src/index.ts` — deterministic, space-proof,
 *   immune to ancestor dirs named `src`/`node_modules`.
 * DEPENDENCY (escapes packageRoot, or a dep in the package's own node_modules) →
 *   sliced at the LAST `/node_modules/` → `node_modules/<pkg>/…`.
 * URL → returned unchanged. UNCLASSIFIABLE RESIDUAL → returned as-is (an absolute host
 *   path the guard then rejects).
 */
export function pkgRelativePath(p, packageRoot, baseDir = packageRoot) {
  if (URL_RE.test(p)) {
    return p;
  }
  const abs = isAbsolute(p) ? p : packageRoot ? resolve(baseDir ?? packageRoot, p) : p;
  if (packageRoot && isAbsolute(abs)) {
    const rel = toPosix(relative(packageRoot, abs));
    const escapes = rel === "" || rel === ".." || rel.startsWith("../");
    if (!escapes) {
      // Under the package root. A dependency installed in the package's OWN
      // node_modules still lives under the root — detect it by a real node_modules
      // path SEGMENT in the RELATIVE path (immune to a parent dir named
      // node_modules/src, and to an arbitrary `…node_modules/` substring).
      const nmRel = nodeModulesSegmentStart(rel);
      if (nmRel !== -1) {
        return rel.slice(nmRel);
      }
      return rel; // own source, e.g. `src/index.ts`
    }
  }
  // Outside the package root (a hoisted / parent-store dependency). POSIX-normalise
  // first so a Windows-style `…\node_modules\…` absolute path is reduced too, then
  // anchor on the LAST real `node_modules/` segment.
  const absPosix = toPosix(abs);
  const nm = nodeModulesSegmentStart(absPosix);
  if (nm !== -1) {
    return absPosix.slice(nm);
  }
  return absPosix; // residual host path (POSIX-normalised) — the guard rejects it
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
    if (typeof p !== "string") {
      continue;
    }
    // POSIX-normalise so a Windows-style `C:\Users\…` residual is caught by the
    // forward-slash forbidden prefixes too.
    const norm = toPosix(p);
    // ANY drive-qualified absolute path (`D:/…`) is machine-specific → a host path,
    // even a bare `D:/a/repo/orphan.ts` that carries no Unix forbidden segment.
    if (DRIVE_ABS_RE.test(norm)) {
      throw new Error(
        `build-dist: committed dist/${name} still embeds a host path (drive-qualified): ` +
          `${JSON.stringify(p)}. The sanitiser must reduce every build path to a ` +
          "package-relative one before commit.",
      );
    }
    // TRUE fail-closed check (NOT a substring allowlist): `pkgRelativePath` reduces
    // EVERY legitimate build path to a package-relative label before it ever reaches
    // this guard — own source becomes `src/…`, an inlined dependency becomes
    // `node_modules/…` — so nothing legitimate remains an absolute POSIX path here.
    // Reject ANY residual leading `/`, not just a fixed set of known home/build-root
    // prefixes: the old `FORBIDDEN_PATH_PREFIXES.some(p => norm.includes(p))` allowlist
    // missed common absolute roots like `/tmp/…`, `/opt/…`, `/workspace/…` — they
    // survived `pkgRelativePath` and slipped past the guard despite it claiming to
    // fail-closed. `FORBIDDEN_PATH_PREFIXES` is kept only to make the error message
    // more specific when the residual happens to match one of those known roots.
    if (norm.startsWith("/")) {
      const knownPrefix = FORBIDDEN_PATH_PREFIXES.find((prefix) => norm.includes(prefix));
      throw new Error(
        `build-dist: committed dist/${name} still embeds a host path` +
          (knownPrefix ? ` (${knownPrefix}…)` : "") +
          `: ${JSON.stringify(p)}. The sanitiser must reduce every build path to a ` +
          "package-relative one before commit.",
      );
    }
  }
}

/**
 * Fallback guard against a leaked banner the extension-based rewrite could not classify
 * (e.g. a module with no source extension, or a value the classifier could not reduce).
 * Scans the emitted `.js` COMMENT LINES only (via `LEAKED_BANNER_RE`), so code/string
 * content is never scanned. Any surviving bare host-path banner FAILS the build — the
 * guard cannot be defeated by a space in the path.
 */
export function assertNoLeakedBanner(name, js) {
  for (const rawLine of js.split("\n")) {
    // POSIX-normalise the line so a Windows `// C:\Users\…` banner is tested in its
    // `/`-separated form (which `LEAKED_BANNER_RE`'s optional drive prefix matches).
    const line = toPosix(rawLine);
    if (LEAKED_BANNER_RE.test(line)) {
      throw new Error(
        `build-dist: committed dist/${name} has an unclassified absolute-path module ` +
          `banner (a leak the classifier could not reduce): ${JSON.stringify(rawLine.slice(0, 120))}.`,
      );
    }
  }
}

/**
 * Rewrite each `index.js` module-boundary banner path to its package-relative label,
 * then fail closed if any host path survives (both via the per-banner host-path check
 * and the bare-banner fallback). `bannerBase` is the directory esbuild's banner paths
 * are relative to (the build working dir = `packageRoot`). Returns the sanitised JS.
 */
export function sanitizeJs(js, packageRoot, bannerBase = packageRoot) {
  const bannerPaths = [];
  const out = js.replace(JS_BANNER_RE, (_m, p) => {
    const rel = pkgRelativePath(p, packageRoot, bannerBase);
    bannerPaths.push(rel);
    return `// ${rel}`;
  });
  assertNoHostPath("index.js", bannerPaths);
  assertNoLeakedBanner("index.js", out);
  return out;
}

/**
 * Rewrite an `index.js.map` object in place: relativise every `sources[]` entry to the
 * SAME plain label form used for the `.js` banners (`sourcesBase` is the dir the map's
 * `sources[]` are relative to — the map file's own directory), and CLEAR any non-empty
 * `sourceRoot` (which is prepended to every `sources[]` entry and can itself carry a
 * host path — clearing IS the sanitisation, since the committed map is self-contained
 * via `sourcesContent`). Then validate the sanitised `sources[]` AND the cleared
 * `sourceRoot` so no path-bearing field is silently unhandled. `sourcesContent` is
 * left untouched. Returns the (mutated) map object.
 */
export function sanitizeMap(map, packageRoot, sourcesBase = packageRoot) {
  const sources = Array.isArray(map.sources)
    ? map.sources.map((s) => pkgRelativePath(s, packageRoot, sourcesBase))
    : [];
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
