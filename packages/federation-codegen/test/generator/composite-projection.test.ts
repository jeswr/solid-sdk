// AUTHORED-BY Claude Opus 4.8
//
// Phase-M ACCEPTANCE — the composite / document-projection facet, CLOSED. This file
// began as composite-projection-gap.test.ts, which PROVED the two facets of the gap on
// the ratcheted media sector's scrobble fragment (a fragment-subject collision; a
// single-node parse that could not enforce the linked Track's title MUST). The
// generator now emits a MULTI-NODE COMPOSITE, and the same two facets flip to PASSING:
//
//   1. the PlaybackEvent + Track live at DISTINCT fragments (#it, #track) of one
//      document — no collision — projected as ONE flat object (the ScrobbleData shape);
//   2. `Scrobble.parse` GRAPH-WALKS media:playedWork and enforces the linked Track's
//      title MUST across nodes — an untitled linked Track rejects the WHOLE scrobble
//      (the security-critical untrusted-document validation).
//
// The minimal, admissible scrobble fragment mirrors the ratcheted media sector
// (feat/media-sector-ratchet): media:PlaybackEvent references a media:Track by IRI
// (Violation), and a media:Track MUST carry a non-blank dct:title (Violation).
import { defineModel } from "@jeswr/model-runtime";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { type CodegenConfig, generateModel } from "../../src/index.js";

const MEDIA = "https://w3id.org/jeswr/sectors/media#";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const ONTOLOGY = `
@prefix media:   <${MEDIA}> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix vann:    <http://purl.org/vocab/vann/> .

<https://w3id.org/jeswr/sectors/media> a owl:Ontology ;
    vann:preferredNamespaceUri "${MEDIA}" .

media:PlaybackEvent a owl:Class ;
    rdfs:label "Playback Event"@en ;
    skos:definition "A single datable play occurrence."@en .
media:Track a owl:Class ;
    rdfs:label "Track"@en ;
    skos:definition "A playable track on a service."@en .
media:playedWork a owl:ObjectProperty ;
    rdfs:domain media:PlaybackEvent ; rdfs:range media:Track ;
    rdfs:label "played work"@en ;
    skos:definition "The work played in this event."@en .
`;

const SHAPES = `
@prefix mdsh:  <https://w3id.org/jeswr/sectors/media/shapes#> .
@prefix media: <${MEDIA}> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix dct:   <http://purl.org/dc/terms/> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .

mdsh:PlaybackEventShape a sh:NodeShape ;
    sh:targetClass media:PlaybackEvent ;
    sh:property [
        sh:path media:playedWork ; sh:name "playedWork" ;
        sh:nodeKind sh:IRI ; sh:class media:Track ;
        sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation
    ] .

mdsh:TrackShape a sh:NodeShape ;
    sh:targetClass media:Track ;
    sh:property [
        sh:path dct:title ; sh:name "title" ;
        sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
        sh:minLength 1 ; sh:severity sh:Violation
    ] .
`;

// The composite config — ONE Scrobble entity projecting the PlaybackEvent (#it) and the
// linked Track (#track) as one flat object; media:playedWork is a NESTED link.
const CONFIG: CodegenConfig = {
  shapesBase: "https://w3id.org/jeswr/sectors/media/shapes#",
  prefixes: {
    media: MEDIA,
    dct: DCT,
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  entities: [
    {
      name: "Scrobble",
      kind: "composite",
      root: "event",
      nodes: {
        event: {
          targetClass: `${MEDIA}PlaybackEvent`,
          fragment: "it",
          links: { playedWork: "track" },
        },
        track: {
          targetClass: `${MEDIA}Track`,
          fragment: "track",
          fields: { title: { rename: "trackTitle" } },
        },
      },
    },
  ],
};

const RES = "https://alice.pod.example/listening/x";
const IT = `${RES}#it`;
const TRACK = `${RES}#track`;

const generated = generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: SHAPES, config: CONFIG });
const model = defineModel(generated.manifest);
const Scrobble = model.entities.Scrobble;
if (!Scrobble) throw new Error("expected the generated Scrobble composite entity");

// The generated composite manifest entity (narrowed once for the structural assertions).
const scrobbleEntity = (() => {
  const s = generated.manifest.entities[0];
  if (s?.kind !== "composite") throw new Error("expected a composite Scrobble entity");
  return s;
})();
const nodeNamed = (name: string) => scrobbleEntity.nodes.find((n) => n.name === name);

