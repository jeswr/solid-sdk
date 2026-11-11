// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  buildScene,
  parseScene,
  parseSceneTtl,
  sceneSubject,
  serializeScene,
  storeToTurtle,
} from "../src/scene.js";
import { drawingShapeTtl } from "../src/shape.js";
import { DRAW, LEGACY_DRAW_NS } from "../src/vocab.js";

const RES = "https://pod.example/drawing/1";
const CANVAS = "https://pod.example/drawing/1.excalidraw";
const engine = createRdfEngine();
afterAll(() => engine.dispose());
const generatedShapes = readFileSync(
  new URL("../src/generated/shapes.ttl", import.meta.url),
  "utf8",
);

function graph(body: string): Store {
  return new Store(
    new Parser({ baseIRI: RES }).parse(`
    @prefix draw: <${DRAW}> . @prefix old: <${LEGACY_DRAW_NS}> .
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    ${body}`),
  );
}
const descriptor = (body: string) =>
  graph(`<#it> a draw:Scene ; draw:sceneDocument <${CANVAS}> ; ${body} .`);

it("drops malformed typed timestamps on reads and writes", async () => {
  for (const invalid of [
    "yesterday",
    "2026-02-30T10:00:00Z",
    "2026-01-01",
    "999999-01-01T00:00:00Z",
  ]) {
    const input = descriptor(
      `dct:created "${invalid}"^^xsd:dateTime ; dct:modified "${invalid}"^^xsd:dateTime`,
    );
    expect(parseScene(RES, input)).toEqual({ sceneDocument: CANVAS });
    const built = buildScene(RES, { sceneDocument: CANVAS, created: invalid, modified: invalid });
    expect(parseScene(RES, built)).toEqual({ sceneDocument: CANVAS });
    expect(
      [...built].some(
        (q) => q.predicate.value.endsWith("/created") || q.predicate.value.endsWith("/modified"),
      ),
    ).toBe(false);
    expect((await engine.validate(built, generatedShapes)).conforms).toBe(true);
    expect(
      await parseSceneTtl(
        RES,
        await serializeScene(RES, { sceneDocument: CANVAS, created: invalid }),
      ),
    ).toEqual({ sceneDocument: CANVAS });
  }
});

it("projects timestamp strings to canonical UTC at millisecond precision", async () => {
  for (const [lexical, expected] of [
    ["2026-06-21T10:00:00+02:00", "2026-06-21T08:00:00.000Z"],
    ["2026-06-21T10:00:00.123456Z", "2026-06-21T10:00:00.123Z"],
    ["2026-06-21T10:00:00", "2026-06-21T10:00:00.000Z"],
    ["10000-01-01T00:00:00Z", "10000-01-01T00:00:00.000Z"],
    ["-0001-01-01T00:00:00Z", "-0001-01-01T00:00:00.000Z"],
  ] as const) {
    const input = descriptor(
      `dct:created "${lexical}"^^xsd:dateTime ; dct:modified "${lexical}"^^xsd:dateTime`,
    );
    expect(parseScene(RES, input)).toEqual({
      sceneDocument: CANVAS,
      created: expected,
      modified: expected,
    });
    const ttl = await serializeScene(RES, {
      sceneDocument: CANVAS,
      created: lexical,
      modified: lexical,
    });
    expect(await parseSceneTtl(RES, ttl)).toEqual({
      sceneDocument: CANVAS,
      created: expected,
      modified: expected,
    });
    expect(
      new Parser()
        .parse(ttl)
        .filter((q) => q.object.termType === "Literal")
        .map((q) => q.object.value),
    ).toEqual([expected, expected]);
    const parsed = parseScene(RES, input);
    if (!parsed) throw new Error("expected a scene");
    const edited = await serializeScene(RES, { ...parsed, title: "edit" });
    expect((await parseSceneTtl(RES, edited))?.created).toBe(expected);
  }
});

