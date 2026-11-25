// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateModel } from "@jeswr/federation-codegen";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  buildTask,
  parseTask,
  parseTaskTtl,
  serializeTask,
  Task,
  type TaskData,
  taskSubject,
} from "../src/task.js";
import { dct, prov, RDF_TYPE, schema, TASK_CLASS, WF_CLOSED, WF_OPEN, wf } from "../src/vocab.js";

const RES = "https://pod.example/tasks/1";
const PREFIXES = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct: <http://purl.org/dc/terms/> . @prefix schema: <http://schema.org/> .
@prefix prov: <http://www.w3.org/ns/prov#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
function store(body: string): Store {
  return new Store(new Parser({ baseIRI: RES }).parse(`${PREFIXES}\n${body}`));
}
function parse(body: string): TaskData | undefined {
  return parseTask(RES, store(`<#it> a wf:Task ; ${body} .`));
}

it("requires exactly one xsd:string title instead of returning a task with an empty or coerced title", () => {
  for (const title of ['"one", "two"', '"Title"@en', "5", "<https://e.example/title>", "[]"]) {
    expect(parse(`dct:title ${title}`)).toBeUndefined();
  }
  expect(parseTask(RES, store("<#it> a wf:Task ."))).toBeUndefined();
  expect(parse('dct:title ""')).toEqual({ title: "", state: "open" });
  // The old empty-title build contract stays: it emits a shell, not a valid title.
  expect(parseTask(RES, buildTask(RES, { title: "", state: "open" }))).toBeUndefined();
});

it("drops ambiguous or mistyped optional literals and uses a valid Dublin Core body fallback", () => {
  expect(
    parse(`dct:title "T" ; wf:description "a", "b" ; dct:modified "2026-01-01"^^xsd:date ;
    wf:dateDue "2026-02-30T00:00:00Z"^^xsd:dateTime ; schema:position 4 ; schema:priority "HIGH"@en`),
  ).toEqual({ title: "T", state: "open" });
  expect(parse('dct:title "T" ; wf:description "a"@en')).toEqual({ title: "T", state: "open" });
  expect(parse('dct:title "T" ; dct:description "a", "b"')).toEqual({ title: "T", state: "open" });
  expect(
    parse('dct:title "T" ; wf:description "a", "b" ; dct:description "fallback"')?.description,
  ).toBe("fallback");
  expect(
    parse('dct:title "T" ; wf:description <https://e.example/body> ; dct:description "fallback"')
      ?.description,
  ).toBe("fallback");
  expect(
    parse('dct:title "T" ; wf:description "preferred" ; dct:description "other"')?.description,
  ).toBe("preferred");
});

it("requires dateTime and double datatypes and drops non-finite parsed ranks", () => {
  for (const timestamp of [
    '"2026-01-01"^^xsd:date',
    '"2026-01-01"',
    '"2026-01-01T00:00:00Z"^^xsd:dateTime, "2026-01-02T00:00:00Z"^^xsd:dateTime',
  ]) {
    for (const predicate of ["dct:created", "dct:modified", "prov:endedAtTime", "wf:dateDue"]) {
      expect(parse(`dct:title "T" ; ${predicate} ${timestamp}`)).toEqual({
        title: "T",
        state: "open",
      });
    }
  }
  for (const rank of [
    "4",
    '"4"',
    '"4.5"^^xsd:decimal',
    '"NaN"^^xsd:double',
    '"INF"^^xsd:double',
    '"1.0"^^xsd:double, "2.0"^^xsd:double',
  ]) {
    expect(parse(`dct:title "T" ; schema:position ${rank}`)?.rank).toBeUndefined();
  }
  expect(parse('dct:title "T" ; schema:position "4.5"^^xsd:double')?.rank).toBe(4.5);
});

it("recognises wf:Task data-graph subclasses", () => {
  const dataset = store('<#Custom> rdfs:subClassOf wf:Task . <#it> a <#Custom> ; dct:title "T" .');
  expect(parseTask(RES, dataset)).toEqual({ title: "T", state: "open" });
  expect(new Task(taskSubject(RES), dataset, DataFactory).isTask).toBe(true);
});

