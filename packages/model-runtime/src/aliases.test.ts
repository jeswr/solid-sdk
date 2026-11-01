// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type ManifestEntity,
  ManifestError,
  type ModelManifest,
  validateManifest,
} from "./manifest.js";
import { defineModel, type EntityWrapper } from "./model.js";

const NS = "https://example.org/ns#";
const OLD = "https://example.org/legacy#";
const RES = "https://pod.example/bookmark";
const SUBJ = `${RES}#it`;

function entity(): ManifestEntity {
  return {
    name: "Record",
    typeIris: [`${NS}Record`],
    aliasTypeIris: [`${OLD}Record`],
    subject: { convention: "hash-it" },
    fields: [
      {
        name: "url",
        predicate: `${NS}url`,
        aliasPredicates: [`${OLD}url`, `${OLD}url2`],
        kind: "iri",
        maxCount: 1,
        guards: { iriScheme: "http-https", requiredFailClosed: true },
      },
      {
        name: "text",
        predicate: `${NS}text`,
        aliasPredicates: [`${OLD}text`],
        kind: "literal",
        datatype: "xsd:string",
        maxCount: 1,
      },
      {
        name: "flag",
        predicate: `${NS}flag`,
        aliasPredicates: [`${OLD}flag`],
        kind: "literal",
        datatype: "xsd:boolean",
        maxCount: 1,
        default: false,
      },
      {
        name: "count",
        predicate: `${NS}count`,
        aliasPredicates: [`${OLD}count`],
        kind: "literal",
        datatype: "xsd:integer",
        maxCount: 1,
        guards: { minInclusive: 0 },
      },
      {
        name: "tags",
        predicate: `${NS}tags`,
        aliasPredicates: [`${OLD}tags`],
        kind: "literal",
        datatype: "xsd:string",
        collection: "set",
        guards: { sortOnRead: true },
      },
      {
        name: "links",
        predicate: `${NS}links`,
        aliasPredicates: [`${OLD}links`],
        kind: "iri",
        collection: "set",
        guards: { iriScheme: "http-https" },
      },
      {
        name: "dates",
        predicate: `${NS}dates`,
        aliasPredicates: [`${OLD}dates`],
        kind: "literal",
        datatype: "xsd:dateTime",
        collection: "set",
      },
    ],
  };
}
function manifest(e = entity()): ModelManifest {
  return {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: { ex: NS, old: OLD },
    entities: [e],
  };
}
function model(e = entity()) {
  const result = defineModel(manifest(e)).entities.Record;
  if (!result) throw new Error("missing entity");
  return result;
}
function store(body: string, type = `${OLD}Record`): Store {
  return new Store(
    new Parser({ baseIRI: RES }).parse(`
    @prefix ex: <${NS}> . @prefix old: <${OLD}> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <#it> a <${type}> ; ${body} .`),
  );
}
type View = EntityWrapper & {
  url: string | undefined;
  text: string | undefined;
  flag: boolean | undefined;
  tags: Set<string>;
  links: Set<string>;
  dates: Set<Date>;
};
const bm = model();
const view = (ds: Store) => new bm.Wrapper(SUBJ, ds, DataFactory) as View;

