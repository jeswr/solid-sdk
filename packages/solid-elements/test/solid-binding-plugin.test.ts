// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Unit tests for the Custom Elements Manifest analyzer plugin (solidBindingPlugin):
// the suite `@solid-*` binding-tag → manifest mapping, the no-op-when-absent
// contract (chrome elements), the fail-closed validation, and the Lit `state:
// true` stripping. The plugin is the codegen-framework #11 §5 class→element
// binding edge; this pins its behaviour so a future change can't silently break
// the manifest pipeline.

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
interface ModuleDoc {
  kind: string;
  path: string;
  declarations: ClassDoc[];
}

/**
 * Run the plugin's analyze + module-link phases over a source string, simulating
 * the analyzer: the core would already have created the classDoc(s) in moduleDoc,
 * so we seed `declarations` with a classDoc per class (plus any attributes/members
 * the core would have emitted), then let the plugin enrich/clean them.
 */
function runPlugin(
  source: string,
  seedDeclarations: ClassDoc[],
  path = "test-module.ts",
): ModuleDoc {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const moduleDoc: ModuleDoc = { kind: "javascript-module", path, declarations: seedDeclarations };
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