it("rejects relative or unsafe subjects and fails closed before parsing an unsafe document base", async () => {
  for (const url of ["tasks/1", "https://pod.example/a b", "https://pod.example/<bad>"]) {
    expect(() => taskSubject(url)).toThrow(TypeError);
    expect(() => buildTask(url, { title: "T", state: "open" })).toThrow(TypeError);
    expect(() => new Task(url, new Store(), DataFactory)).toThrow(TypeError);
    expect(parseTask(url, new Store())).toBeUndefined();
    expect(await parseTaskTtl(url, "not even valid Turtle")).toBeUndefined();
  }
  expect(() => new Task(DataFactory.blankNode(), new Store(), DataFactory)).toThrow(TypeError);
  // Safe absolute identity is not restricted to canonical URL spelling or http(s) subjects.
  expect(taskSubject("https://Pod.Example/tasks/1")).toBe("https://Pod.Example/tasks/1#it");
  expect(taskSubject("urn:task:1")).toBe("urn:task:1#it");
});

it("sanitizes text writes and drops invalid dates instead of throwing", () => {
  const dataset = buildTask(RES, {
    title: "a\u0000b",
    description: "c\u0001d",
    state: "open",
    created: new Date(NaN),
    modified: new Date(NaN),
    dueDate: new Date(NaN),
  });
  expect(parseTask(RES, dataset)).toMatchObject({ title: "ab", description: "cd" });
  expect(dataset.getQuads(taskSubject(RES), wf("dateDue"), null, null)).toHaveLength(0);
  expect(dataset.getQuads(taskSubject(RES), dct("created"), null, null)).toHaveLength(0);
  expect(dataset.getQuads(taskSubject(RES), dct("modified"), null, null)).toHaveLength(0);
  const view = new Task(taskSubject(RES), dataset, DataFactory);
  view.title = "e\u0002f";
  view.description = "g\u0003h";
  expect(view.title).toBe("ef");
  expect(view.description).toBe("gh");
  expect(dataset.getQuads(taskSubject(RES), dct("description"), null, null)[0]?.object.value).toBe(
    "gh",
  );
});

it("keeps the hardened first-valid, lexical-identity IRI policy on every scalar and set", () => {
  const lexical = "HTTPS://Alice.Example/profile/card#me";
  const predicates = {
    creator: dct("creator"),
    assignee: wf("assignee"),
    project: wf("tracker"),
    parent: dct("isPartOf"),
    duplicateOf: dct("isReplacedBy"),
    clonedFrom: prov("wasDerivedFrom"),
  } as const;
  for (const [field, predicate] of Object.entries(predicates)) {
    const dataset = store(
      `<#it> a wf:Task ; dct:title "T" ; <${predicate}> "bad", [], <javascript:x>, <${lexical}>, <https://other.example/me> .`,
    );
    expect(parseTask(RES, dataset)?.[field as keyof typeof predicates]).toBe(lexical);
  }
  expect(
    parse(
      `dct:title "T" ; dct:requires "bad", <${lexical}>, <http://x.org> ; dct:relation [], <${lexical}>`,
    ),
  ).toEqual({
    title: "T",
    state: "open",
    blockedBy: [lexical, "http://x.org"],
    relatesTo: [lexical],
  });
});

it("public generated IRI accessors normalize valid values, drop ambiguity and guard live-set writes", () => {
  const dataset = store(
    '<#it> a wf:Task ; dct:title "T" ; wf:assignee <https://Alice.Example/me> ; wf:tracker <https://a.example/>, <https://b.example/> ; dct:requires <https://Bob.Example/t> .',
  );
  const view = new Task(taskSubject(RES), dataset, DataFactory);
  expect(view.assignee).toBe("https://alice.example/me");
  expect(view.project).toBeUndefined();
  expect([...view.blockedBy]).toEqual(["https://bob.example/t"]);
  view.assignee = "javascript:x";
  view.project = "https://Example.Org";
  view.blockedBy.add("data:text/plain,x");
  view.relatesTo.add("https://Example.Org");
  expect(view.assignee).toBeUndefined();
  expect(view.project).toBe("https://example.org/");
  expect(view.blockedBy.has("data:text/plain,x")).toBe(false);
  expect([...view.relatesTo]).toEqual(["https://example.org/"]);
  expect(() => view.types.add("https://e.example/<bad>")).toThrow(TypeError);
});