describe("read aliases — guards and precedence", () => {
  it("accepts alias types and predicates without mutating the input", () => {
    const ds = store('old:url <https://example.org/a> ; old:text "old" ; old:flag true');
    const original = [...ds];
    expect(view(ds).isInstance).toBe(true);
    expect(bm.parse(RES, ds)).toEqual({ url: "https://example.org/a", text: "old", flag: true });
    expect([...ds]).toEqual(original);
    expect(bm.parse(RES, store("old:url <https://example.org/a>", `${NS}Unknown`))).toBeUndefined();
  });

  it("canonical false, empty string and zero win over conflicting alias values", () => {
    const ds = store(
      'ex:url <https://example.org/new> ; old:url <https://example.org/old> ; ex:text "" ; old:text "stale" ; ex:flag false ; old:flag true ; ex:count 0 ; old:count 4',
    );
    expect(bm.parse(RES, ds)).toEqual({
      url: "https://example.org/new",
      text: "",
      flag: false,
      count: 0,
    });
    expect(view(ds).text).toBe("");
    expect(view(ds).flag).toBe(false);
  });

  it("tries aliases in manifest order only after the canonical guard drops its value", () => {
    const ds = store(
      'ex:url <javascript:bad> ; old:url <https://example.org/first> ; old:url2 <https://example.org/second> ; ex:count -1 ; old:count 2 ; ex:flag "bad" ; old:flag true',
    );
    expect(bm.parse(RES, ds)).toEqual({ url: "https://example.org/first", count: 2, flag: true });
    expect(view(ds).url).toBe("https://example.org/first");
  });

  it.each([
    "old:url <javascript:alert(1)>",
    "old:url <data:text/html,x>",
    'old:url "https://example.org/"',
    "old:url []",
  ])("drops hostile/malformed alias IRI: %s", (body) => {
    expect(view(store(body)).url).toBeUndefined();
    expect(bm.parse(RES, store(body))).toBeUndefined();
  });

  it("does not default a present invalid alias; defaults apply only after all predicates are absent", () => {
    expect(view(store("old:url <https://example.org/>")).flag).toBe(false);
    expect(view(store('old:url <https://example.org/> ; old:flag "bad"')).flag).toBeUndefined();
    expect(
      view(store('old:url <https://example.org/> ; ex:flag "bad" ; old:flag "bad"')).flag,
    ).toBeUndefined();
    expect(
      bm.parse(RES, store('old:url <https://example.org/> ; old:count "bad"'))?.count,
    ).toBeUndefined();
  });

  it("ambiguous canonical or alias values drop and never fall back", () => {
    const optionalEntity = entity();
    const url = optionalEntity.fields[0];
    if (!url) throw new Error("missing url");
    url.guards = { ...url.guards, requiredFailClosed: false };
    url.default = "https://example.org/default";
    const optional = model(optionalEntity);
    for (const body of [
      "ex:url <https://example.org/a>, <https://example.org/b> ; old:url <https://example.org/fallback>",
      "old:url <https://example.org/a>, <https://example.org/b> ; old:url2 <https://example.org/fallback>",
    ]) {
      const ds = store(body);
      expect(view(ds).url).toBeUndefined();
      expect((new optional.Wrapper(SUBJ, ds, DataFactory) as View).url).toBeUndefined();
      expect(optional.parse(RES, ds)).toEqual({ flag: false });
      expect(bm.parse(RES, ds)).toBeUndefined();
    }
    // Identical objects in different graphs are still one distinct RDF term.
    for (const predicate of [`${NS}url`, `${OLD}url`]) {
      const ds = store(`<${predicate}> <https://example.org/a>`);
      ds.addQuad(
        DataFactory.namedNode(SUBJ),
        DataFactory.namedNode(predicate),
        DataFactory.namedNode("https://example.org/a"),
        DataFactory.namedNode("urn:another-graph"),
      );
      expect(view(ds).url).toBe("https://example.org/a");
      expect(optional.parse(RES, ds)?.url).toBe("https://example.org/a");
      expect(bm.parse(RES, ds)?.url).toBe("https://example.org/a");
    }
  });

  it("normalises control-bearing alias IRIs and sanitises alias text on write/serialisation", async () => {
    const ds = store('old:url <https://example.org/> ; old:text "clean"');
    ds.removeQuads(ds.getQuads(SUBJ, `${OLD}url`, null, null));
    ds.addQuad(
      DataFactory.namedNode(SUBJ),
      DataFactory.namedNode(`${OLD}url`),
      DataFactory.namedNode("https://example.org/a\n"),
    );
    expect(view(ds).url).toBe("https://example.org/a");
    view(ds).text = "hello\u0000\u0085\nworld";
    expect(view(ds).text).toBe("hello\nworld");
    const serialized = await bm.serialize(RES, { url: view(ds).url, text: "a\u0000b" });
    expect(serialized).not.toContain(OLD);
    expect(bm.parse(RES, new Store(new Parser().parse(serialized)))?.text).toBe("ab");
  });
});

