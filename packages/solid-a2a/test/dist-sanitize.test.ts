// AUTHORED-BY Claude Fable 5
import { describe, expect, it } from "vitest";
// The dist sanitiser is a build-time ESM script (no types); import it directly.
// @ts-expect-error — untyped .mjs build script, exercised at runtime only.
import { pkgRelativePath, sanitizeJs } from "../scripts/sanitize-dist.mjs";

describe("dist sanitiser — space-in-path leak (the guard must not be defeatable by a space)", () => {
  it("normalises a dep banner whose absolute path contains a SPACE", () => {
    const dirty = [
      "// ../../../../Users/Jesse Wright/Documents/GitHub/jeswr/pkg/node_modules/@jeswr/fetch-rdf/dist/parse.js",
      "export const x = 1;",
    ].join("\n");
    const clean = sanitizeJs(dirty);
    expect(clean).toContain("// node_modules/@jeswr/fetch-rdf/dist/parse.js");
    expect(clean).not.toContain("/Users/");
    expect(clean).not.toContain("Jesse Wright");
  });

  it("normalises an OWN-SRC banner whose absolute path contains a SPACE", () => {
    const dirty = "// /Users/Jesse Wright/proj/src/registry.ts\nconst y = 2;";
    const clean = sanitizeJs(dirty);
    expect(clean).toContain("// src/registry.ts");
    expect(clean).not.toContain("/Users/");
    expect(clean).not.toContain("Jesse Wright");
  });

  it("FAILS the build on an unclassifiable absolute banner with a SPACE (no extension / no marker)", () => {
    const dirty = "// /Users/Jesse Wright/proj/weird-entry\nconst z = 3;";
    expect(() => sanitizeJs(dirty)).toThrow(/host path|absolute-path module banner/);
  });

  it("uses the LAST /src/ so a parent dir named src cannot leak (non-determinism guard)", () => {
    const p = "/Users/x/projects/src/nested/pkg/src/registry.ts";
    expect(pkgRelativePath(p)).toBe("src/registry.ts");
  });

  it("uses the LAST /node_modules/ so a nested install cannot leak", () => {
    const p = "/Users/x/node_modules/foo/node_modules/@jeswr/fetch-rdf/dist/parse.js";
    expect(pkgRelativePath(p)).toBe("node_modules/@jeswr/fetch-rdf/dist/parse.js");
  });

  it("leaves a URL-style banner comment untouched (not treated as a build path)", () => {
    const dirty = "// https://w3id.org/jeswr/a2a-rdf/v1/spec.js\nconst w = 4;";
    const clean = sanitizeJs(dirty);
    expect(clean).toContain("// https://w3id.org/jeswr/a2a-rdf/v1/spec.js");
  });

  it("does not false-fail on prose comments that merely mention a host path", () => {
    const dirty = "// the cache lives under /var/tmp on the box\nconst v = 5;";
    expect(() => sanitizeJs(dirty)).not.toThrow();
  });
});