describe("the ratcheted scrobble fragment generates ONE composite entity (admits)", () => {
  it("admits and produces a SINGLE composite Scrobble spanning the PlaybackEvent + Track nodes", () => {
    expect(generated.admission.ok).toBe(true);
    expect(generated.manifest.entities.map((e) => e.name)).toEqual(["Scrobble"]);
    expect(scrobbleEntity.root).toBe("event");
    expect(scrobbleEntity.nodes.map((n) => n.name).sort()).toEqual(["event", "track"]);
  });

  it("the linked Track's title MUST is enforced ACROSS nodes (untitled Track → reject)", () => {
    const titleField = nodeNamed("track")?.fields.find((f) => f.name === "trackTitle");
    expect(titleField?.guards?.requiredFailClosed).toBe(true);
    // The composite runtime enforces it while parsing the WHOLE scrobble: a document
    // whose linked Track has no title is rejected (undefined), not admitted.
    const store = Scrobble.build(RES, { trackTitle: "OK" });
    expect(Scrobble.parse(RES, store)).toBeDefined();
    store.removeQuads(store.getQuads(TRACK, `${DCT}title`, null, null));
    expect(Scrobble.parse(RES, store)).toBeUndefined();
  });

  it("media:playedWork is a NESTED link to the Track sub-node (build writes both nodes)", () => {
    const pwField = nodeNamed("event")?.fields.find((f) => f.name === "playedWork");
    expect(pwField?.kind).toBe("nested");
    expect(pwField?.node).toBe("track");
    // build writes the event AND the linked Track (its title) at their own fragments.
    const store = Scrobble.build(RES, { trackTitle: "Song" });
    const pw = store.getQuads(IT, `${MEDIA}playedWork`, null, null);
    expect(pw).toHaveLength(1);
    expect(pw[0]?.object.termType).toBe("NamedNode");
    expect(pw[0]?.object.value).toBe(TRACK);
    // The Track node IS materialised — its title triple lives on #track.
    expect(store.getQuads(TRACK, `${DCT}title`, null, null)[0]?.object.value).toBe("Song");
  });
});

describe("THE GAP — CLOSED: a multi-node composite / document projection", () => {
  it("the event and the track live at DISTINCT fragments (#it, #track) — no collision", () => {
    const store = Scrobble.build(RES, { trackTitle: "Song" });
    // The event is #it; the Track is a DIFFERENT node #track — the scrobble's multi-node
    // layout the flat entities could not represent.
    expect(Scrobble.subject(RES)).toBe(IT);
    expect(IT).not.toBe(TRACK);
    expect(store.getQuads(IT, RDF_TYPE, `${MEDIA}PlaybackEvent`, null)).toHaveLength(1);
    expect(store.getQuads(TRACK, RDF_TYPE, `${MEDIA}Track`, null)).toHaveLength(1);
  });

  it("Scrobble.parse GRAPH-WALKS: an untitled linked Track IS rejected (whole composite)", () => {
    // Hand-build a document whose PlaybackEvent points at a Track that has NO title (a
    // non-usable scrobble). The composite parse GRAPH-WALKS media:playedWork and enforces
    // the linked Track's title MUST — so it rejects the whole scrobble (undefined), the
    // cross-node validation the single-node runtime could not express.
    const store = new Store();
    const it = DataFactory.namedNode(IT);
    const track = DataFactory.namedNode(TRACK);
    const type = DataFactory.namedNode(RDF_TYPE);
    store.addQuad(it, type, DataFactory.namedNode(`${MEDIA}PlaybackEvent`));
    store.addQuad(it, DataFactory.namedNode(`${MEDIA}playedWork`), track);
    store.addQuad(track, type, DataFactory.namedNode(`${MEDIA}Track`)); // typed, but UNTITLED
    expect(Scrobble.parse(RES, store)).toBeUndefined();
    // With a title, the same graph is accepted and the title projects into the object.
    store.addQuad(track, DataFactory.namedNode(`${DCT}title`), DataFactory.literal("Titled"));
    expect(Scrobble.parse(RES, store)?.trackTitle).toBe("Titled");
  });

  it("the Scrobble entity PROJECTS the composite ScrobbleData (a track title in ONE object)", () => {
    // The composite carries trackTitle — from the #track node — in the ONE flat object
    // its build/parse exchange, so it IS a drop-in for the fork's ScrobbleData shape.
    const parsed = Scrobble.parse(RES, Scrobble.build(RES, { trackTitle: "Blue Monday" }));
    expect(parsed).toEqual({ trackTitle: "Blue Monday" });
    // The composite's generated *Data field is trackTitle (renamed from the Track's
    // title); it is REQUIRED because the Track's title is a Violation-graded MUST.
    expect(generated.artifacts["model.d.ts"]).toContain('"trackTitle": string;');
    expect(generated.artifacts["model.d.ts"]).toContain("export interface ScrobbleData {");
  });
});
