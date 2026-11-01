// AUTHORED-BY Claude Fable
//
// COMPOSITE PER-NODE VIEWS — the derivation (`deriveNodeViews`), the emitted
// model.js / model.d.ts surface, and an EXECUTION test that writes the emitted
// model.js to a repo-local temp dir, imports it, and drives the per-node Wrapper
// handles against a real composite document (typed reads, guarded writes, the
// fragment-correct subject()). The per-node views exist to delete hand-written
// per-node wrapper files (solid-listening's src/nodes.ts) — so the execution test
// exercises exactly what such a file provided.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ModelManifest, validateManifest } from "@jeswr/model-runtime";
import { DataFactory } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CodegenConfig,
  compileManifest,
  deriveNodeViews,
  emitModelDts,
  emitModelJs,
  parseShapes,
} from "../../src/index.js";

const EX = "https://ex.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const SHAPES_BASE = "https://ex.org/shapes#";

// A minimal two-node composite (Parent → Child), mirroring composite-generator.test.ts.
const SHAPES = `
  @prefix sh:  <http://www.w3.org/ns/shacl#> .
  @prefix ex:  <${EX}> .
  @prefix xsd: <${XSD}> .
  ex:ParentShape a sh:NodeShape ; sh:targetClass ex:Parent ;
    sh:property [ sh:path ex:child ; sh:name "child" ; sh:nodeKind sh:IRI ; sh:class ex:Child ;
      sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] ;
    sh:property [ sh:path ex:note ; sh:name "note" ; sh:datatype xsd:string ; sh:maxCount 1 ] .
  ex:ChildShape a sh:NodeShape ; sh:targetClass ex:Child ;
    sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype xsd:string ;
      sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] .
`;
const shapes = parseShapes(SHAPES, SHAPES_BASE);

const CONFIG: CodegenConfig = {
  shapesBase: SHAPES_BASE,
  prefixes: { ex: EX, xsd: XSD },
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "parent",
      nodes: {
        parent: {
          targetClass: `${EX}Parent`,
          fragment: "it",
          fields: { note: {} },
          links: { child: "child" },
        },
        child: {
          targetClass: `${EX}Child`,
          fragment: "child",
          fields: { label: {} },
        },
      },
    },
  ],
};

const { manifest } = compileManifest(shapes, CONFIG);

