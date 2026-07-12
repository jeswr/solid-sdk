// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { buildAs2Message } from "./as2.js";
import type { CanonicalMessage } from "./canonical.js";
import { messageShapeTtl } from "./shape.js";
import { AS_NOTE } from "./vocab.js";

const ROOM = "http://localhost:3000/alice/chat/room.ttl#this";
const URL_ = "http://localhost:3000/alice/chat/msg-1.ttl#it";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Parser/Store into an env dataset — the exact pattern
// solid-task-model's shape test uses, so verdicts match across the suite.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(messageShapeTtl()));

async function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: URL_ }).parse(ttl));
  return await new SHACLValidator(shapes, { factory: env }).validate(data);
}

async function validateStore(msg: CanonicalMessage) {
  const store = buildAs2Message(URL_, msg);
  return await new SHACLValidator(shapes, { factory: env }).validate(toDataset(store));
}

describe("SHACL shape (shapes/message.shacl.ttl)", () => {
  it("the shape parses, is a NodeShape and targets the canonical message class as:Note", () => {
    const quads = new Parser().parse(messageShapeTtl());
    const targetClass = quads.find(
      (q) => q.predicate.value === "http://www.w3.org/ns/shacl#targetClass",
    );
    expect(targetClass?.object.value).toBe(AS_NOTE);
    expect(AS_NOTE).toBe("https://www.w3.org/ns/activitystreams#Note");
    const nodeShape = quads.find(
      (q) =>
        q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
        q.object.value === "http://www.w3.org/ns/shacl#NodeShape",
    );
    expect(nodeShape).toBeDefined();
  });

  it("covers the predicates the message components render (the EXACT paths As2MessageDoc writes)", () => {
    const ttl = messageShapeTtl();
    // The fields jeswr-message-list / jeswr-shacl-view render: author, content
    // (text), timestamp, inReplyTo — plus the canonicalised AS2.0/LongChat fields.
    const expectedPaths = [
      "https://www.w3.org/ns/activitystreams#content", // content (body text)
      "https://www.w3.org/ns/activitystreams#mediaType", // media type
      "https://www.w3.org/ns/activitystreams#published", // timestamp
      "https://www.w3.org/ns/activitystreams#attributedTo", // author (WebID)
      "https://www.w3.org/ns/activitystreams#context", // room
      "https://www.w3.org/ns/activitystreams#inReplyTo", // reply edge
      "http://purl.org/dc/terms/isReplacedBy", // edit pointer
      "http://schema.org/dateDeleted", // soft-delete tombstone
      "http://www.w3.org/ns/prov#wasAttributedTo", // PROV-O attribution
      "http://www.w3.org/ns/prov#wasGeneratedBy",
      "http://www.w3.org/ns/prov#wasDerivedFrom",
      "http://purl.org/dc/terms/title", // task overlay title
      "http://www.w3.org/2005/01/wf/flow#assignee", // task overlay assignee
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", // task state (wf:Open/Closed)
    ];
    const quads = new Parser().parse(ttl);
    const declaredPaths = new Set(
      quads
        .filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#path")
        .map((q) => q.object.value),
    );
    for (const p of expectedPaths) {
      expect(declaredPaths.has(p), `shape declares sh:path <${p}>`).toBe(true);
    }
  });

  it("a fully-populated, well-formed message conforms", async () => {
    const data: CanonicalMessage = {
      content: "Hello, world!",
      mediaType: "text/plain",
      author: ME,
      published: "2026-06-09T10:00:00.000Z",
      room: ROOM,
      inReplyTo: "http://localhost:3000/alice/chat/msg-0.ttl#it",
    };
    const report = await validateStore(data);
    expect(report.conforms).toBe(true);
  });

  it("a minimal message (content only) conforms — published is defaulted to now on write", async () => {
    const report = await validateStore({ content: "Minimal", mediaType: "text/plain" });
    expect(report.conforms).toBe(true);
  });

  it("an AI-authored message (PROV-O attribution, no human author) conforms", async () => {
    const report = await validateStore({
      content: "Generated reply.",
      mediaType: "text/plain",
      provenance: {
        attributedTo: "http://localhost:3000/agent/profile/card#me",
        generatedBy: "https://example.org/models/claude",
        derivedFrom: "http://localhost:3000/alice/chat/msg-0.ttl#it",
      },
    });
    expect(report.conforms).toBe(true);
  });

  it("an actionable message (wf:Task overlay) conforms with one state class", async () => {
    const report = await validateStore({
      content: "Please review the PR.",
      mediaType: "text/plain",
      task: { state: "open", title: "Review PR", assignee: BOB },
    });
    expect(report.conforms).toBe(true);
  });

  it("a closed actionable message conforms", async () => {
    const report = await validateStore({
      content: "Done.",
      mediaType: "text/plain",
      task: { state: "closed", title: "Review PR" },
    });
    expect(report.conforms).toBe(true);
  });

  it("a message with NO content is non-conforming (content is required)", async () => {
    // Hand-craft an as:Note with no as:content — minCount 1 fails.
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("content"))).toBe(true);
  });

  it("a message with NO published timestamp is non-conforming (published is required)", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      <#it> a as:Note ;
        as:content "no timestamp" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("published"))).toBe(true);
  });

  it("a non-http(s) author is rejected by the sh:pattern", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:content "bad author" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        as:attributedTo <urn:agent:bob> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("attributedTo"))).toBe(true);
  });

  it("a non-http(s) dct:isReplacedBy is rejected by the sh:pattern", async () => {
    // Regression: the edit pointer must be http(s)-only like the sibling IRI fields
    // and the canonical reader/writer (httpIriOrUndefined filters replacedBy).
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:content "edited message" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        dct:isReplacedBy <urn:msg:next> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("isReplacedBy"))).toBe(true);
  });

  it("an http(s) dct:isReplacedBy conforms", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:content "edited message" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        dct:isReplacedBy <http://localhost:3000/alice/chat/msg-2.ttl#it> .
    `;
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });

  it("two as:content values are non-conforming (maxCount 1 on the body)", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:content "first" ;
        as:content "second" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("content"))).toBe(true);
  });

  it("an actionable message typed BOTH wf:Open and wf:Closed warns (advisory state rule)", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note, wf:Task, wf:Open, wf:Closed ;
        as:content "contradictory state" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    // The state shape is sh:Warning severity → a result, but advisory (not fatal).
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.some((r) => String(r.severity?.value).endsWith("Warning"))).toBe(true);
  });

  it("a plain message (no wf:Task, no state class) conforms — the overlay is optional", async () => {
    const ttl = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note ;
        as:content "plain message, no task" ;
        as:published "2026-06-09T10:00:00.000Z"^^xsd:dateTime .
    `;
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });
});
