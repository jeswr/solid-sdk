// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  ManifestError,
  type ManifestField,
  type ModelManifest,
  validateManifest,
} from "./index.js";

const EX = "https://example.org/enum#";
const DOC = "https://pod.test/doc";
const A = `${EX}manual`,
  B = `${EX}clinical`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
function manifest(set = false, required = false, aliases = false): ModelManifest {
  return {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: {},
    entities: [
      {
        name: "Summary",
        typeIris: [`${EX}Summary`],
        subject: { convention: "self" },
        fields: [
          {
            name: "source",
            predicate: `${EX}source`,
            kind: "iri",
            in: [A, B],
            ...(aliases ? { aliasPredicates: [`${EX}old`] } : {}),
            ...(set
              ? { collection: "set", minCount: required ? 1 : 0, maxCount: 2 }
              : { maxCount: 1 }),
            guards: { iriEnum: true, ...(required ? { requiredFailClosed: true } : {}) },
          },
        ],
      },
    ],
  };
}
function field(m: ModelManifest): ManifestField {
  const e = m.entities[0];
  if (!e || e.kind === "composite" || !e.fields[0]) throw new Error("missing field");
  return e.fields[0];
}
function entity(set = false, required = false, aliases = false) {
  const e = defineModel(manifest(set, required, aliases)).entities.Summary;
  if (!e) throw new Error("missing Summary");
  return e;
}
function data(objects: string, alias = false): Store {
  return new Store(
    new Parser().parse(
      `<${DOC}> a <${EX}Summary>; <${EX}${alias ? "old" : "source"}> ${objects} .`,
    ),
  );
}
const badWrites = [
  "https://example.org/outside",
  `${A} `,
  ` ${A}`,
  null,
  1,
  true,
  DataFactory.literal(A),
  DataFactory.namedNode(A),
  DataFactory.blankNode("manual"),
  { toString: () => A },
];

describe("ontology-derived IRI enums: strict writes and fail-closed reads", () => {
  for (const set of [false, true]) {
    it.each(
      badWrites,
    )(`build throws TypeError on an invalid supplied enum member (set=${set}): %j`, (value) => {
      expect(() => entity(set).build(DOC, { source: set ? [value] : value })).toThrow(TypeError);
    });
    it(`round-trips exact concept identities without concept rdf:type (set=${set})`, async () => {
      const e = entity(set, true);
      const value = set ? [A, A, B] : A;
      const ds = e.build(DOC, { source: value });
      expect(ds.countQuads(A, TYPE, null, null)).toBe(0);
      expect(e.parse(DOC, ds)).toEqual({ source: set ? [A, B] : A });
      expect(await e.parseDocument(DOC, await e.serialize(DOC, { source: value }))).toEqual({
        source: set ? [A, B] : A,
      });
    });
    for (const required of [false, true]) {
      it.each([
        `"${A}"`,
        `<${EX}outside>`,
        "_:manual",
      ])(`drops hostile raw %s (set=${set}, required=${required})`, (object) => {
        expect(entity(set, required).parse(DOC, data(object))).toEqual(required ? undefined : {});
      });
      it(`counts raw singleton/set cardinality and distinct RDF identities (set=${set}, required=${required})`, () => {
        const e = entity(set, required);
        expect(e.parse(DOC, data(`<${A}>, <${A}>`))).toEqual({ source: set ? [A] : A });
        expect(e.parse(DOC, data(`<${A}>, <${B}>`))).toEqual(
          set ? { source: [A, B] } : required ? undefined : {},
        );
        expect(e.parse(DOC, data(`<${A}>, <${EX}outside>`))).toEqual(
          set && !required ? { source: [A] } : required ? undefined : {},
        );
        expect(e.parse(DOC, data(`<${A}>, <${B}>, <${EX}outside>`))).toEqual(
          required ? undefined : {},
        );
      });
    }
  }

  it.each([A, null, new Set([A])])("rejects a non-array set build input: %j", (value) => {
    expect(() => entity(true).build(DOC, { source: value })).toThrow(TypeError);
  });

  it("omitted enum values preserve the existing build absence contract", () => {
    for (const set of [false, true]) {
      const e = entity(set, true);
      expect(() => e.build(DOC, {})).not.toThrow();
      expect(e.parse(DOC, e.build(DOC, {}))).toBeUndefined();
    }
  });

  it("undefined clears a singleton but is rejected as a supplied set member", () => {
    const e = entity();
    const ds = e.build(DOC, { source: A });
    const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { source?: string };
    w.source = undefined;
    expect(e.parse(DOC, ds)).toEqual({});
    expect(() => entity(true).build(DOC, { source: [undefined] })).toThrow(TypeError);
    const setEntity = entity(true);
    const setWrapper = new setEntity.Wrapper(
      DOC,
      setEntity.build(DOC, {}),
      DataFactory,
    ) as unknown as { source: Set<unknown> };
    expect(() => setWrapper.source.add(undefined)).toThrow(TypeError);
  });

  it("data-graph type assertions cannot extend a closed concept enumeration", () => {
    const e = entity(false, true);
    const ds = data(`<${EX}outside>`);
    ds.addQuad(
      DataFactory.namedNode(`${EX}outside`),
      DataFactory.namedNode(TYPE),
      DataFactory.namedNode(`${EX}Source`),
    );
    expect(e.parse(DOC, ds)).toBeUndefined();
  });

  it.each([
    false,
    true,
  ])("invalid setter/add preserves the store including aliases (aliases=%s)", (aliases) => {
    for (const set of [false, true]) {
      const e = entity(set, false, aliases);
      const ds = data(`<${A}>`, aliases);
      const before = [...ds];
      const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { source: string | Set<string> };
      expect(() => {
        if (set) (w.source as Set<string>).add(`${EX}outside`);
        else w.source = `${EX}outside`;
      }).toThrow(TypeError);
      expect([...ds]).toEqual(before);
    }
  });

  it("valid live-set add, delete, has and clear keep exact concept identities", () => {
    const e = entity(true);
    const ds = e.build(DOC, { source: [A] });
    const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { source: Set<string> };
    w.source.add(B).add(B);
    expect([...w.source]).toEqual([A, B]);
    expect(w.source.has(`${A} `)).toBe(false);
    expect(w.source.delete(A)).toBe(true);
    expect([...w.source]).toEqual([B]);
    w.source.clear();
    expect(w.source.size).toBe(0);
  });

  it("scheme guards preserve exact enumerated spellings and reject normalized lookalikes", () => {
    const m = manifest();
    const f = field(m);
    const exact = "https://EXAMPLE.org:443/manual";
    f.in = [exact];
    f.guards = { iriEnum: true, iriScheme: "https" };
    const e = defineModel(m).entities.Summary;
    expect(e?.parse(DOC, e.build(DOC, { source: exact }))).toEqual({ source: exact });
    expect(() => e?.build(DOC, { source: "https://example.org/manual" })).toThrow(TypeError);
  });

  it("legacy sh:in enum writes retain their documented drop-invalid behavior", () => {
    const m = manifest();
    delete field(m).guards?.iriEnum;
    const e = defineModel(m).entities.Summary;
    expect(e?.parse(DOC, e.build(DOC, { source: `${EX}outside` }))).toEqual({});
  });
});

