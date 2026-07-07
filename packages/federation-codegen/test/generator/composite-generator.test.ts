// AUTHORED-BY Claude Opus 4.8
//
// Phase-M generator unit tests — sh:node parsing (the shapes-parser link support) and
// the composite compile's FAIL-CLOSED config validation (a config that would mint an
// unsound or untraceable composite is rejected before any manifest is emitted).
import { describe, expect, it } from "vitest";
import { type CodegenConfig, compileManifest, parseShapes } from "../../src/index.js";

const EX = "https://ex.org/";
const SHAPES_BASE = "https://ex.org/shapes#";

describe("shapes parser — sh:node link support", () => {
  it("captures a sh:node NamedNode reference on a property shape", () => {
    const ttl = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix ex:  <${EX}> .
      ex:ParentShape a sh:NodeShape ; sh:targetClass ex:Parent ;
        sh:property [ sh:path ex:child ; sh:name "child" ; sh:nodeKind sh:IRI ;
          sh:node ex:ChildShape ; sh:minCount 1 ; sh:maxCount 1 ] .
      ex:ChildShape a sh:NodeShape ; sh:targetClass ex:Child ;
        sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype <http://www.w3.org/2001/XMLSchema#string> ] .
    `;
    const shapes = parseShapes(ttl, SHAPES_BASE);
    const parent = shapes.nodeShapes.find((s) => s.targetClass === `${EX}Parent`);
    const child = parent?.properties.find((p) => p.name === "child");
    expect(child?.node).toBe(`${EX}ChildShape`);
    expect(child?.kind).toBe("iri"); // an sh:node reference is an IRI-valued link
  });
});

// A minimal two-node composite (Parent → Child) used to exercise the config errors.
const SHAPES = `
  @prefix sh:  <http://www.w3.org/ns/shacl#> .
  @prefix ex:  <${EX}> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  ex:ParentShape a sh:NodeShape ; sh:targetClass ex:Parent ;
    sh:property [ sh:path ex:child ; sh:name "child" ; sh:nodeKind sh:IRI ; sh:class ex:Child ;
      sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] ;
    sh:property [ sh:path ex:note ; sh:name "note" ; sh:datatype xsd:string ; sh:maxCount 1 ] .
  ex:ChildShape a sh:NodeShape ; sh:targetClass ex:Child ;
    sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype xsd:string ;
      sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] .
`;
const shapes = parseShapes(SHAPES, SHAPES_BASE);

function config(mutate: (c: CodegenConfig) => void): CodegenConfig {
  const c: CodegenConfig = {
    shapesBase: SHAPES_BASE,
    prefixes: { ex: EX, xsd: "http://www.w3.org/2001/XMLSchema#" },
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
  mutate(c);
  return c;
}

const composite = () => config(() => {});
const tree = (c: CodegenConfig) =>
  c.entities[0] as {
    name: string;
    root: string;
    nodes: Record<
      string,
      {
        targetClass: string;
        fragment: string;
        fields?: Record<string, unknown>;
        links?: Record<string, string>;
      }
    >;
  };

describe("composite compile — accepts a well-formed composite", () => {
  it("compiles the Parent → Child composite (one entity, two nodes)", () => {
    const { manifest } = compileManifest(shapes, composite());
    expect(manifest.entities).toHaveLength(1);
    const tree0 = manifest.entities[0];
    if (tree0?.kind !== "composite") throw new Error("expected composite");
    expect(tree0.nodes.map((n) => n.name).sort()).toEqual(["child", "parent"]);
    const parent = tree0.nodes.find((n) => n.name === "parent");
    const childLink = parent?.fields.find((f) => f.name === "child");
    expect(childLink?.kind).toBe("nested");
    expect(childLink?.guards?.requiredFailClosed).toBe(true); // Violation link
  });
});

describe("composite compile — FAIL-CLOSED config validation", () => {
  const bad: Array<[string, (c: CodegenConfig) => void, RegExp]> = [
    [
      "root not a declared node",
      (c) => {
        tree(c).root = "ghost";
      },
      /root "ghost" is not a declared node/,
    ],
    [
      "a link targeting an unknown node",
      (c) => {
        (tree(c).nodes.parent as { links: Record<string, string> }).links = { child: "ghost" };
      },
      /targets unknown node "ghost"/,
    ],
    [
      "a link on a non-IRI (literal) property",
      (c) => {
        (tree(c).nodes.parent as { links: Record<string, string> }).links = {
          child: "child",
          note: "child",
        };
      },
      /links non-IRI property "note"|projects "note"|more than one incoming/,
    ],
    [
      "a field also declared as a link",
      (c) => {
        const parent = tree(c).nodes.parent as {
          fields: Record<string, unknown>;
          links: Record<string, string>;
        };
        parent.fields = { child: {} };
        parent.links = { child: "child" };
      },
      /both a field and a link/,
    ],
    [
      "a field the shape does not declare",
      (c) => {
        (tree(c).nodes.parent as { fields: Record<string, unknown> }).fields = { ghost: {} };
      },
      /configures unknown field "ghost"/,
    ],
    [
      "two nodes reusing a target class",
      (c) => {
        const t = tree(c);
        if (t.nodes.child) t.nodes.child.targetClass = `${EX}Parent`;
      },
      /reuses target class/,
    ],
    [
      "a node referencing a target class with no NodeShape",
      (c) => {
        // Add a node for a class that has NO shape (without orphaning a real shape).
        tree(c).nodes.ghost = { targetClass: `${EX}Ghost`, fragment: "ghost", fields: {} };
      },
      /with no NodeShape/,
    ],
    [
      "a non-identifier composite name",
      (c) => {
        tree(c).name = 'Evil"; type X = ';
      },
      /not a valid identifier/,
    ],
    [
      "two nodes emitting the same resolved field name (rename collision)",
      (c) => {
        const t = tree(c);
        (t.nodes.parent as { fields: Record<string, unknown> }).fields = {
          note: { rename: "dup" },
        };
        (t.nodes.child as { fields: Record<string, unknown> }).fields = {
          label: { rename: "dup" },
        };
      },
      /duplicate field name "dup"/,
    ],
  ];
  for (const [label, mutate, re] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => compileManifest(shapes, config(mutate))).toThrow(re);
    });
  }
});

describe("composite compile — a nested link MUST be single-valued", () => {
  it("rejects a link on a MULTI-VALUED (unbounded) property (set-valued links not yet supported)", () => {
    const multiShapes = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix ex:  <${EX}> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      ex:ParentShape a sh:NodeShape ; sh:targetClass ex:Parent ;
        sh:property [ sh:path ex:children ; sh:name "children" ; sh:nodeKind sh:IRI ; sh:class ex:Child ;
          sh:minCount 1 ] .
      ex:ChildShape a sh:NodeShape ; sh:targetClass ex:Child ;
        sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype xsd:string ;
          sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] .
    `;
    const sh = parseShapes(multiShapes, SHAPES_BASE);
    const cfg: CodegenConfig = {
      shapesBase: SHAPES_BASE,
      prefixes: { ex: EX, xsd: "http://www.w3.org/2001/XMLSchema#" },
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "parent",
          nodes: {
            parent: { targetClass: `${EX}Parent`, fragment: "it", links: { children: "child" } },
            child: { targetClass: `${EX}Child`, fragment: "child", fields: { label: {} } },
          },
        },
      ],
    };
    expect(() => compileManifest(sh, cfg)).toThrow(/multi-valued property "children"/);
  });

  it("rejects a link on a maxCount > 1 property", () => {
    const multiShapes = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix ex:  <${EX}> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      ex:ParentShape a sh:NodeShape ; sh:targetClass ex:Parent ;
        sh:property [ sh:path ex:children ; sh:name "children" ; sh:nodeKind sh:IRI ; sh:class ex:Child ;
          sh:minCount 1 ; sh:maxCount 3 ] .
      ex:ChildShape a sh:NodeShape ; sh:targetClass ex:Child ;
        sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype xsd:string ;
          sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] .
    `;
    const sh = parseShapes(multiShapes, SHAPES_BASE);
    const cfg: CodegenConfig = {
      shapesBase: SHAPES_BASE,
      prefixes: { ex: EX, xsd: "http://www.w3.org/2001/XMLSchema#" },
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "parent",
          nodes: {
            parent: { targetClass: `${EX}Parent`, fragment: "it", links: { children: "child" } },
            child: { targetClass: `${EX}Child`, fragment: "child", fields: { label: {} } },
          },
        },
      ],
    };
    expect(() => compileManifest(sh, cfg)).toThrow(
      /multi-valued property "children" \(maxCount 3\)/,
    );
  });
});
