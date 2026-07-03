// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8
//
// Regression guard for the @solid/reactive-authentication 0.1.5 migration.
//
// From 0.1.5 the package ROOT no longer registers the <authorization-code-flow>
// custom element as an import side-effect — the "/registerElements" subpath does.
// session-context.tsx renders <authorization-code-flow> and drives its `getCode`,
// so it MUST explicitly import the subpath or the element never upgrades and
// interactive login silently breaks. This test pins both halves of that contract:
//   (a) importing "@solid/reactive-authentication/registerElements" defines the
//       <authorization-code-flow> custom element; and
//   (b) session-context.tsx references that exact subpath specifier.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("@solid/reactive-authentication/registerElements", () => {
  it("defines the <authorization-code-flow> custom element as a side-effect", async () => {
    // Not registered until the subpath is imported.
    await import("@solid/reactive-authentication/registerElements");
    const ctor = customElements.get("authorization-code-flow");
    expect(typeof ctor).toBe("function");
  });

  it("session-context.tsx imports the /registerElements side-effect subpath", () => {
    // Resolve from the repo root (vitest cwd) — under jsdom `import.meta.url` is
    // not a file: URL, so anchor on process.cwd() instead.
    const src = readFileSync(
      join(process.cwd(), "src/lib/session-context.tsx"),
      "utf8",
    );
    expect(src).toContain("@solid/reactive-authentication/registerElements");
  });
});
