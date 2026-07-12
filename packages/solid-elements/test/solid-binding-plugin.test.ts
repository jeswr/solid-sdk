// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Unit tests for the Custom Elements Manifest analyzer plugin (solidBindingPlugin):
// the suite `@solid-*` binding-tag → manifest mapping, the no-op-when-absent
// contract (chrome elements), the fail-closed validation, the Lit `state: true`
// stripping, and the type-only-export stripping (so a codegen tool never emits an
// invalid VALUE import for an erased type). The plugin is the codegen-framework
// #11 §5 class→element binding edge; this pins its behaviour so a future change
// can't silently break the manifest pipeline.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS plugin module (no .d.ts); imported for test only.
import { solidBindingPlugin } from "../scripts/cem/solid-binding-plugin.mjs";

interface ClassDoc {
  kind: string;
  name: string;
  attributes?: { name: string }[];
  members?: { name: string }[];
  solid?: Record<string, string>;
}
interface ExportDoc {
  kind: string;
  name: string;
}
interface ModuleDoc {
  kind: string;
  path: string;
  declarations: ClassDoc[];
  exports?: ExportDoc[];
}

/**
 * Run the plugin's analyze + module-link phases over a source string, simulating
 * the analyzer: the core would already have created the classDoc(s) in moduleDoc,
 * so we seed `declarations` with a classDoc per class (plus any attributes/members
 * the core would have emitted) and, optionally, the `exports` the core would have
 * emitted (every named re-export as a `kind: js` export — including the type-only
 * ones the core can't distinguish), then let the plugin enrich/clean them.
 */