describe("closed iriEnum manifest admission", () => {
  it.each([
    [
      "false guard",
      (f: ManifestField) => {
        Object.assign(f.guards ?? {}, { iriEnum: false });
      },
    ],
    [
      "string guard",
      (f: ManifestField) => {
        Object.assign(f.guards ?? {}, { iriEnum: "true" });
      },
    ],
    [
      "literal field",
      (f: ManifestField) => {
        f.kind = "literal";
        f.datatype = "xsd:string";
      },
    ],
    [
      "missing enum",
      (f: ManifestField) => {
        delete f.in;
      },
    ],
    [
      "empty enum",
      (f: ManifestField) => {
        f.in = [];
      },
    ],
    [
      "duplicate enum",
      (f: ManifestField) => {
        f.in = [A, A];
      },
    ],
    [
      "unsafe member",
      (f: ManifestField) => {
        f.in = ["https://example.org/a|b"];
      },
    ],
    [
      "non-IRI member",
      (f: ManifestField) => {
        f.in = [1];
      },
    ],
    [
      "relative member",
      (f: ManifestField) => {
        f.in = ["manual"];
      },
    ],
    [
      "over cap",
      (f: ManifestField) => {
        f.in = Array.from({ length: 1025 }, (_, i) => `urn:enum:${i}`);
      },
    ],
    [
      "trim",
      (f: ManifestField) => {
        f.guards = { iriEnum: true, trim: true };
      },
    ],
    [
      "dropBlank",
      (f: ManifestField) => {
        f.guards = { iriEnum: true, dropBlank: true };
      },
    ],
    [
      "outside default",
      (f: ManifestField) => {
        f.default = `${EX}outside`;
      },
    ],
    [
      "non-http member under an http(s) scheme guard",
      (f: ManifestField) => {
        f.in = [A, "urn:x:a"];
        f.guards = { iriEnum: true, iriScheme: "http-https" };
      },
    ],
    [
      "http member under an https-only scheme guard",
      (f: ManifestField) => {
        f.in = [A, "http://example.org/enum#plain"];
        f.guards = { iriEnum: true, iriScheme: "https" };
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const m = manifest();
    mutate(field(m));
    expect(() => validateManifest(m)).toThrow(ManifestError);
  });

  it("never lets a scheme-guarded enum member silently clear the field", () => {
    // Every admitted member survives the scheme guard, so a member write persists and a
    // non-member (including a non-http IRI) throws instead of clearing the stored value.
    const m = manifest();
    field(m).guards = { iriEnum: true, iriScheme: "http-https" };
    const e = defineModel(m).entities.Summary;
    if (!e) throw new Error("missing Summary");
    const store = e.build(DOC, { source: A });
    const w = new e.Wrapper(DOC, store, DataFactory) as unknown as { source: unknown };
    expect(() => {
      w.source = "urn:x:a";
    }).toThrow(TypeError);
    expect(w.source).toBe(A);
    w.source = B;
    expect(e.parse(DOC, store)).toEqual({ source: B });
  });

  it("accepts the member cap and a valid default", () => {
    const m = manifest();
    field(m).in = Array.from({ length: 1024 }, (_, i) => `urn:enum:${i}`);
    field(m).default = "urn:enum:0";
    expect(() => validateManifest(m)).not.toThrow();
  });

  it("rejects iriEnum on a nested structural link", () => {
    const m = manifest();
    m.entities = [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: [
          {
            name: "root",
            fragment: "it",
            typeIris: [`${EX}Root`],
            fields: [
              {
                name: "child",
                predicate: `${EX}child`,
                kind: "nested",
                node: "child",
                guards: { iriEnum: true },
              },
            ],
          },
          { name: "child", fragment: "child", typeIris: [`${EX}Child`], fields: [] },
        ],
      },
    ];
    expect(() => validateManifest(m)).toThrow(ManifestError);
  });
});
