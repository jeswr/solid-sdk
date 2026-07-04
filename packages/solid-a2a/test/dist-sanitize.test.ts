// AUTHORED-BY Claude Sonnet 5
import { describe, expect, it } from "vitest";
// The dist sanitiser is a build-time ESM script (no types); import it directly.
// @ts-expect-error — untyped .mjs build script, exercised at runtime only.
import { pkgRelativePath, sanitizeJs, sanitizeMap } from "../scripts/sanitize-dist.mjs";

// A stable package root used across the classification tests. Own source lives under
// `<ROOT>/src`; dependencies live under some `<…>/node_modules/<pkg>/…`. The space in
// the path is deliberate — the classifier must handle it by construction.
const ROOT = "/Users/Jesse Wright/proj";

describe("pkgRelativePath — classify by package-root context (not string-substring)", () => {
  it("reduces own source under the package root to `src/…`", () => {
    expect(pkgRelativePath(`${ROOT}/src/registry.ts`, ROOT)).toBe("src/registry.ts");
  });

  it("reduces a dependency (outside the root) at the LAST /node_modules/", () => {
    const p = `${ROOT}/node_modules/@jeswr/fetch-rdf/dist/parse.js`;
    expect(pkgRelativePath(p, ROOT)).toBe("node_modules/@jeswr/fetch-rdf/dist/parse.js");
  });

  it("REGRESSION: own source when the package root is itself under a parent `node_modules` dir → `src/…`, NOT `node_modules/…`", () => {
    // This is the edge that defeated the old lastIndexOf('/node_modules/') approach:
    // the ABSOLUTE own-source path contains `/node_modules/` in an ANCESTOR segment,
    // so a substring anchor mis-reduced it (leaking a local path + non-determinism).
    // Package-root context classifies it correctly by construction.
    const root = "/tmp/node_modules/worktrees/pkg";
    const own = `${root}/src/index.ts`;
    expect(pkgRelativePath(own, root)).toBe("src/index.ts");
    // The old substring anchor would have produced this leaky, non-deterministic label:
    expect(pkgRelativePath(own, root)).not.toBe("node_modules/worktrees/pkg/src/index.ts");
  });

  it("REGRESSION: own source when an ANCESTOR dir is named `src` → still `src/…`", () => {
    const root = "/Users/x/projects/src/nested/pkg";
    expect(pkgRelativePath(`${root}/src/registry.ts`, root)).toBe("src/registry.ts");
  });

  it("classifies a dep in the package's OWN node_modules (under the root) as `node_modules/…`", () => {
    const root = "/tmp/node_modules/worktrees/pkg";
    const dep = `${root}/node_modules/@jeswr/fetch-rdf/dist/parse.js`;
    expect(pkgRelativePath(dep, root)).toBe("node_modules/@jeswr/fetch-rdf/dist/parse.js");
  });

  it("resolves an esbuild path emitted RELATIVE to a base dir before classifying", () => {
    // esbuild emits sourcemap sources relative to the map file's dir; banners relative
    // to the build working dir. Passing the base lets the sanitiser resolve to abs.
    const baseDir = `${ROOT}/dist`;
    expect(pkgRelativePath("../src/registry.ts", ROOT, baseDir)).toBe("src/registry.ts");
    expect(pkgRelativePath("../node_modules/n3/dist/x.js", ROOT, baseDir)).toBe(
      "node_modules/n3/dist/x.js",
    );
  });

  it("leaves a URL untouched (not a filesystem build path)", () => {
    expect(pkgRelativePath("https://w3id.org/jeswr/a2a-rdf/v1/spec.js", ROOT)).toBe(
      "https://w3id.org/jeswr/a2a-rdf/v1/spec.js",
    );
  });
});

describe("sanitizeJs — banner rewrite is space-proof and fail-closed", () => {
  it("normalises a dep banner whose absolute path contains a SPACE", () => {
    const dirty = [
      `// ${ROOT}/node_modules/@jeswr/fetch-rdf/dist/parse.js`,
      "export const x = 1;",
    ].join("\n");
    const clean = sanitizeJs(dirty, ROOT);
    expect(clean).toContain("// node_modules/@jeswr/fetch-rdf/dist/parse.js");
    expect(clean).not.toContain("/Users/");
    expect(clean).not.toContain("Jesse Wright");
  });

  it("normalises an OWN-SRC banner whose absolute path contains a SPACE", () => {
    const dirty = `// ${ROOT}/src/registry.ts\nconst y = 2;`;
    const clean = sanitizeJs(dirty, ROOT);
    expect(clean).toContain("// src/registry.ts");
    expect(clean).not.toContain("/Users/");
    expect(clean).not.toContain("Jesse Wright");
  });

  it("FAILS the build on an unclassifiable absolute banner with a SPACE (no extension / no marker)", () => {
    const dirty = `// ${ROOT}/weird-entry\nconst z = 3;`;
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/host path|absolute-path module banner/);
  });

  it("FAILS the build if a banner escapes the root and has no node_modules anchor (residual host path)", () => {
    const dirty = "// /Users/someone/outside/orphan.js\nconst q = 6;";
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/host path|absolute-path module banner/);
  });

  it("leaves a URL-style banner comment untouched (not treated as a build path)", () => {
    const dirty = "// https://w3id.org/jeswr/a2a-rdf/v1/spec.js\nconst w = 4;";
    const clean = sanitizeJs(dirty, ROOT);
    expect(clean).toContain("// https://w3id.org/jeswr/a2a-rdf/v1/spec.js");
  });

  it("does not false-fail on prose comments that merely mention a host path", () => {
    const dirty = "// the cache lives under /var/tmp on the box\nconst v = 5;";
    expect(() => sanitizeJs(dirty, ROOT)).not.toThrow();
  });
});