function runPlugin(
  source: string,
  seedDeclarations: ClassDoc[],
  path = "test-module.ts",
  seedExports?: ExportDoc[],
): ModuleDoc {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const moduleDoc: ModuleDoc = { kind: "javascript-module", path, declarations: seedDeclarations };
  if (seedExports) moduleDoc.exports = seedExports;
  const plugin = solidBindingPlugin();

  const visit = (node: ts.Node): void => {
    plugin.analyzePhase({ ts, node, moduleDoc });
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  plugin.moduleLinkPhase?.({ moduleDoc });
  return moduleDoc;
}

describe("solidBindingPlugin — @solid-* binding tags", () => {
  it("maps all four tags onto a `solid` block on the matching classDoc", () => {
    const source = `
      /**
       * A bookmark editor.
       * @solid-class https://w3id.org/jeswr/sectors/bookmarks#Bookmark
       * @solid-shape https://w3id.org/jeswr/shapes#BookmarkShape
       * @solid-mode edit
       * @solid-cardinality container
       */
      export class BookmarkEditor extends LitElement {}
    `;
    const out = runPlugin(source, [{ kind: "class", name: "BookmarkEditor" }]);
    expect(out.declarations[0].solid).toEqual({
      class: "https://w3id.org/jeswr/sectors/bookmarks#Bookmark",
      shape: "https://w3id.org/jeswr/shapes#BookmarkShape",
      mode: "edit",
      cardinality: "container",
    });
  });

  it("writes only the keys that were present (partial annotation)", () => {
    const source = `
      /**
       * @solid-class https://w3id.org/jeswr/sectors/bookmarks#Bookmark
       * @solid-mode view
       */
      export class BookmarkView extends LitElement {}
    `;
    const out = runPlugin(source, [{ kind: "class", name: "BookmarkView" }]);
    expect(out.declarations[0].solid).toEqual({
      class: "https://w3id.org/jeswr/sectors/bookmarks#Bookmark",
      mode: "view",
    });
  });

  it("no-ops cleanly when no suite tags are present (the chrome-element case)", () => {
    const source = `
      /**
       * A theme toggle.
       * @csspart button - The button.
       * @fires theme-change - The theme changed.
       */
      export class JeswrThemeToggle extends LitElement {}
    `;
    const out = runPlugin(source, [{ kind: "class", name: "JeswrThemeToggle" }]);
    expect(out.declarations[0].solid).toBeUndefined();
  });

  it("no-ops when the class has no JSDoc block at all", () => {
    const out = runPlugin("export class Bare extends LitElement {}", [
      { kind: "class", name: "Bare" },
    ]);
    expect(out.declarations[0].solid).toBeUndefined();
  });

  it("rejects a non-http(s) IRI for @solid-class (fail-closed)", () => {
    const source = `
      /** @solid-class urn:not:http */
      export class Bad extends LitElement {}
    `;
    expect(() => runPlugin(source, [{ kind: "class", name: "Bad" }])).toThrow(
      /not an http\(s\) IRI/,
    );
  });

  it("rejects an unknown @solid-mode value", () => {
    const source = `
      /** @solid-mode sideways */
      export class Bad extends LitElement {}
    `;
    expect(() => runPlugin(source, [{ kind: "class", name: "Bad" }])).toThrow(
      /must be one of view \| edit/,
    );
  });

  it("rejects an unknown @solid-cardinality value", () => {
    const source = `
      /** @solid-cardinality many */
      export class Bad extends LitElement {}
    `;
    expect(() => runPlugin(source, [{ kind: "class", name: "Bad" }])).toThrow(
      /must be one of one \| container/,
    );
  });

  it("rejects a suite tag with no value", () => {
    const source = `
      /** @solid-class */
      export class Bad extends LitElement {}
    `;
    expect(() => runPlugin(source, [{ kind: "class", name: "Bad" }])).toThrow(/has no value/);
  });

  it("rejects conflicting values for the same tag", () => {
    const source = `
      /**
       * @solid-mode view
       * @solid-mode edit
       */
      export class Bad extends LitElement {}
    `;
    expect(() => runPlugin(source, [{ kind: "class", name: "Bad" }])).toThrow(/conflicting/);
  });

  it("does not attach when no matching classDoc exists (non-exported helper)", () => {
    const source = `
      /** @solid-mode view */
      export class HasNoDoc extends LitElement {}
    `;
    const out = runPlugin(source, []); // no seeded declarations
    expect(out.declarations).toHaveLength(0);
  });
});

describe("solidBindingPlugin — Lit state stripping", () => {
  it("strips `state: true` reactive props from attributes + members", () => {
    const source = `
      export class WithState extends LitElement {
        static properties = {
          repo: { type: String, reflect: true },
          _open: { state: true },
          _phase: { state: true },
        };
      }
    `;
    const out = runPlugin(source, [
      {
        kind: "class",
        name: "WithState",
        attributes: [{ name: "repo" }, { name: "_open" }, { name: "_phase" }],
        members: [{ name: "repo" }, { name: "_open" }, { name: "_phase" }],
      },
    ]);
    expect(out.declarations[0].attributes?.map((a) => a.name)).toEqual(["repo"]);
    expect(out.declarations[0].members?.map((m) => m.name)).toEqual(["repo"]);
  });

  it("keeps a non-state property even if its name starts with underscore-like config", () => {
    const source = `
      export class OnlyPublic extends LitElement {
        static properties = {
          label: { type: String, reflect: true },
        };
      }
    `;
    const out = runPlugin(source, [
      {
        kind: "class",
        name: "OnlyPublic",
        attributes: [{ name: "label" }],
        members: [{ name: "label" }],
      },
    ]);
    expect(out.declarations[0].attributes?.map((a) => a.name)).toEqual(["label"]);
  });
});

describe("solidBindingPlugin — type-only export stripping", () => {
  it("strips inline `export { type X }` symbols, keeps the value exports", () => {
    // The core analyzer can't tell a type-only re-export from a value one, so it
    // would emit BOTH as `kind: js`. Seed exactly that, then assert the plugin
    // drops the erased types and keeps the runtime values.
    const source = `
      export { JeswrLoginPanel, type LoginDetail, type SessionChangeDetail } from "./login-panel.js";
    `;
    const out = runPlugin(source, [], "src/index.ts", [
      { kind: "js", name: "JeswrLoginPanel" },
      { kind: "js", name: "LoginDetail" },
      { kind: "js", name: "SessionChangeDetail" },
    ]);
    expect(out.exports?.map((e) => e.name)).toEqual(["JeswrLoginPanel"]);
  });

  it("strips a whole `export type { … }` declaration's symbols", () => {
    const source = `
      export type { LoginController, RestoreOutcome } from "./login-controller.js";
      export { sameWebId } from "./login-controller.js";
    `;
    const out = runPlugin(source, [], "src/index.ts", [
      { kind: "js", name: "LoginController" },
      { kind: "js", name: "RestoreOutcome" },
      { kind: "js", name: "sameWebId" },
    ]);
    expect(out.exports?.map((e) => e.name)).toEqual(["sameWebId"]);
  });

  it("handles `as`-aliased type-only exports by the LOCAL exported name", () => {
    const source = `
      export { foo, type Bar as Baz } from "./m.js";
    `;
    const out = runPlugin(source, [], "src/index.ts", [
      { kind: "js", name: "foo" },
      { kind: "js", name: "Baz" },
    ]);
    expect(out.exports?.map((e) => e.name)).toEqual(["foo"]);
  });

  it("leaves a pure value `export { … }` untouched (no false strips)", () => {
    const source = `
      export { applyResolvedTheme, nextTheme, THEME_DARK_CLASS } from "./theme-core.js";
    `;
    const out = runPlugin(source, [], "src/index.ts", [
      { kind: "js", name: "applyResolvedTheme" },
      { kind: "js", name: "nextTheme" },
      { kind: "js", name: "THEME_DARK_CLASS" },
    ]);
    expect(out.exports?.map((e) => e.name)).toEqual([
      "applyResolvedTheme",
      "nextTheme",
      "THEME_DARK_CLASS",
    ]);
  });
});

// Integration guard: the COMMITTED manifest's `kind: js` exports for the barrel
// must match the ACTUAL runtime exports of the built `dist/index.js` exactly — so
// the manifest never advertises a type-only symbol as a runtime (value) import,
// and never omits a real runtime export. This is the roborev-Medium regression
// pinned against ground truth (the emitted JS), not just the plugin's logic.
describe("custom-elements.json — kind:js exports match dist runtime", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");

  const manifest = JSON.parse(readFileSync(join(root, "custom-elements.json"), "utf8")) as {
    modules: { path: string; exports?: { kind: string; name: string }[] }[];
  };
  const barrel = manifest.modules.find((m) => m.path === "src/index.ts");
  const manifestJsNames = (barrel?.exports ?? [])
    .filter((e) => e.kind === "js")
    .map((e) => e.name)
    .sort();

  // The known type-only symbols re-exported by the barrel (`export type` / inline
  // `type X`). None may appear as a `kind: js` export.
  const TypeOnly = [
    "FeedbackCategory",
    "FeedbackDiagnostics",
    "FeedbackPayload",
    "FeedbackSubmitResult",
    "LoginController",
    "LoginDetail",
    "LoginResult",
    "RecentLoginAccount",
    "ResolvedTheme",
    "RestoreOutcome",
    "SavingState",
    "SessionChangeDetail",
    "Theme",
  ];

  it("declares a barrel module in the manifest", () => {
    expect(barrel).toBeDefined();
    expect(manifestJsNames.length).toBeGreaterThan(0);
  });

  it("advertises NO type-only symbol as a `kind: js` export", () => {
    const leaked = TypeOnly.filter((name) => manifestJsNames.includes(name));
    expect(leaked).toEqual([]);
  });

  it("advertises a real runtime value (the JeswrLoginPanel class) as `kind: js`", () => {
    expect(manifestJsNames).toContain("JeswrLoginPanel");
    // and a runtime function/const from the same modules the types live in
    expect(manifestJsNames).toContain("sameWebId");
    expect(manifestJsNames).toContain("applyResolvedTheme");
  });

  it("matches the actual runtime exports of dist/index.js exactly (set equality)", async () => {
    // The built artifact is the ground truth: a symbol is a runtime export iff it
    // is present here. `dist/` is committed (GitHub-installable), so it exists.
    const mod = (await import(join(root, "dist", "index.js"))) as Record<string, unknown>;
    const runtimeNames = Object.keys(mod).sort();
    expect(manifestJsNames).toEqual(runtimeNames);
  });
});