describe("canonical writes and live alias sets", () => {
  it.each([
    undefined,
    "new",
    "bad\u0000text",
  ])("every setter clears every alias, including malformed terms: %s", (value) => {
    const ds = store('old:url <https://example.org/> ; old:text "old", 3');
    view(ds).text = value;
    expect(ds.getQuads(SUBJ, `${OLD}text`, null, null)).toHaveLength(0);
    expect(view(ds).text).toBe(value?.replace("\u0000", ""));
  });

  it("an invalid singleton write clears aliases and the canonical value", () => {
    const ds = store(
      "ex:url <https://example.org/new> ; old:url <https://example.org/old> ; old:url2 <https://example.org/old2>",
    );
    view(ds).url = "javascript:bad";
    expect(view(ds).url).toBeUndefined();
    expect(ds.getQuads(SUBJ, `${OLD}url`, null, null)).toHaveLength(0);
    expect(ds.getQuads(SUBJ, `${OLD}url2`, null, null)).toHaveLength(0);
  });

  it("mark removes all alias types, preserves unrelated types, and is idempotent", () => {
    const ds = store("old:url <https://example.org/>");
    const doc = view(ds);
    doc.types.add("urn:other");
    expect(doc.mark()).toBe(doc);
    doc.mark();
    expect([...doc.types].sort()).toEqual([`${NS}Record`, "urn:other"].sort());
  });

  it("build and serialize emit only canonical IRIs", async () => {
    const data = {
      url: "https://example.org/",
      text: "new",
      flag: false,
      tags: ["a"],
      links: ["https://example.org/link"],
    };
    for (const q of bm.build(RES, data)) {
      expect(q.predicate.value.startsWith(OLD)).toBe(false);
      expect(q.object.value.startsWith(OLD)).toBe(false);
    }
    expect(await bm.serialize(RES, data)).not.toContain(OLD);
  });

  it("reads a deduplicated union through every Set read method, dropping malformed aliases", () => {
    const ds = store(
      'old:url <https://example.org/> ; ex:tags "a" ; old:tags "a", "b" ; ex:links <https://example.org/a> ; old:links <https://example.org/a>, <javascript:bad>, "bad"',
    );
    const doc = view(ds);
    const tags = doc.tags;
    expect([...tags]).toEqual(["a", "b"]);
    expect([...tags.keys()]).toEqual(["a", "b"]);
    expect([...tags.values()]).toEqual(["a", "b"]);
    expect([...tags.entries()]).toEqual([
      ["a", "a"],
      ["b", "b"],
    ]);
    expect(tags.size).toBe(2);
    expect(tags.has("b")).toBe(true);
    expect(tags.has("missing")).toBe(false);
    const calls: unknown[] = [];
    tags.forEach(function (this: unknown, v, v2, set) {
      calls.push([this, v, v2, set === tags]);
    }, "context");
    expect(calls).toEqual([
      ["context", "a", "a", true],
      ["context", "b", "b", true],
    ]);
    expect([...doc.links]).toEqual(["https://example.org/a"]);
    expect(bm.parse(RES, ds)?.tags).toEqual(["a", "b"]);
  });

  it("set mutations migrate surviving aliases, sanitise new text, and stay live", () => {
    const ds = store('old:url <https://example.org/> ; old:tags "a", "b"');
    const tags = view(ds).tags;
    expect(tags.delete("a")).toBe(true);
    expect(tags.delete("missing")).toBe(false);
    expect([...tags]).toEqual(["b"]);
    expect(ds.getQuads(SUBJ, `${OLD}tags`, null, null)).toHaveLength(0);
    expect(tags.add("c\u0000")).toBe(tags);
    expect([...tags]).toEqual(["b", "c"]);
    tags.clear();
    expect(tags.size).toBe(0);
  });

  it("IRI alias set additions/deletions enforce scheme guards and canonical equality", () => {
    const ds = store("old:url <https://example.org/> ; old:links <http://example.org>");
    const links = view(ds).links;
    expect(links.has("http://example.org/")).toBe(true);
    expect(links.delete("http://example.org")).toBe(true);
    links.add("javascript:bad");
    expect(links.size).toBe(0);
    links.add("https://example.org/b\n");
    expect([...links]).toEqual(["https://example.org/b"]);
    expect(ds.getQuads(SUBJ, `${OLD}links`, null, null)).toHaveLength(0);
  });

  it("Date unions deduplicate and delete by instant, dropping invalid alias literals", () => {
    const ds = store(
      'old:url <https://example.org/> ; ex:dates "2026-01-01T00:00:00Z"^^xsd:dateTime ; old:dates "2026-01-01T00:00:00Z"^^xsd:dateTime, "bad"^^xsd:dateTime',
    );
    const dates = view(ds).dates;
    expect(dates.size).toBe(1);
    expect(dates.has(new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(dates.delete(new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(dates.size).toBe(0);
  });

  it("storeToTurtle canonicalises an existing legacy store without modifying it", async () => {
    const ds = store(
      'old:url <https://example.org/> ; old:text "a\\u0000b" ; old:tags "z", "a" ; ex:flag false ; old:flag true',
    );
    const before = [...ds];
    const ttl = await bm.storeToTurtle(ds);
    expect(ttl).not.toContain(OLD);
    expect([...ds]).toEqual(before);
    expect(bm.parse(RES, new Store(new Parser().parse(ttl)))).toEqual({
      url: "https://example.org/",
      text: "a\u0000b",
      flag: false,
      tags: ["a", "z"],
    });
  });
});

describe("aliases preserve security guards", () => {
  it.each([
    true,
    false,
  ])("checks set cardinality across the raw union (required=%s)", (required) => {
    const e = entity();
    e.fields = [
      {
        name: "tags",
        predicate: `${NS}tags`,
        aliasPredicates: [`${OLD}tags`],
        kind: "literal",
        datatype: "xsd:string",
        collection: "set",
        minCount: 2,
        maxCount: 3,
        in: ["a", "b", "c"],
        guards: { requiredFailClosed: required },
      },
    ];
    const guarded = model(e);
    for (const body of [
      'ex:tags "a" ; old:tags "outside"',
      'ex:tags "a", "b" ; old:tags "c", "outside"',
      'ex:tags "a", "b" ; old:tags "c", []',
    ]) {
      expect(guarded.parse(RES, store(body))).toEqual(required ? undefined : {});
    }
    expect(guarded.parse(RES, store('ex:tags "a" ; old:tags "b"'))).toEqual({
      tags: ["a", "b"],
    });
    expect(guarded.parse(RES, store('ex:tags "a", "b" ; old:tags "a", "c"'))).toEqual({
      tags: ["a", "b", "c"],
    });
    const ds = store('ex:tags "a" ; old:tags "b", "outside", []');
    const tags = (new guarded.Wrapper(SUBJ, ds, DataFactory) as View).tags;
    expect([...tags]).toEqual(["a", "b"]);
    tags.add("outside");
    expect([...tags]).toEqual(["a", "b"]);
    expect(ds.getQuads(SUBJ, `${OLD}tags`, null, null)).toHaveLength(0);
    expect(guarded.parse(RES, ds)).toEqual({ tags: ["a", "b"] });
    expect(guarded.parse(RES, guarded.build(RES, { tags: ["a", "outside"] }))).toEqual(
      required ? undefined : {},
    );
  });

  it("enforces https-only schemes on alias singletons, union reads and mutations", () => {
    const e = entity();
    for (const field of e.fields) {
      if (field.kind === "iri") field.guards = { ...field.guards, iriScheme: "https" };
    }
    const guarded = model(e);
    const ds = store(
      "old:url <http://example.org/> ; old:url2 <https://example.org/> ; ex:links <http://example.org/a> ; old:links <http://example.org/b>, <https://example.org/c>",
    );
    expect(guarded.parse(RES, ds)).toEqual({
      url: "https://example.org/",
      flag: false,
      links: ["https://example.org/c"],
    });
    const doc = new guarded.Wrapper(SUBJ, ds, DataFactory) as View;
    doc.links.add("http://example.org/d");
    expect([...doc.links]).toEqual(["https://example.org/c"]);
    doc.url = "http://example.org/";
    expect(doc.url).toBeUndefined();
    expect(ds.getQuads(SUBJ, `${OLD}url2`, null, null)).toHaveLength(0);
  });

  it("enforces maxCount zero on canonical and alias singletons without defaults", () => {
    for (const required of [true, false]) {
      const e = entity();
      e.fields = [
        {
          name: "text",
          predicate: `${NS}text`,
          aliasPredicates: [`${OLD}text`],
          kind: "literal",
          datatype: "xsd:string",
          maxCount: 0,
          default: "default",
          guards: { requiredFailClosed: required },
        },
      ];
      const guarded = model(e);
      for (const body of ['ex:text "a" ; old:text "fallback"', 'old:text "a"']) {
        const ds = store(body);
        expect((new guarded.Wrapper(SUBJ, ds, DataFactory) as View).text).toBeUndefined();
        expect(guarded.parse(RES, ds)).toEqual(required ? undefined : {});
      }
    }
  });
});

describe("manifest alias admission", () => {
  it("applies the canonical Turtle-safe IRI check to every alias slot", () => {
    for (const iri of [
      "relative",
      ...[...'< >"{}|^`\\', "\u0000", "\u007f", "\u0085", "\u00a0", "\u2028"].map(
        (ch) => `https://example.org/a${ch}b`,
      ),
    ]) {
      for (const key of ["aliasTypeIris", "aliasPredicates"] as const) {
        const e = entity();
        if (key === "aliasTypeIris") e.aliasTypeIris = [iri];
        else {
          if (!e.fields[0]) throw new Error("missing field");
          e.fields[0].aliasPredicates = [iri];
        }
        expect(() => validateManifest(manifest(e)), `${key}: ${JSON.stringify(iri)}`).toThrow(
          ManifestError,
        );
      }
    }
  });

  it("accepts optional/empty aliases and the exact four-alias cap", () => {
    const e = entity();
    e.aliasTypeIris = Array.from({ length: 4 }, (_, i) => `${OLD}type${i}`);
    const field = e.fields[0];
    if (!field) throw new Error("missing field");
    field.aliasPredicates = Array.from({ length: 4 }, (_, i) => `${OLD}p${i}`);
    expect(validateManifest(manifest(e))).toEqual(defineModel(manifest(e)).manifest);
    e.aliasTypeIris = [];
    field.aliasPredicates = [];
    expect(() => validateManifest(manifest(e))).not.toThrow();
    delete e.aliasTypeIris;
    delete field.aliasPredicates;
    expect(() => validateManifest(manifest(e))).not.toThrow();
  });

  for (const key of ["aliasTypeIris", "aliasPredicates"] as const) {
    const canonical = key === "aliasTypeIris" ? `${NS}Record` : `${NS}url`;
    it.each([
      "not an array",
      null,
      [3],
      [""],
      ["/relative"],
      ["urn:alias"],
      ["javascript:bad"],
      ["https://example.org/a\n"],
      ["https://example.org/a b"],
      ["https://example.org/<bad>"],
      ["https://example.org/\\bad"],
      ["https://"],
      ["__proto__"],
      [canonical],
      [`${OLD}same`, `${OLD}same`],
      Array.from({ length: 5 }, (_, i) => `${OLD}${i}`),
    ])(`rejects invalid ${key}: %j`, (value) => {
      const e = entity();
      const target = key === "aliasTypeIris" ? e : e.fields[0];
      if (!target) throw new Error("missing field");
      (target as unknown as Record<string, unknown>)[key] = value;
      expect(() => validateManifest(manifest(e))).toThrow(ManifestError);
    });
  }

  it.each([
    `${NS}text`,
    `${OLD}text`,
  ])("rejects an alias equal to another field's canonical/alias: %s", (alias) => {
    const e = entity();
    if (!e.fields[0]) throw new Error("missing field");
    e.fields[0].aliasPredicates = [alias];
    expect(() => validateManifest(manifest(e))).toThrow(/overlaps/);
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])("rejects reserved entity names with aliases: %s", (name) => {
    const e = entity();
    e.name = name;
    expect(() => defineModel(manifest(e))).toThrow(/reserved/);
  });

  it("reserved-looking IRI local names are data, never object keys", () => {
    const e = entity();
    e.aliasTypeIris = [`${OLD}__proto__`];
    if (!e.fields[0]) throw new Error("missing field");
    e.fields[0].aliasPredicates = [`${OLD}constructor`];
    expect(() => defineModel(manifest(e))).not.toThrow();
    expect(
      model(e).parse(RES, store("old:constructor <https://example.org/>", `${OLD}__proto__`))?.url,
    ).toBe("https://example.org/");
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])("aliases do not bypass reserved field names: %s", (name) => {
    const e = entity();
    if (!e.fields[0]) throw new Error("missing field");
    e.fields[0].name = name;
    expect(() => defineModel(manifest(e))).toThrow(/reserved/);
  });
});

describe("composite node aliases", () => {
  function composite(): ModelManifest {
    return {
      ...manifest(),
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: [
            {
              name: "root",
              fragment: "it",
              typeIris: [`${NS}Root`],
              aliasTypeIris: [`${OLD}Root`],
              fields: [
                {
                  name: "child",
                  kind: "nested",
                  node: "child",
                  predicate: `${NS}child`,
                  guards: { requiredFailClosed: true },
                },
              ],
            },
            {
              name: "child",
              fragment: "child",
              typeIris: [`${NS}Child`],
              aliasTypeIris: [`${OLD}Child`],
              fields: [
                {
                  name: "label",
                  kind: "literal",
                  datatype: "xsd:string",
                  predicate: `${NS}label`,
                  aliasPredicates: [`${OLD}label`],
                  guards: { requiredFailClosed: true, nonBlank: true },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it("graph-walks alias-typed root and child nodes with guarded alias fields; writes canonical", async () => {
    const tree = defineModel(composite()).entities.Tree;
    if (!tree) throw new Error("missing tree");
    const ds = store("ex:child <https://elsewhere.example/child>", `${OLD}Root`);
    ds.addQuads(
      new Parser().parse(
        `<https://elsewhere.example/child> a <${OLD}Child> ; <${OLD}label> "old" .`,
      ),
    );
    expect(tree.parse(RES, ds)).toEqual({ label: "old" });
    expect(new tree.Wrapper(SUBJ, ds, DataFactory).isInstance).toBe(true);
    expect(await tree.storeToTurtle(ds)).not.toContain(OLD);
    expect(await tree.serialize(RES, { label: "new" })).not.toContain(OLD);
    const bad = new Store(
      new Parser().parse(
        `<${SUBJ}> a <${OLD}Root> ; <${NS}child> <https://elsewhere.example/child> . <https://elsewhere.example/child> a <${OLD}Child> ; <${OLD}label> "" .`,
      ),
    );
    expect(tree.parse(RES, bad)).toBeUndefined();
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])("rejects reserved composite/node names with aliases: %s", (name) => {
    const m = composite();
    const tree = m.entities[0];
    if (tree?.kind !== "composite" || !tree.nodes[0]) throw new Error("missing tree");
    tree.name = name;
    expect(() => defineModel(m)).toThrow(/reserved/);
    tree.name = "Tree";
    tree.nodes[0].name = name;
    expect(() => defineModel(m)).toThrow(/reserved/);
  });

  it("rejects aliases on structural nested fields, even an empty alias array", () => {
    const m = composite();
    const tree = m.entities[0];
    if (tree?.kind !== "composite" || !tree.nodes[0]?.fields[0]) throw new Error("missing link");
    tree.nodes[0].fields[0].aliasPredicates = [];
    expect(() => validateManifest(m)).toThrow(/not allowed on a nested/);
  });

  it("rejects alias collisions across nodes and across separate entities", () => {
    const m = composite();
    const tree = m.entities[0];
    if (tree?.kind !== "composite" || !tree.nodes[1]?.fields[0]) throw new Error("missing label");
    tree.nodes[1].fields[0].aliasPredicates = [`${NS}child`];
    expect(() => validateManifest(m)).toThrow(/overlaps/);
    const other = entity();
    other.name = "Other";
    expect(() => validateManifest({ ...manifest(), entities: [entity(), other] })).toThrow(
      /overlaps/,
    );
  });
});