describe("deriveNodeViews — the pure projection", () => {
  it("returns undefined for a manifest with no composite entity", () => {
    const flatOnly = validateManifest({
      manifestVersion: 1,
      runtime: manifest.runtime,
      prefixes: { ex: EX },
      entities: [
        {
          name: "Thing",
          typeIris: [`${EX}Thing`],
          subject: { convention: "hash-it" },
          fields: [
            { name: "note", predicate: `${EX}note`, kind: "literal", datatype: `${XSD}string` },
          ],
        },
      ],
    });
    expect(deriveNodeViews(flatOnly)).toBeUndefined();
  });

  it("derives one FLAT view entity per composite node, with the node's types", () => {
    const views = deriveNodeViews(manifest);
    expect(views).toBeDefined();
    const names = views?.manifest.entities.map((e) => e.name);
    expect(names).toEqual(["TreeParentNode", "TreeChildNode"]);
    for (const e of views?.manifest.entities ?? []) expect(e.kind ?? "flat").toBe("flat");
    const parent = views?.manifest.entities.find((e) => e.name === "TreeParentNode");
    expect(parent && "typeIris" in parent && parent.typeIris).toEqual([`${EX}Parent`]);
  });

  it("projects a nested link as a plain IRI field, carrying the fail-closed MUST", () => {
    const views = deriveNodeViews(manifest);
    const parent = views?.manifest.entities.find((e) => e.name === "TreeParentNode");
    const fields = parent && "fields" in parent ? parent.fields : [];
    const link = fields.find((f) => f.name === "child");
    expect(link?.kind).toBe("iri");
    expect(link?.guards?.requiredFailClosed).toBe(true);
    // No `node` reference survives the projection (the view is a flat entity).
    expect(link && "node" in link ? link.node : undefined).toBeUndefined();
    // The flat field is carried verbatim.
    const note = fields.find((f) => f.name === "note");
    expect(note?.kind).toBe("literal");
    expect(note?.datatype).toBe(`${XSD}string`);
  });

  it("builds a deterministic composite → node → view index", () => {
    const views = deriveNodeViews(manifest);
    expect(views?.index).toEqual({
      Tree: {
        parent: { entity: "TreeParentNode", fragment: "it", typeIri: `${EX}Parent` },
        child: { entity: "TreeChildNode", fragment: "child", typeIri: `${EX}Child` },
      },
    });
  });

  it("rejects a view name colliding with a manifest entity name, fail-closed", () => {
    const collidingShapes = parseShapes(
      `${SHAPES}
      ex:OtherShape a sh:NodeShape ; sh:targetClass ex:Other ;
        sh:property [ sh:path ex:note ; sh:name "note" ; sh:datatype xsd:string ; sh:maxCount 1 ] .`,
      SHAPES_BASE,
    );
    const config: CodegenConfig = {
      ...CONFIG,
      entities: [
        {
          name: "TreeParentNode",
          targetClass: `${EX}Other`,
          subject: { convention: "hash-it" },
        },
        ...CONFIG.entities,
      ],
    };
    const { manifest: colliding } = compileManifest(collidingShapes, config);
    expect(() => deriveNodeViews(colliding)).toThrow(/collides with a manifest entity name/);
  });

  it("rejects two nodes whose capitalised names collide, fail-closed", () => {
    // cap("aB") === cap("AB") === "AB" — both nodes would mint "TABNode".
    const twoNodes: ModelManifest = validateManifest({
      manifestVersion: 1,
      runtime: manifest.runtime,
      prefixes: { ex: EX },
      entities: [
        {
          name: "T",
          kind: "composite",
          root: "aB",
          nodes: [
            {
              name: "aB",
              typeIris: [`${EX}A`],
              fragment: "it",
              fields: [{ name: "toAb", predicate: `${EX}to`, kind: "nested", node: "AB" }],
            },
            {
              name: "AB",
              typeIris: [`${EX}B`],
              fragment: "ab",
              fields: [
                { name: "lbl", predicate: `${EX}lbl`, kind: "literal", datatype: `${XSD}string` },
              ],
            },
          ],
        },
      ],
    });
    expect(() => deriveNodeViews(twoNodes)).toThrow(/collides with another node view/);
  });

  it("the derived manifest passes the runtime's own fail-closed validateManifest", () => {
    const views = deriveNodeViews(manifest);
    // deriveNodeViews already validates; re-validate here as an explicit assertion.
    expect(() => validateManifest(views?.manifest)).not.toThrow();
  });
});

describe("emitted model.js / model.d.ts — the per-node surface", () => {
  const views = deriveNodeViews(manifest);

  it("model.js inlines the view manifest + index and exports `nodes`", () => {
    const js = emitModelJs(manifest, views);
    expect(js).toContain("const nodeViewsManifest = {");
    expect(js).toContain("const nodeViewIndex = {");
    expect(js).toContain("const nodeViews = defineModel(nodeViewsManifest);");
    expect(js).toContain("export const nodes = Object.freeze(");
    expect(js).toContain('"TreeParentNode"');
  });

  it("model.js without node views exports a frozen empty `nodes` (uniform surface)", () => {
    const js = emitModelJs(manifest);
    expect(js).toContain("export const nodes = Object.freeze({});");
    expect(js).not.toContain("nodeViewsManifest");
  });

  it("model.d.ts declares the handle generic, per-node Wrapper interfaces and `nodes`", () => {
    const dts = emitModelDts(manifest, views);
    expect(dts).toContain("export interface CompositeNodeHandle<W extends EntityWrapper>");
    expect(dts).toContain("export interface TreeParentNodeWrapper extends EntityWrapper");
    expect(dts).toContain("export interface TreeChildNodeWrapper extends EntityWrapper");
    // The nested link surfaces as an IRI accessor; the flat literal keeps its type.
    const parentBlock = dts.slice(
      dts.indexOf("export interface TreeParentNodeWrapper"),
      dts.indexOf("export interface TreeChildNodeWrapper"),
    );
    expect(parentBlock).toContain('"child"?: string;');
    expect(parentBlock).toContain('"note"?: string;');
    expect(dts).toContain("export declare const nodes: {");
    expect(dts).toContain('readonly "Tree": {');
    expect(dts).toContain('readonly "parent": CompositeNodeHandle<TreeParentNodeWrapper>;');
    expect(dts).toContain('readonly "child": CompositeNodeHandle<TreeChildNodeWrapper>;');
  });

  it("model.d.ts without composites declares an empty `nodes`", () => {
    const dts = emitModelDts(manifest);
    expect(dts).toContain("export declare const nodes: Readonly<Record<string, never>>;");
    expect(dts).not.toContain("CompositeNodeHandle");
  });
});

