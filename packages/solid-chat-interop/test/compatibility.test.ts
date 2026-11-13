// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import { buildConversation, parseConversation } from "../src/conversation.js";
import { entities } from "../src/generated/model.js";
import {
  As2MessageDoc,
  buildAs2Message,
  CHAT_ROLES,
  ChatWriter,
  parseAs2Message,
  safeHttpIri,
  serializeAs2,
} from "../src/index.js";
import { messageShapeTtl } from "../src/shape.js";

const SUBJECT = "https://pod.example/chat/m#different";
const prefixes = `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix schema: <http://schema.org/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
function dataset(body: string): Store {
  return new Store(new Parser({ baseIRI: SUBJECT }).parse(prefixes + body));
}
function note(properties = ""): Store {
  return dataset(`<${SUBJECT}> a as:Note ; as:content "Body" ;
    as:published "2026-01-01T00:00:00Z"^^xsd:dateTime ${properties} .`);
}
const engine = createRdfEngine();
afterAll(() => engine.dispose());

// Captured from the hand-written implementation before the flip.
const oracle = {
  subject: "https://pod.example/chat/m#different",
  msg: {
    content: "Body",
    mediaType: "text/markdown",
    author: "https://alice.example/profile#me",
    published: "2026-01-01T00:00:00.000Z",
    room: "https://pod.example/chat/",
    inReplyTo: "https://pod.example/prev",
    replacedBy: "https://pod.example/next",
    deletedAt: "2026-01-02T00:00:00.000Z",
    provenance: {
      attributedTo: "https://agent.example/me",
      generatedBy: "https://models.example/m",
      derivedFrom: "https://source.example/m",
    },
    task: {
      state: "closed" as const,
      title: "Task",
      assignee: "https://bob.example/me",
    },
  },
  turtle:
    '@prefix as: <https://www.w3.org/ns/activitystreams#>.\n@prefix pc: <https://jeswr.org/ns/pod-chat#>.\n@prefix sioc: <http://rdfs.org/sioc/ns#>.\n@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n@prefix dct: <http://purl.org/dc/terms/>.\n@prefix schema: <http://schema.org/>.\n@prefix prov: <http://www.w3.org/ns/prov#>.\n@prefix meeting: <http://www.w3.org/ns/pim/meeting#>.\n@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.\n\n<https://pod.example/chat/m#different> a as:Note, wf:Task, wf:Closed;\n    as:content "Body";\n    as:mediaType "text/markdown";\n    as:attributedTo <https://alice.example/profile#me>;\n    as:published "2026-01-01T00:00:00.000Z"^^xsd:dateTime;\n    as:context <https://pod.example/chat/>;\n    as:inReplyTo <https://pod.example/prev>;\n    dct:isReplacedBy <https://pod.example/next>;\n    schema:dateDeleted "2026-01-02T00:00:00.000Z"^^xsd:dateTime;\n    prov:wasAttributedTo <https://agent.example/me>;\n    prov:wasGeneratedBy <https://models.example/m>;\n    prov:wasDerivedFrom <https://source.example/m>;\n    dct:title "Task";\n    wf:assignee <https://bob.example/me>.\n',
};
it("preserves the original full-message Turtle bytes and arbitrary subject fragment", async () => {
  expect(await serializeAs2(oracle.msg, oracle.subject)).toBe(oracle.turtle);
  expect(parseAs2Message(oracle.subject, buildAs2Message(oracle.subject, oracle.msg))).toEqual({
    id: oracle.subject,
    ...oracle.msg,
  });
  expect(
    JSON.stringify(parseAs2Message(oracle.subject, buildAs2Message(oracle.subject, oracle.msg))),
  ).toBe(JSON.stringify({ id: oracle.subject, ...oracle.msg }));
});

it("keeps incomplete foreign-note reads while the generated entity enforces both MUSTs", () => {
  for (const body of [
    `<${SUBJECT}> a as:Note .`,
    `<${SUBJECT}> a as:Note ; as:published "invalid" .`,
    `<${SUBJECT}> a as:Note ; as:published "invalid"^^xsd:dateTime .`,
  ]) {
    const store = dataset(body);
    expect(entities.Message.parse(SUBJECT, store)).toBeUndefined();
    expect(parseAs2Message(SUBJECT, store)).toEqual({
      id: SUBJECT,
      content: "",
      mediaType: "text/plain",
    });
    const before = [...store];
    parseAs2Message(SUBJECT, store);
    expect([...store]).toEqual(before);
  }
});

describe("exact divergences: SHACL scalar guards", () => {
  it.each([
    '"bonjour"@fr',
    '"5"^^xsd:integer',
    "<https://example.org/text>",
    "[]",
  ])("drops non-string text %s rather than keeping its lexical spelling", (value) => {
    const store = dataset(`<${SUBJECT}> a as:Note, wf:Task ; as:content ${value} ;
        as:mediaType ${value} ; dct:title ${value} .`);
    expect(parseAs2Message(SUBJECT, store)).toEqual({
      id: SUBJECT,
      content: "",
      mediaType: "text/plain",
      task: { state: "open" },
    });
  });

  it("drops ambiguous content, media type, timestamps and task title instead of choosing the first", () => {
    const store = dataset(`<${SUBJECT}> a as:Note, wf:Task ;
      as:content "one", "two" ; as:mediaType "text/plain", "text/markdown" ;
      as:published "2026-01-01T00:00:00Z"^^xsd:dateTime, "2026-01-02T00:00:00Z"^^xsd:dateTime ;
      schema:dateDeleted "2026-01-01T00:00:00Z"^^xsd:dateTime, "2026-01-02T00:00:00Z"^^xsd:dateTime ;
      dct:title "one", "two" .`);
    expect(parseAs2Message(SUBJECT, store)).toEqual({
      id: SUBJECT,
      content: "",
      mediaType: "text/plain",
      task: { state: "open" },
    });
  });

  it.each([
    '"2026-01-01"^^xsd:date',
    '"2026-02-30T00:00:00Z"^^xsd:dateTime',
    '"2026-01-01T00:00:00Z"',
    '"2026-01-01T00:00:00Z"@en',
  ])("drops dates outside the validated xsd:dateTime contract: %s", (value) => {
    const store = dataset(`<${SUBJECT}> a as:Note ; as:content "Body" ;
        as:published ${value} ; schema:dateDeleted ${value} .`);
    const parsed = parseAs2Message(SUBJECT, store);
    expect(parsed?.published).toBeUndefined();
    expect(parsed?.deletedAt).toBeUndefined();
    expect(parsed?.content).toBe("Body");
  });

  it("drops invalid Date and mistyped text writes instead of throwing", () => {
    const store = buildAs2Message(SUBJECT, {
      content: "Body",
      mediaType: "text/plain",
      published: "invalid",
      deletedAt: "invalid",
    });
    expect(parseAs2Message(SUBJECT, store)).toEqual({
      id: SUBJECT,
      content: "Body",
      mediaType: "text/plain",
    });
    const mistyped = buildAs2Message(SUBJECT, {
      content: 5 as unknown as string,
      mediaType: "text/plain",
      published: "2026-01-01T00:00:00Z",
      task: { state: "open", title: 6 as unknown as string },
    });
    expect(parseAs2Message(SUBJECT, mistyped)).toEqual({
      id: SUBJECT,
      content: "",
      mediaType: "text/plain",
      published: "2026-01-01T00:00:00.000Z",
      task: { state: "open" },
    });
  });
});

const iriFields = [
  ["as:attributedTo", (m: ReturnType<typeof parseAs2Message>) => m?.author],
  ["as:context", (m: ReturnType<typeof parseAs2Message>) => m?.room],
  ["as:inReplyTo", (m: ReturnType<typeof parseAs2Message>) => m?.inReplyTo],
  ["dct:isReplacedBy", (m: ReturnType<typeof parseAs2Message>) => m?.replacedBy],
  ["prov:wasAttributedTo", (m: ReturnType<typeof parseAs2Message>) => m?.provenance?.attributedTo],
  ["prov:wasGeneratedBy", (m: ReturnType<typeof parseAs2Message>) => m?.provenance?.generatedBy],
  ["prov:wasDerivedFrom", (m: ReturnType<typeof parseAs2Message>) => m?.provenance?.derivedFrom],
  ["wf:assignee", (m: ReturnType<typeof parseAs2Message>) => m?.task?.assignee],
] as const;

it.each(
  iriFields,
)("drops ambiguous or wrongly typed %s without losing the note", (predicate, read) => {
  for (const value of [
    "<https://one.example/a>, <https://two.example/b>",
    '<https://one.example/a>, "garbage"',
    '"https://literal.example/a"',
    "[]",
    "<urn:uuid:hostile>",
  ]) {
    const store = note(`; a wf:Task ; ${predicate} ${value}`);
    const result = parseAs2Message(SUBJECT, store);
    expect(result?.content).toBe("Body");
    expect(read(result)).toBeUndefined();
  }
});

it.each([
  "https://EXAMPLE.org:443",
  "HTTPS://EXAMPLE.org:443/a",
  "https://example.org/é",
  "https://example.org/a>bad",
  "https://example.org/#a|b",
  " https://example.org/a ",
])("preserves chat lexical IRI policy across all eight fields: %s", async (value) => {
  const input = {
    content: "Body",
    mediaType: "text/plain",
    published: "2026-01-01T00:00:00Z",
    author: value,
    room: value,
    inReplyTo: value,
    replacedBy: value,
    provenance: { attributedTo: value, generatedBy: value, derivedFrom: value },
    task: { state: "open" as const, assignee: value },
  };
  const store = buildAs2Message(SUBJECT, input);
  const result = parseAs2Message(SUBJECT, store);
  for (const [, read] of iriFields) expect(read(result)).toBe(safeHttpIri(value));
  const serialized = await serializeAs2(input, SUBJECT);
  expect(new Parser().parse(serialized).every((q) => q.subject.value === SUBJECT)).toBe(true);
  expect(parseAs2Message(SUBJECT, new Store(new Parser().parse(serialized)))).toEqual(result);
});

it("retains closed-wins task policy and ignores malformed type terms", () => {
  const store = note('; a wf:Task, wf:Open, wf:Closed, "garbage" ; dct:title "Task"');
  expect(parseAs2Message(SUBJECT, store)?.task).toEqual({ state: "closed", title: "Task" });
  expect(parseAs2Message(SUBJECT, note('; dct:title "Unattached"'))?.task).toBeUndefined();
});

it("counts distinct IRI objects across graphs rather than duplicate quads", () => {
  const store = note("; as:attributedTo <https://alice.example/me>");
  const named = dataset(
    `<https://example.org/graph> { <${SUBJECT}> as:attributedTo <https://alice.example/me> . }`,
  );
  store.addQuads([...named]);
  expect(parseAs2Message(SUBJECT, store)?.author).toBe("https://alice.example/me");
});