it("keeps scalar write normalization and canonical-only set admission from the old builder", () => {
  const dataset = buildTask(RES, {
    title: "T",
    state: "open",
    assignee: " HTTPS://Alice.Example/me ",
    blockedBy: ["https://B.example/t", "https://ok.example/t"],
  });
  expect(parseTask(RES, dataset)?.assignee).toBe("https://alice.example/me");
  expect(parseTask(RES, dataset)?.blockedBy).toEqual(["https://ok.example/t"]);
});

it("keeps priority normalization and dual-description setters including explicit clearing", () => {
  const dataset = store(
    '<#it> a wf:Task ; dct:title "T" ; schema:priority " HIGH " ; dct:description "PM" .',
  );
  const view = new Task(taskSubject(RES), dataset, DataFactory);
  expect(view.priority).toBe("high");
  expect(parseTask(RES, dataset)?.priority).toBe("high");
  expect(view.description).toBe("PM");
  view.description = "shared";
  expect(view.description).toBe("shared");
  expect(dataset.getQuads(taskSubject(RES), dct("description"), null, null)[0]?.object.value).toBe(
    "shared",
  );
  view.title = "edit";
  view.mark();
  expect(view.description).toBe("shared");
  view.description = undefined;
  expect(dataset.getQuads(taskSubject(RES), dct("description"), null, null)).toHaveLength(0);
  expect(dataset.getQuads(taskSubject(RES), wf("description"), null, null)).toHaveLength(0);
});

it("keeps lifecycle timestamps, producer types, and the closed-wins read of contradictory states", () => {
  const dataset = store('<#it> a wf:Task, wf:Open, wf:Closed, <#ProducerType> ; dct:title "T" .');
  expect(parseTask(RES, dataset)?.state).toBe("closed");
  const view = new Task(taskSubject(RES), dataset, DataFactory);
  view.state = "closed";
  const endedAt = view.endedAt;
  expect(endedAt).toBeInstanceOf(Date);
  view.state = "closed";
  expect(view.endedAt).toEqual(endedAt);
  expect(view.types.has(`${RES}#ProducerType`)).toBe(true);
  expect(view.types.has(TASK_CLASS)).toBe(true);
  expect(view.types.has(WF_OPEN)).toBe(false);
  view.state = "open";
  expect(view.endedAt).toBeUndefined();
  expect(view.types.has(WF_CLOSED)).toBe(false);
  const explicit = new Date("2026-01-02T00:00:00Z");
  expect(
    parseTask(RES, buildTask(RES, { title: "T", state: "closed", endedAt: explicit }))?.endedAt,
  ).toEqual(explicit);
  expect(
    parseTask(RES, buildTask(RES, { title: "T", state: "open", endedAt: explicit }))?.endedAt,
  ).toBeUndefined();
});

it("drops throwing optional reads without masking the valid fields and fails closed on type read errors", () => {
  const dataset = store(
    '<#it> a wf:Task ; dct:title "T" ; wf:assignee <https://ok.example/me> ; wf:tracker <https://ok.example/project> .',
  );
  const broken = Object.create(dataset) as DatasetCore;
  broken.match = ((
    subject?: Term | null,
    predicate?: Term | null,
    object?: Term | null,
    graph?: Term | null,
  ) => {
    if (predicate?.value === wf("assignee")) throw new Error("untrusted read");
    return dataset.match(subject, predicate, object, graph);
  }) as DatasetCore["match"];
  expect(parseTask(RES, broken)).toEqual({
    title: "T",
    state: "open",
    project: "https://ok.example/project",
  });
  broken.match = () => {
    throw new Error("all reads fail");
  };
  expect(parseTask(RES, broken)).toBeUndefined();
});