describe("EXECUTION — the emitted per-node handles drive a real composite document", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Repo-local temp dir so the imported model.js resolves @jeswr/model-runtime
  // through the repo's node_modules (gitignored via test/**/.tmp-*).
  const tmp = mkdtempSync(join(here, ".tmp-node-views-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const views = deriveNodeViews(manifest);
  const modelJsPath = join(tmp, "model.js");
  writeFileSync(modelJsPath, emitModelJs(manifest, views));

  const resourceUrl = "https://pod.example/scrobbles/1.ttl";

  it("imports; handles expose name/typeIri/fragment and a fragment-correct subject()", async () => {
    const mod = await import(pathToFileURL(modelJsPath).href);
    const child = mod.nodes.Tree.child;
    expect(child.name).toBe("child");
    expect(child.typeIri).toBe(`${EX}Child`);
    expect(child.fragment).toBe("child");
    expect(child.subject(resourceUrl)).toBe(`${resourceUrl}#child`);
    expect(mod.nodes.Tree.parent.subject(resourceUrl)).toBe(`${resourceUrl}#it`);
  });

  it("a node Wrapper reads + writes typed values on the composite's own document", async () => {
    const mod = await import(pathToFileURL(modelJsPath).href);
    const store = mod.entities.Tree.build(resourceUrl, { note: "n", label: "L" });

    const child = new mod.nodes.Tree.child.Wrapper(
      mod.nodes.Tree.child.subject(resourceUrl),
      store,
      DataFactory,
    );
    expect(child.isInstance).toBe(true);
    expect(child.label).toBe("L");

    // A typed write goes through the audited runtime accessor and is visible to the
    // composite's parse (same document, same guard stack).
    child.label = "M";
    expect(mod.entities.Tree.parse(resourceUrl, store)?.label).toBe("M");

    // The nested link surfaces as an IRI accessor on the parent node's view.
    const parent = new mod.nodes.Tree.parent.Wrapper(
      mod.nodes.Tree.parent.subject(resourceUrl),
      store,
      DataFactory,
    );
    expect(parent.child).toBe(`${resourceUrl}#child`);
    expect(parent.note).toBe("n");
  });

  it("the runtime guard stack is live on view writes (control chars sanitized)", async () => {
    const mod = await import(pathToFileURL(modelJsPath).href);
    const store = mod.entities.Tree.build(resourceUrl, { note: "n", label: "L" });
    const child = new mod.nodes.Tree.child.Wrapper(
      mod.nodes.Tree.child.subject(resourceUrl),
      store,
      DataFactory,
    );
    child.label = "bad\u0000\u0007label";
    expect(child.label).toBe("badlabel");
  });

  it("mark() stamps the node's type on a fresh subject", async () => {
    const mod = await import(pathToFileURL(modelJsPath).href);
    const store = mod.entities.Tree.build(resourceUrl, { note: "n", label: "L" });
    const other = new mod.nodes.Tree.child.Wrapper(
      "https://pod.example/scrobbles/other#child",
      store,
      DataFactory,
    );
    expect(other.isInstance).toBe(false);
    other.mark();
    expect(other.isInstance).toBe(true);
    expect(other.types.has(`${EX}Child`)).toBe(true);
  });
});