it.each([
  DRAW,
  LEGACY_DRAW_NS,
])("carries arbitrary literal version/background values from %s", async (ns) => {
  const input = descriptor(
    `<${ns}schemaVersion> "02"^^xsd:integer ; <${ns}viewBackgroundColor> "rouge"@fr`,
  );
  expect(entities.Scene.parse(RES, input)).toEqual({ sceneDocument: CANVAS });
  const data = parseScene(RES, input);
  expect(data).toEqual({
    sceneDocument: CANVAS,
    schemaVersion: "02",
    viewBackgroundColor: "rouge",
  });
  expect((await engine.validate(input, drawingShapeTtl())).conforms).toBe(true);
  expect((await engine.validate(input, generatedShapes)).conforms).toBe(false);
  if (!data) throw new Error("expected a scene");
  expect(await parseSceneTtl(RES, await serializeScene(RES, { ...data, title: "edit" }))).toEqual({
    ...data,
    title: "edit",
  });
  expect(
    parseScene(
      RES,
      descriptor(
        `<${ns}schemaVersion> <https://example.org/not-a-literal> ; <${ns}viewBackgroundColor> []`,
      ),
    ),
  ).toEqual({ sceneDocument: CANVAS });
});

it("enforces raw union cardinality even when canonical-first projection would succeed", () => {
  const required = graph(
    `<#it> a draw:Scene ; draw:sceneDocument <${CANVAS}> ; old:sceneDocument "invalid" .`,
  );
  expect(entities.Scene.parse(RES, required)?.sceneDocument).toBe(CANVAS);
  expect(parseScene(RES, required)).toBeUndefined();
  const optional = descriptor(
    'draw:schemaVersion "2" ; old:schemaVersion "02"^^xsd:integer ; draw:viewBackgroundColor "red" ; old:viewBackgroundColor "red"@en',
  );
  expect(entities.Scene.parse(RES, optional)?.schemaVersion).toBe("2");
  expect(parseScene(RES, optional)).toEqual({ sceneDocument: CANVAS });
  const identical = descriptor('draw:schemaVersion "2" ; old:schemaVersion "2"');
  expect(parseScene(RES, identical)?.schemaVersion).toBe("2");
});

it("keeps cardinality checks across named graphs without mutating input", () => {
  const input = graph(`<#it> a draw:Scene ; draw:sceneDocument <${CANVAS}> ; dct:title "one" .`);
  const title = [...input].find((q) => q.predicate.value === "http://purl.org/dc/terms/title");
  if (!title) throw new Error("expected a title");
  input.addQuad(
    DataFactory.quad(
      title.subject,
      title.predicate,
      title.object,
      DataFactory.namedNode("https://pod.example/graph"),
    ),
  );
  const before = [...input];
  expect(parseScene(RES, input)).toEqual({ sceneDocument: CANVAS });
  expect([...input]).toEqual(before);
});

it.each([DRAW, LEGACY_DRAW_NS])("recognises data-graph subclasses of %sScene", (ns) => {
  const input = graph(`<https://example.org/Sketch> rdfs:subClassOf <${ns}Scene> .
    <#it> a <https://example.org/Sketch> ; draw:sceneDocument <${CANVAS}> .`);
  expect(parseScene(RES, input)).toEqual({ sceneDocument: CANVAS });
  expect(
    parseScene(
      RES,
      graph(`<https://example.org/A> rdfs:subClassOf <https://example.org/B> .
    <https://example.org/B> rdfs:subClassOf <https://example.org/A> .
    <#it> a <https://example.org/A> ; draw:sceneDocument <${CANVAS}> .`),
    ),
  ).toBeUndefined();
});