it("documents closed admission's qualified rdf:type state gap without changing the published shape", () => {
  const ontologyTtl = readFileSync(
    new URL("../codegen/task.ontology.ttl", import.meta.url),
    "utf8",
  );
  const shapesTtl = readFileSync(new URL("../shapes/task.ttl", import.meta.url), "utf8");
  const config = JSON.parse(
    readFileSync(new URL("../codegen/codegen.config.json", import.meta.url), "utf8"),
  );
  expect(() => generateModel({ ontologyTtl, shapesTtl, config })).toThrow(
    /rdf:type is a reserved structural predicate/,
  );
  expect(new Task(taskSubject(RES), new Store(), DataFactory)).toBeInstanceOf(
    entities.Task.Wrapper,
  );
});

it("preserves clearable setter types and chaining for a strict consumer of the built declarations", async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
    "--noEmit",
    "--skipLibCheck",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--module",
    "NodeNext",
    "--target",
    "ES2022",
    "--rootDir",
    fileURLToPath(new URL("..", import.meta.url)),
    fileURLToPath(new URL("./consumer.ts", import.meta.url)),
  ]);
}, 30_000);

it("preserves the original Turtle and JSON bytes for a fully populated task", async () => {
  const data: TaskData = {
    title: "Title",
    description: "Body",
    state: "closed",
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-02T00:00:00.000Z"),
    endedAt: new Date("2026-01-03T00:00:00.000Z"),
    creator: "https://a.example/me",
    assignee: "https://b.example/me",
    project: "https://pod.example/tracker#this",
    dueDate: new Date("2026-01-04T00:00:00.000Z"),
    priority: "high",
    rank: 12.5,
    parent: "https://pod.example/parent",
    blockedBy: ["https://pod.example/b", "https://pod.example/a"],
    relatesTo: ["https://pod.example/r"],
    duplicateOf: "https://pod.example/d",
    clonedFrom: "https://pod.example/c",
  };
  expect(await serializeTask(RES, data)).toBe(`@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
@prefix dct: <http://purl.org/dc/terms/>.
@prefix dc: <http://purl.org/dc/elements/1.1/>.
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix schema: <http://schema.org/>.
@prefix prov: <http://www.w3.org/ns/prov#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.

<https://pod.example/tasks/1#it> a wf:Task, wf:Closed;
    dct:title "Title";
    wf:description "Body";
    dct:description "Body";
    dct:created "2026-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
    dct:modified "2026-01-02T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
    prov:endedAtTime "2026-01-03T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
    dct:creator <https://a.example/me>;
    wf:assignee <https://b.example/me>;
    wf:tracker <https://pod.example/tracker#this>;
    dct:isPartOf <https://pod.example/parent>;
    dct:isReplacedBy <https://pod.example/d>;
    prov:wasDerivedFrom <https://pod.example/c>;
    wf:dateDue "2026-01-04T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
    schema:priority "high";
    schema:position "12.5"^^<http://www.w3.org/2001/XMLSchema#double>;
    dct:requires <https://pod.example/b>, <https://pod.example/a>;
    dct:relation <https://pod.example/r>.
`);
  const json =
    '{"title":"Title","state":"closed","description":"Body","created":"2026-01-01T00:00:00.000Z","modified":"2026-01-02T00:00:00.000Z","endedAt":"2026-01-03T00:00:00.000Z","creator":"https://a.example/me","assignee":"https://b.example/me","project":"https://pod.example/tracker#this","dueDate":"2026-01-04T00:00:00.000Z","priority":"high","rank":12.5,"parent":"https://pod.example/parent","duplicateOf":"https://pod.example/d","clonedFrom":"https://pod.example/c","blockedBy":["https://pod.example/b","https://pod.example/a"],"relatesTo":["https://pod.example/r"]}';
  expect(JSON.stringify(parseTask(RES, buildTask(RES, data)))).toBe(json);
  expect(JSON.stringify(await parseTaskTtl(RES, await serializeTask(RES, data), null))).toBe(json);
});