it("recognises data-graph subclasses of notes and collections, with cycle-safe rejection", () => {
  const store = dataset(`<https://example.org/Sub> rdfs:subClassOf as:Note .
    <${SUBJECT}> a <https://example.org/Sub> ; as:content "Subclass" .`);
  expect(parseAs2Message(SUBJECT, store)?.content).toBe("Subclass");
  const room = dataset(`<https://example.org/Sub> rdfs:subClassOf as:Collection .
    <${SUBJECT}> a <https://example.org/Sub> ; as:name "Title" ; dct:identifier "id" .`);
  expect(parseConversation(SUBJECT, room)).toEqual({ title: "Title", identifier: "id" });
  const cycle = dataset(`<https://example.org/Sub> rdfs:subClassOf <https://example.org/Sub> .
    <${SUBJECT}> a <https://example.org/Sub> ; as:content "Not a note" .`);
  expect(parseAs2Message(SUBJECT, cycle)).toBeUndefined();
});

it("keeps direct wrappers as guarded generated views, including lexical URL normalization", () => {
  const doc = new As2MessageDoc(SUBJECT, new Store(), DataFactory).markNote();
  doc.content = "a\u0000b";
  doc.author = "https://EXAMPLE.org:443";
  expect(doc.content).toBe("ab");
  expect(doc.author).toBe("https://example.org/");
  doc.author = "urn:uuid:bad";
  expect(doc.author).toBeUndefined();
  doc.author = "https://example.org/#a|b";
  expect(doc.author).toBeUndefined();
  doc.author = undefined;
  doc.content = undefined;
  expect(doc.content).toBeUndefined();
  expect(doc.markNote()).toBe(doc);
  expect(() => new As2MessageDoc("relative", new Store(), DataFactory)).toThrow(TypeError);
  expect(() => new As2MessageDoc(DataFactory.blankNode(), new Store(), DataFactory)).toThrow(
    TypeError,
  );
  expect(parseAs2Message("relative", new Store())).toBeUndefined();
});