it("keeps lexical IRI identity and arbitrary read schemes without applying the runtime URL normalizer", async () => {
  const lexical = "HTTPS://EXAMPLE.org:443/a/../b";
  const built = buildScene(RES, {
    sceneDocument: lexical,
    thumbnail: lexical,
    about: lexical,
    wasGeneratedBy: lexical,
  });
  expect(parseScene(RES, built)).toEqual({
    sceneDocument: lexical,
    thumbnail: lexical,
    about: lexical,
    wasGeneratedBy: lexical,
  });
  const input = graph(
    "<#it> a draw:Scene ; draw:sceneDocument <urn:example:canvas> ; draw:thumbnail <urn:example:thumb> .",
  );
  expect(parseScene(RES, input)).toEqual({
    sceneDocument: "urn:example:canvas",
    thumbnail: "urn:example:thumb",
  });
  expect(await parseSceneTtl(RES, await serializeScene(RES, { sceneDocument: lexical }))).toEqual({
    sceneDocument: lexical,
  });
});

it("keeps empty text and control characters through configured lexical text writes", async () => {
  const data = {
    sceneDocument: CANVAS,
    title: "a\u0000b\u0085",
    schemaVersion: "",
    viewBackgroundColor: "\t\n\r",
  };
  expect(parseScene(RES, buildScene(RES, data))).toEqual(data);
  expect(await parseSceneTtl(RES, await serializeScene(RES, data))).toEqual(data);
});

it("rejects C1 controls in subjects/required IRIs and drops them in optional IRI writes", async () => {
  const unsafe = "https://pod.example/a\u0085b";
  expect(() => sceneSubject(unsafe)).toThrow(TypeError);
  expect(() => buildScene(RES, { sceneDocument: unsafe })).toThrow(TypeError);
  await expect(serializeScene(RES, { sceneDocument: unsafe })).rejects.toThrow(TypeError);
  expect(
    parseScene(
      RES,
      buildScene(RES, {
        sceneDocument: CANVAS,
        thumbnail: unsafe,
        about: unsafe,
        wasGeneratedBy: unsafe,
      }),
    ),
  ).toEqual({ sceneDocument: CANVAS });
  expect(
    parseScene(RES, graph(`<#it> a draw:Scene ; draw:sceneDocument <${unsafe}> .`)),
  ).toBeUndefined();
  expect(parseScene(RES, descriptor(`draw:thumbnail <${unsafe}>`))).toEqual({
    sceneDocument: CANVAS,
  });
});

it("keeps generic Store serialization lossless for arbitrary legacy triples", async () => {
  const input = graph(
    '<#it> a old:Scene ; old:sceneDocument <urn:example:canvas> ; old:schemaVersion "02"^^xsd:integer .',
  );
  const before = [...input];
  const ttl = await storeToTurtle(input);
  expect(ttl).toContain(`${LEGACY_DRAW_NS}Scene`);
  expect(ttl).toContain(`${LEGACY_DRAW_NS}schemaVersion`);
  expect(new Store(new Parser().parse(ttl)).size).toBe(input.size);
  expect([...input]).toEqual(before);
});

it("pins generated predicate and JSON field order", async () => {
  const input = {
    sceneDocument: CANVAS,
    title: "Title",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    schemaVersion: "2",
    viewBackgroundColor: "#fff",
    thumbnail: "https://example.org/thumb",
    about: "https://example.org/about",
    wasGeneratedBy: "https://example.org/activity",
  };
  const built = buildScene(RES, input);
  expect([...built].map((q) => q.predicate.value)).toEqual([
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    "http://purl.org/dc/terms/created",
    "http://purl.org/dc/terms/modified",
    "http://purl.org/dc/terms/title",
    "http://schema.org/about",
    "http://www.w3.org/ns/prov#wasGeneratedBy",
    `${DRAW}sceneDocument`,
    `${DRAW}schemaVersion`,
    `${DRAW}thumbnail`,
    `${DRAW}viewBackgroundColor`,
  ]);
  const ttl = await serializeScene(RES, input);
  expect(new Parser().parse(ttl).map((q) => q.predicate.value)).toEqual(
    [...built].map((q) => q.predicate.value),
  );
  const parsed = parseScene(RES, built);
  expect(parsed).toEqual(input);
  expect(Object.keys(parsed ?? {})).toEqual([
    "title",
    "about",
    "wasGeneratedBy",
    "sceneDocument",
    "schemaVersion",
    "thumbnail",
    "viewBackgroundColor",
    "created",
    "modified",
  ]);
});