it("writes valid XSD expanded years and non-finite doubles through the generated mappers", () => {
  for (const [iso, lexical] of [
    ["+010000-01-02T00:00:00.000Z", "10000-01-02T00:00:00.000Z"],
    ["-000001-01-02T00:00:00.000Z", "-0001-01-02T00:00:00.000Z"],
  ] as const) {
    const created = new Date(iso);
    const dataset = buildTask(RES, { title: "T", state: "open", created });
    expect(dataset.getQuads(taskSubject(RES), dct("created"), null, null)[0]?.object.value).toBe(
      lexical,
    );
    expect(parseTask(RES, dataset)?.created).toEqual(created);
  }
  for (const [rank, lexical] of [
    [Infinity, "INF"],
    [-Infinity, "-INF"],
    [NaN, "NaN"],
  ] as const) {
    const dataset = buildTask(RES, { title: "T", state: "open", rank });
    expect(
      dataset.getQuads(taskSubject(RES), schema("position"), null, null)[0]?.object.value,
    ).toBe(lexical);
    expect(parseTask(RES, dataset)?.rank).toBeUndefined();
  }
});

it("drops IRIREF-unsafe field and live-set writes that survive URL normalization", () => {
  for (const iri of ["https://a.example/|bad", "https://a.example/?bad|value"]) {
    const dataset = buildTask(RES, { title: "T", state: "open", assignee: iri, blockedBy: [iri] });
    expect(parseTask(RES, dataset)?.assignee).toBeUndefined();
    expect(dataset.getQuads(taskSubject(RES), dct("requires"), null, null)).toHaveLength(0);
    const view = new Task(taskSubject(RES), dataset, DataFactory);
    view.project = iri;
    view.relatesTo.add(iri);
    expect(view.project).toBeUndefined();
    expect([...view.relatesTo]).toEqual([]);
  }
});