describe("sanitizeMap — sources[] relativised, sourceRoot cleared + validated", () => {
  it("relativises absolute sources[] to package-relative labels", () => {
    const map = {
      version: 3,
      sources: [`${ROOT}/src/canonical.ts`, `${ROOT}/node_modules/n3/src/parse.ts`],
      sourcesContent: ["a", "b"],
    };
    const out = sanitizeMap(map, ROOT);
    expect(out.sources).toEqual(["src/canonical.ts", "node_modules/n3/src/parse.ts"]);
    // sourcesContent (inlined bodies) is untouched.
    expect(out.sourcesContent).toEqual(["a", "b"]);
  });

  it("resolves sources[] emitted RELATIVE to the map dir, then classifies", () => {
    const sourcesBase = `${ROOT}/dist`;
    const map = { version: 3, sources: ["../src/canonical.ts", "../node_modules/n3/src/x.ts"] };
    const out = sanitizeMap(map, ROOT, sourcesBase);
    expect(out.sources).toEqual(["src/canonical.ts", "node_modules/n3/src/x.ts"]);
  });

  it("CLEARS a non-empty sourceRoot carrying a host path (the intended sanitisation)", () => {
    const map = {
      version: 3,
      sourceRoot: `${ROOT}/`,
      sources: [`${ROOT}/src/index.ts`],
    };
    const out = sanitizeMap(map, ROOT);
    expect(out.sourceRoot).toBe("");
    expect(out.sources).toEqual(["src/index.ts"]);
  });

  it("VALIDATES sources[] — a residual host path that can't be reduced FAILS", () => {
    // A source that escapes the root and has no node_modules anchor stays an absolute
    // host path → the guard rejects it rather than silently passing.
    const map = { version: 3, sources: ["/Users/someone/outside/orphan.ts"] };
    expect(() => sanitizeMap(map, ROOT)).toThrow(/host path/);
  });

  it("leaves a missing/empty sources[] and absent sourceRoot alone (no throw)", () => {
    expect(() => sanitizeMap({ version: 3 }, ROOT)).not.toThrow();
  });
});

describe("classifier is OS-agnostic + segment-exact (Windows-style backslash paths)", () => {
  it("reduces an OUTSIDE-root dependency with backslash separators to node_modules/…", () => {
    // Absolute path that ESCAPES the root, with a backslash-separated node_modules
    // segment as a Windows builder would emit. The outside-root branch POSIX-normalises
    // before anchoring on the last real node_modules segment.
    const p = "/other/store\\node_modules\\@jeswr\\fetch-rdf\\dist\\parse.js";
    expect(pkgRelativePath(p, ROOT)).toBe("node_modules/@jeswr/fetch-rdf/dist/parse.js");
  });

  it("reduces a Windows drive-letter dependency path to node_modules/…", () => {
    const p = "C:\\Users\\x\\proj\\node_modules\\pkg\\dist\\x.js";
    expect(pkgRelativePath(p, ROOT)).toBe("node_modules/pkg/dist/x.js");
  });

  it("FAILS the sources[] guard on a Windows-style residual host path (no node_modules anchor)", () => {
    const map = { version: 3, sources: ["C:\\Users\\someone\\orphan.ts"] };
    expect(() => sanitizeMap(map, ROOT)).toThrow(/host path/);
  });

  it("FAILS the banner guard on a Windows-style residual host path (with extension)", () => {
    const dirty = "// C:\\Users\\someone\\orphan.js\nconst q = 1;";
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/host path|absolute-path module banner/);
  });

  it("FAILS the banner guard on an unclassifiable Windows banner (drive prefix, no extension)", () => {
    const dirty = "// C:\\Users\\someone\\weird-entry\nconst z = 3;";
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/absolute-path module banner|host path/);
  });

  it("FAILS the sources[] guard on a BARE drive-letter path with NO Unix segment", () => {
    // `D:\a\repo\orphan.ts` -> `D:/a/repo/orphan.ts`: matches no forbidden Unix prefix,
    // but ANY drive-qualified absolute path is a host path and must be rejected.
    const map = { version: 3, sources: ["D:\\a\\repo\\orphan.ts"] };
    expect(() => sanitizeMap(map, ROOT)).toThrow(/host path/);
  });

  it("FAILS the banner guard on a BARE drive-letter banner with NO Unix segment (with extension)", () => {
    const dirty = "// D:\\a\\repo\\orphan.js\nconst d = 1;";
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/host path|absolute-path module banner/);
  });

  it("FAILS the banner guard on a BARE drive-letter banner with NO Unix segment (no extension)", () => {
    const dirty = "// D:\\a\\repo\\orphan\nconst e = 2;";
    expect(() => sanitizeJs(dirty, ROOT)).toThrow(/absolute-path module banner|host path/);
  });

  it("segment-exact: a `foonode_modules/…` substring is NOT treated as a dep marker", () => {
    // Own source under a dir literally named `foonode_modules` has no real node_modules
    // SEGMENT, so it stays own source rather than being sliced at the fake marker.
    const root = "/Users/x/proj";
    const own = `${root}/foonode_modules/thing.ts`;
    expect(pkgRelativePath(own, root)).toBe("foonode_modules/thing.ts");
  });
});