it("ships a working generated runtime and preserves the public TTL subpath exports", async () => {
  await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { buildScene, parseScene, serializeScene, parseSceneTtl } from '@jeswr/solid-drawing';
    import { drawingShapeTtl, drawingOntologyTtl } from '@jeswr/solid-drawing/shape';
    const data = { sceneDocument: ${JSON.stringify(CANVAS)}, title: 'built' };
    assert.deepEqual(parseScene(${JSON.stringify(RES)}, buildScene(${JSON.stringify(RES)}, data)), data);
    assert.deepEqual(await parseSceneTtl(${JSON.stringify(RES)}, await serializeScene(${JSON.stringify(RES)}, data)), data);
    for (const [subpath, content] of [['drawing.ttl', drawingOntologyTtl()], ['drawing.shacl.ttl', drawingShapeTtl()]]) {
      assert.equal(readFileSync(new URL(import.meta.resolve('@jeswr/solid-drawing/' + subpath)), 'utf8'), content);
    }
  `,
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
});

it("validates minimal canonical and legacy scenes and rejects malformed links with generated SHACL", async () => {
  for (const ns of [DRAW, LEGACY_DRAW_NS]) {
    for (const [body, conforms] of [
      [`<#it> a <${ns}Scene> ; <${ns}sceneDocument> <${CANVAS}> .`, true],
      [`<#it> a <${ns}Scene> .`, false],
      [`<#it> a <${ns}Scene> ; <${ns}sceneDocument> "not an IRI" .`, false],
      [
        `<#it> a <${ns}Scene> ; <${ns}sceneDocument> <${CANVAS}>, <https://example.org/other> .`,
        false,
      ],
    ] as const) {
      expect((await engine.validate(graph(body), generatedShapes)).conforms).toBe(conforms);
    }
  }
  const conflicts = descriptor(`old:sceneDocument <https://example.org/other>`);
  expect((await engine.validate(conflicts, generatedShapes)).conforms).toBe(false);
});

it("keeps string timestamp types and every public scene operation in built declarations", async () => {
  await promisify(execFile)(process.execPath, [
    createRequire(import.meta.url).resolve("typescript/bin/tsc"),
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
    fileURLToPath(new URL("consumer.ts", import.meta.url)),
  ]);
}, 30_000);

it("drops unsafe or relative IRI reads and rejects an unsafe required canvas link", () => {
  for (const lexical of ["relative/canvas", "https://example.org/a b", "https://example.org/a>b"]) {
    // DatasetCore callers can supply NamedNodes a Turtle parser would refuse.
    const input = buildScene(RES, { sceneDocument: CANVAS });
    const subject = sceneSubject(RES);
    for (const predicate of [
      `${DRAW}thumbnail`,
      "http://schema.org/about",
      "http://www.w3.org/ns/prov#wasGeneratedBy",
    ]) {
      input.addQuad(
        DataFactory.quad(subject, DataFactory.namedNode(predicate), DataFactory.namedNode(lexical)),
      );
    }
    expect(parseScene(RES, input)).toEqual({ sceneDocument: CANVAS });
    input.removeMatches(subject, DataFactory.namedNode(`${DRAW}sceneDocument`), null, null);
    input.addQuad(
      DataFactory.quad(
        subject,
        DataFactory.namedNode(`${DRAW}sceneDocument`),
        DataFactory.namedNode(lexical),
      ),
    );
    expect(parseScene(RES, input)).toBeUndefined();
  }
});