it("stamps default completion after creation even when the clock advances on every Date construction", () => {
  const NativeDate = Date;
  let instant = NativeDate.parse("2026-01-01T00:00:00Z");
  class AdvancingDate extends NativeDate {
    constructor(value?: string | number) {
      super(value ?? instant++);
    }
  }
  vi.stubGlobal("Date", AdvancingDate);
  try {
    const data = parseTask(RES, buildTask(RES, { title: "T", state: "closed" }));
    expect(data?.created).toBeInstanceOf(NativeDate);
    expect(data?.endedAt).toBeInstanceOf(NativeDate);
    expect(data?.endedAt?.getTime()).toBeGreaterThanOrEqual(data?.created?.getTime() ?? Infinity);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not rewrite an existing valid completion literal when re-closing a task", () => {
  const lexical = "2026-01-02T03:00:00+03:00";
  const dataset = store(
    `<#it> a wf:Task, wf:Closed ; dct:title "T" ; prov:endedAtTime "${lexical}"^^xsd:dateTime .`,
  );
  const view = new Task(taskSubject(RES), dataset, DataFactory);
  view.state = "closed";
  view.state = "closed";
  expect(dataset.getQuads(taskSubject(RES), prov("endedAtTime"), null, null)[0]?.object.value).toBe(
    lexical,
  );
});

it("keeps the original direct-accessor reads of ill-typed dates and unparseable http IRIs", () => {
  const dates = {
    created: dct("created"),
    modified: dct("modified"),
    endedAt: prov("endedAtTime"),
    dueDate: wf("dateDue"),
  } as const;
  for (const [field, predicate] of Object.entries(dates)) {
    const key = field as keyof typeof dates;
    const read = (object: string) =>
      new Task(
        taskSubject(RES),
        store(`<#it> a wf:Task ; dct:title "T" ; <${predicate}> ${object} .`),
        DataFactory,
      )[key];
    // An ill-typed xsd:dateTime surfaces as an Invalid Date (as @rdfjs/wrapper's
    // LiteralAs.date did) so consumers can reject it; plain-data parse still drops it.
    for (const object of ['"invalid"^^xsd:dateTime', '"2026-13-45T99:00:00Z"^^xsd:dateTime']) {
      const value = read(object);
      expect(value).toBeInstanceOf(Date);
      expect(Number.isNaN(value?.getTime())).toBe(true);
      expect(parse(`dct:title "T" ; <${predicate}> ${object}`)).toEqual({
        title: "T",
        state: "open",
      });
    }
    // Absent, ambiguous, or other-datatype values keep the generated drop, and so do
    // lenient non-XSD forms the old wrapper parsed (a rolled-over date included).
    for (const object of [
      '"2026-02-30T00:00:00Z"^^xsd:dateTime',
      '"2026-03-01"^^xsd:dateTime',
      '"2026-03-01T00:00Z"^^xsd:dateTime',
      '"2026-03-01T00:00:00+0000"^^xsd:dateTime',
      '"2026-01-01"^^xsd:date',
      '"invalid"',
      '"invalid"^^xsd:dateTime, "2026-01-01T00:00:00Z"^^xsd:dateTime',
    ]) {
      expect(read(object)).toBeUndefined();
    }
    expect(read('"2026-01-01T00:00:00Z"^^xsd:dateTime')).toEqual(new Date("2026-01-01T00:00:00Z"));
  }

  const iris = {
    creator: dct("creator"),
    assignee: wf("assignee"),
    project: wf("tracker"),
    parent: dct("isPartOf"),
    duplicateOf: dct("isReplacedBy"),
    clonedFrom: prov("wasDerivedFrom"),
  } as const;
  const { namedNode, quad, literal } = DataFactory;
  for (const [field, predicate] of Object.entries(iris)) {
    const key = field as keyof typeof iris;
    const read = (...objects: string[]) => {
      const subject = namedNode(taskSubject(RES));
      const dataset = new Store([
        quad(subject, namedNode(RDF_TYPE), namedNode(TASK_CLASS)),
        quad(subject, namedNode(dct("title")), literal("T")),
        ...objects.map((object) => quad(subject, namedNode(predicate), namedNode(object))),
      ]);
      return { view: new Task(subject, dataset, DataFactory)[key], data: parseTask(RES, dataset) };
    };
    // A lone, lexically safe http(s) IRI that WHATWG URL cannot parse keeps its exact
    // spelling on the direct accessor; plain-data parse still requires a parseable URL.
    expect(read("http://a%zz/")).toEqual({
      view: "http://a%zz/",
      data: { title: "T", state: "open" },
    });
    for (const unsafe of [
      ["http://a%zz/", "https://ok.example/"],
      ["javascript:a%zz"],
      ["https:a%zz"],
      ["http:///a%zz"],
      ["http://a%zz/<x>"],
      ["http://a%zz/\u0001"],
      ["http://a%zz/\u0085"],
    ]) {
      expect(read(...unsafe).view).toBeUndefined();
    }
  }
});

it("drops stored http(s) IRIs with control characters or an empty authority on plain-data parse", () => {
  const { namedNode, quad, literal } = DataFactory;
  const subject = namedNode(taskSubject(RES));
  for (const iri of [
    "https://a.example/\u0001x",
    "https://a.example/\u0085x",
    "http:///a.example/x",
  ]) {
    const dataset = new Store([
      quad(subject, namedNode(RDF_TYPE), namedNode(TASK_CLASS)),
      quad(subject, namedNode(dct("title")), literal("T")),
      quad(subject, namedNode(wf("assignee")), namedNode(iri)),
      quad(subject, namedNode(dct("requires")), namedNode(iri)),
    ]);
    expect(parseTask(RES, dataset)).toEqual({ title: "T", state: "open" });
  }
});

it("closing a task replaces a malformed stored completion time", () => {
  const dataset = store(
    `<#it> a wf:Task ; dct:title "T" ; prov:endedAtTime "garbage"^^xsd:dateTime .`,
  );
  const t = new Task(taskSubject(RES), dataset, DataFactory);
  const before = Date.now();
  t.state = "closed";
  const stored = dataset.getQuads(taskSubject(RES), prov("endedAtTime"), null, null);
  expect(stored).toHaveLength(1);
  expect(Date.parse(stored[0]?.object.value ?? "")).toBeGreaterThanOrEqual(before - 1000);
});