it("rejects ambiguous or mistyped stored conversation metadata", () => {
  for (const [identifier, title] of [
    ['"one", "two"', '"Title"'],
    ['"id"', '"one", "two"'],
    ['"id"@en', '"Title"'],
    ['"id"', '"5"^^xsd:integer'],
  ]) {
    const store = dataset(
      `<${SUBJECT}> a as:Collection ; as:name ${title} ; dct:identifier ${identifier} .`,
    );
    expect(parseConversation(SUBJECT, store)).toBeUndefined();
  }
  expect(
    parseConversation(SUBJECT, buildConversation(SUBJECT, { identifier: "id", title: "" })),
  ).toEqual({ identifier: "id", title: "" });
});

it("guards writer identifier/role metadata without changing the public canonical message", () => {
  const store = note('; dct:identifier "one", "two" ; dct:type "user", "assistant"');
  const doc = new As2MessageDoc(SUBJECT, store, DataFactory);
  expect(doc.identifier).toBeUndefined();
  expect(doc.role).toBeUndefined();
  doc.role = "unknown";
  expect(doc.role).toBeUndefined();
  doc.role = "tool";
  expect(doc.role).toBe("tool");
  expect(parseAs2Message(SUBJECT, store)).toEqual({
    id: SUBJECT,
    content: "Body",
    mediaType: "text/plain",
    published: "2026-01-01T00:00:00.000Z",
  });
});

