// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { scrobbleSubject, serializeScrobble } from "./scrobble.js";
import { listeningProposalsTtl, listeningShapeTtl } from "./shape.js";

const RES = "http://localhost:3000/alice/listening/x";
const SUBJ = scrobbleSubject(RES);

const PREFIXES = `
  @prefix media: <https://w3id.org/jeswr/sectors/media#> .
  @prefix core:  <https://w3id.org/jeswr/core#> .
  @prefix dct:   <http://purl.org/dc/terms/> .
  @prefix time:  <http://www.w3.org/2006/time#> .
  @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(listeningShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: RES }).parse(ttl));
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

const failedPaths = (report: { results: { path?: { value?: string } }[] }) =>
  report.results.map((r) => String(r.path?.value));

describe("the shipped .ttl artifacts parse", () => {
  it("listening.shacl.ttl is well-formed Turtle", () => {
    expect(new Parser().parse(listeningShapeTtl()).length).toBeGreaterThan(0);
  });

  it("listening.proposals.ttl is well-formed Turtle and declares fedcon:Proposal candidates", () => {
    const quads = new Parser().parse(listeningProposalsTtl());
    expect(quads.length).toBeGreaterThan(0);
    const proposals = quads.filter(
      (q) =>
        q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
        q.object.value === "https://jeswr.org/fedcon#Proposal",
    );
    // Four candidates: completion, played-via, loved/skipped, artist-name observation.
    expect(proposals.length).toBe(4);
  });
});

describe("SHACL shape (listening.shacl.ttl)", () => {
  it("a fully-populated, well-formed scrobble conforms", async () => {
    const ttl = await serializeScrobble(RES, {
      trackTitle: "Teardrop",
      artistName: "Massive Attack",
      albumTitle: "Mezzanine",
      playedAt: new Date("2026-07-07T10:00:00.000Z"),
      msPlayed: 194000,
      durationSeconds: 329.5,
      isrc: "GBAAA9900123",
      listener: "https://alice.pod.example/profile/card#me",
    });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
  });

  it("a minimal scrobble (track title only) conforms with zero results", async () => {
    const ttl = await serializeScrobble(RES, { trackTitle: "Solo" });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it("a PlaybackEvent with NO played work is non-conforming (playedWork minCount 1)", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; core:atTime <${RES}#playedAt> .
      <${RES}#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("playedWork"))).toBe(true);
  });

  it("a literal-valued played work is rejected by sh:nodeKind sh:IRI", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork "not-an-iri" ; core:atTime <${RES}#playedAt> .
      <${RES}#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("playedWork"))).toBe(true);
  });

  it("a media:Track with NO title is non-conforming (dct:title minCount 1)", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${RES}#track> ; core:atTime <${RES}#playedAt> .
      <${RES}#track> a media:Track .
      <${RES}#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("title"))).toBe(true);
  });

  it("a time:Instant with NO inXSDDateTime is non-conforming (minCount 1)", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${RES}#track> ; core:atTime <${RES}#playedAt> .
      <${RES}#track> a media:Track ; dct:title "T" .
      <${RES}#playedAt> a time:Instant .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("inXSDDateTime"))).toBe(true);
  });

  it("a durationSeconds typed xsd:double (not xsd:decimal) is rejected by sh:datatype", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${RES}#track> ; core:atTime <${RES}#playedAt> .
      <${RES}#track> a media:Track ; dct:title "T" ;
        media:durationSeconds "329.5"^^xsd:double .
      <${RES}#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("durationSeconds"))).toBe(true);
  });

  it("a malformed ISRC is rejected by sh:pattern", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${RES}#track> ; core:atTime <${RES}#playedAt> .
      <${RES}#track> a media:Track ; dct:title "T" ; media:isrc "not-an-isrc" .
      <${RES}#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("isrc"))).toBe(true);
  });
});
