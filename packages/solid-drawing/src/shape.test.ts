// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { type SceneData, serializeScene } from "./scene.js";
import { drawingOntologyTtl, drawingShapeTtl } from "./shape.js";
import { DRAW_SCENE_IRI } from "./vocab.js";

const URL_ = "http://localhost:3000/alice/drawings/diagram.ttl";
const CANVAS = "http://localhost:3000/alice/drawings/diagram.excalidraw";

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Parser into an env dataset — the exact pattern the
// suite's solid-task-model shape test uses, so verdicts match across the suite.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(drawingShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: URL_ }).parse(ttl));
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

describe("the SHACL shape + ontology TTLs are themselves valid Turtle", () => {
  it("drawing.shacl.ttl parses and declares a NodeShape targeting draw:Scene", () => {
    const quads = new Parser().parse(drawingShapeTtl());
    expect(quads.length).toBeGreaterThan(0);
    const targets = quads
      .filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#targetClass")
      .map((q) => q.object.value);
    expect(targets).toContain(DRAW_SCENE_IRI);
  });

  it("drawing.ttl parses and defines draw:Scene as a subClassOf schema:CreativeWork", () => {
    const quads = new Parser().parse(drawingOntologyTtl());
    const subClassOf = quads
      .filter(
        (q) =>
          q.subject.value === DRAW_SCENE_IRI &&
          q.predicate.value === "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      )
      .map((q) => q.object.value);
    expect(subClassOf).toContain("http://schema.org/CreativeWork");
    expect(subClassOf).toContain("https://w3id.org/jeswr/core#InformationResource");
  });
});

describe("SHACL shape (drawing.shacl.ttl)", () => {
  it("a fully-populated, well-formed scene conforms", async () => {
    const data: SceneData = {
      sceneDocument: CANVAS,
      title: "System architecture",
      created: "2026-06-21T10:00:00.000Z",
      modified: "2026-06-21T11:30:00.000Z",
      schemaVersion: "2",
      viewBackgroundColor: "#ffffff",
      thumbnail: "http://localhost:3000/alice/drawings/diagram.png",
      about: "http://localhost:3000/alice/projects/roadmap#it",
      wasGeneratedBy: "http://localhost:3000/alice/activities/edit-1#it",
    };
    const report = await validateTtl(await serializeScene(URL_, data));
    expect(report.conforms).toBe(true);
  });

  it("a minimal scene (only the canvas link) conforms", async () => {
    const report = await validateTtl(await serializeScene(URL_, { sceneDocument: CANVAS }));
    expect(report.conforms).toBe(true);
  });

  it("a scene with NO draw:sceneDocument is non-conforming (minCount 1)", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ; dct:title "Orphan scene" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("sceneDocument"))).toBe(true);
  });

  it("a draw:sceneDocument that is a literal (not an IRI) is rejected", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      <#it> a draw:Scene ; draw:sceneDocument "not-an-iri" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("sceneDocument"))).toBe(true);
  });

  it("two draw:sceneDocument links are rejected (maxCount 1)", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ,
                           <http://localhost:3000/alice/drawings/other.excalidraw> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("sceneDocument"))).toBe(true);
  });

  it("a non-dateTime dct:created is rejected", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:created "yesterday" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("created"))).toBe(true);
  });

  it("a thumbnail that is a literal (not an IRI) is rejected", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        draw:thumbnail "preview.png" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("thumbnail"))).toBe(true);
  });
});