it("fails ChatWriter reads closed on ambiguous generated metadata", async () => {
  const root = "https://pod.example/";
  const room = `${root}private/chats/codex/id/`;
  const metadata = `${room}_conversation.ttl`;
  const message = `${room}m-event.ttl`;
  for (const [title, identifier, role, messageId] of [
    ['"one", "two"', '"id"', '"user"', '"event"'],
    ['"Title"', '"id", "other"', '"user"', '"event"'],
    ['"Title"@en', '"id"', '"user"', '"event"'],
    ['"Title"', '"id"', '"user", "assistant"', '"event"'],
    ['"Title"', '"id"', '"user"', '"event", "other"'],
  ]) {
    const writer = new ChatWriter({
      root,
      webId: `${root}profile#me`,
      async read(url) {
        const turtle =
          url === metadata
            ? `<${metadata}#it> a as:Collection ; as:name ${title} ; dct:identifier ${identifier} .`
            : `<${message}#it> a as:Note ; as:content "Body" ; as:context <${room}> ;
            as:published "2026-01-01T00:00:00Z"^^xsd:dateTime ; dct:type ${role} ; dct:identifier ${messageId} .`;
        return { body: new TextEncoder().encode(prefixes + turtle), contentType: "text/turtle" };
      },
      async list() {
        return [{ url: message, isContainer: false }];
      },
      async discoverAcl() {
        throw new Error("unexpected write");
      },
      async write() {
        throw new Error("unexpected write");
      },
    });
    await expect(writer.get("codex", "id")).rejects.toThrow(
      /Invalid (conversation metadata|stored chat message)/,
    );
  }
});

it("retains every published scalar SHACL constraint in the generated profile", () => {
  const sh = "http://www.w3.org/ns/shacl#";
  const extract = (ttl: string) => {
    const quads = new Parser().parse(ttl);
    const result = new Map<string, string[]>();
    for (const path of quads.filter((q) => q.predicate.value === `${sh}path`)) {
      if (path.object.value.endsWith("#type")) continue;
      result.set(
        path.object.value,
        quads
          .filter(
            (q) =>
              q.subject.equals(path.subject) &&
              q.predicate.value !== `${sh}name` &&
              q.predicate.value !== `${sh}path`,
          )
          .map((q) => `${q.predicate.value}=${q.object.termType}:${q.object.value}`)
          .sort(),
      );
    }
    return result;
  };
  const published = extract(messageShapeTtl());
  const generated = extract(
    readFileSync(new URL("../src/generated/shapes.ttl", import.meta.url), "utf8"),
  );
  for (const [path, constraints] of published)
    expect(generated.get(path), path).toEqual(constraints);
});

it("validates generated note/collection builds and rejects missing MUSTs through SHACL", async () => {
  const shapes = readFileSync(new URL("../src/generated/shapes.ttl", import.meta.url), "utf8");
  expect((await engine.validate(buildAs2Message(SUBJECT, oracle.msg), shapes)).conforms).toBe(true);
  expect(
    (
      await engine.validate(
        buildConversation(SUBJECT, { identifier: "id", title: "Title" }),
        shapes,
      )
    ).conforms,
  ).toBe(true);
  expect((await engine.validate(dataset(`<${SUBJECT}> a as:Note .`), shapes)).conforms).toBe(false);
  expect((await engine.validate(dataset(`<${SUBJECT}> a as:Collection .`), shapes)).conforms).toBe(
    false,
  );
});

it("bundles runtime JS and keeps every emitted declaration self-contained for mirrors", () => {
  const dist = new URL("../dist/", import.meta.url);
  const files = readdirSync(dist, { recursive: true, encoding: "utf8" });
  for (const file of files.filter((name) => name.endsWith(".js") || name.endsWith(".d.ts"))) {
    const text = readFileSync(new URL(file, dist), "utf8");
    expect(text, file).not.toMatch(/(?:from\s*|import\s*\()["']@jeswr\/model-runtime/);
    if (file.endsWith(".d.ts")) expect(text, file).not.toContain("./generated/");
  }
});

it("preserves strict consumer constructor, chaining and clearing-setter types", async () => {
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

describe("generated profile parity", () => {
  it("keeps CHAT_ROLES identical to the generated role sh:in list", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../src/generated/model.json", import.meta.url), "utf8"),
    ) as { entities: { fields: { name: string; predicate: string; in?: string[] }[] }[] };
    const roles = manifest.entities
      .flatMap((entity) => entity.fields)
      .filter((field) => field.name === "role");
    expect(roles).toHaveLength(1);
    expect(roles[0]?.in).toEqual([...CHAT_ROLES]);
  });
});
