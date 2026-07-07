// AUTHORED-BY Claude Opus 4.8
//
// HONEST Phase-M FINDING — the codegen (Phase G) generates SINGLE-NODE FLAT
// entities; it cannot yet express a MULTI-NODE COMPOSITE / DOCUMENT PROJECTION.
//
// This is the precise gap that blocks reconciling `@jeswr/solid-listening`'s model
// into a generated one (Phase M, models-live-in-the-federation). That package's
// PUBLIC surface is `ScrobbleData` — a SINGLE flat object projected across FIVE
// connected RDF nodes of one scrobble document:
//
//   <#it>       media:PlaybackEvent  — msPlayed, listener (core:hadParticipant)
//   <#track>    media:Track          — trackTitle (dct:title), durationSeconds, isrc
//                                       → performedByArtist <#artist>, inAlbum <#album>
//   <#artist>   media:Artist         — artistName (foaf:name)
//   <#album>    media:Album          — albumTitle (dct:title)
//   <#playedAt> time:Instant         — playedAt (time:inXSDDateTime)
//
// `buildScrobble` writes all five nodes at conventional fragment IRIs and links
// them; `parseScrobble` GRAPH-WALKS from <#it> (follow media:playedWork → the Track,
// read its title, follow performedByArtist/inAlbum; follow core:atTime → the
// Instant) applying LOAD-BEARING cross-node MUST checks (reject unless a titled
// media:Track and a valid time:Instant are reachable) — the security-critical
// validation that makes an untrusted scrobble document safe.
//
// The generator + `@jeswr/model-runtime` produce ONE entity per NodeShape, each a
// flat single-node projection. This test PROVES the two facets of the gap on a
// minimal, admissible scrobble fragment (PlaybackEvent + Track), so the boundary is
// a durable, CI-checked fact (mirrors sector-divergence.test.ts). The MEDIA SECTOR
// RATCHET itself (folding the fork's shapes + fedcon terms) IS landed and admits +
// generates the per-node entities — that is not in question; the composite
// PROJECTION across those nodes is what Phase G cannot yet emit.
import { defineModel } from "@jeswr/model-runtime";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { generateModel } from "../../src/index.js";

const MEDIA = "https://w3id.org/jeswr/sectors/media#";

// A minimal, admissible snapshot of the ratcheted media sector's scrobble fragment
// (feat/media-sector-ratchet): media:PlaybackEvent references a media:Track by IRI
// (Violation), and a media:Track MUST carry a non-blank dct:title (Violation).
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

const CONFIG = {
  shapesBase: "https://w3id.org/jeswr/sectors/media/shapes#",
  prefixes: {
    media: MEDIA,
    dct: "http://purl.org/dc/terms/",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  entities: [
    {
      targetClass: `${MEDIA}PlaybackEvent`,
      name: "PlaybackEvent",
      subject: { convention: "hash-it" as const },
    },
    { targetClass: `${MEDIA}Track`, name: "Track", subject: { convention: "hash-it" as const } },
  ],
};

const RES = "https://alice.pod.example/listening/x";
const TRACK_IRI = `${RES}#track`;

const generated = generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: SHAPES, config: CONFIG });
const model = defineModel(generated.manifest);
const PlaybackEvent = model.entities.PlaybackEvent;
const Track = model.entities.Track;
if (!PlaybackEvent || !Track)
  throw new Error("expected the generated PlaybackEvent + Track entities");

describe("the ratcheted scrobble fragment generates (per-node entities, admits)", () => {
  it("admits and produces TWO SEPARATE flat entities — never one composite", () => {
    expect(generated.admission.ok).toBe(true);
    expect(generated.manifest.entities.map((e) => e.name).sort()).toEqual([
      "PlaybackEvent",
      "Track",
    ]);
  });

  it("Track.title is fail-closed (Violation minCount 1 → requiredFailClosed), per G1", () => {
    const titleField = generated.manifest.entities
      .find((e) => e.name === "Track")
      ?.fields.find((f) => f.name === "title");
    expect(titleField?.guards?.requiredFailClosed).toBe(true);
    // …and the runtime enforces it WITHIN the Track node: an untitled Track parses undefined.
    const store = new Store();
    store.addQuad(
      DataFactory.namedNode(Track.subject(RES)),
      DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      DataFactory.namedNode(`${MEDIA}Track`),
    );
    expect(Track.parse(RES, store)).toBeUndefined();
    expect(Track.build(RES, { title: "T" })).toBeDefined();
  });

  it("PlaybackEvent.playedWork is a bare IRI field, NOT a nested Track projection", () => {
    const pwField = generated.manifest.entities
      .find((e) => e.name === "PlaybackEvent")
      ?.fields.find((f) => f.name === "playedWork");
    expect(pwField?.kind).toBe("iri");
    // build writes only the ONE subject node: playedWork is a NamedNode, and the
    // linked Track node (its title etc.) is NOT materialised by the runtime.
    const store = PlaybackEvent.build(RES, { playedWork: TRACK_IRI });
    const pw = store.getQuads(
      PlaybackEvent.subject(RES),
      DataFactory.namedNode(`${MEDIA}playedWork`),
      null,
      null,
    );
    expect(pw).toHaveLength(1);
    expect(pw[0]?.object.termType).toBe("NamedNode");
    expect(pw[0]?.object.value).toBe(TRACK_IRI);
    // Nothing was written for the Track node — no title triple anywhere.
    expect(
      store.getQuads(null, DataFactory.namedNode("http://purl.org/dc/terms/title"), null, null),
    ).toHaveLength(0);
  });
});

describe("THE GAP — no multi-node composite / document projection", () => {
  it("the two entities COLLIDE on one subject (#it) — no sub-node fragment convention", () => {
    // Both entities' only subject conventions are hash-it / self, so for one
    // resourceUrl the event and the track resolve to the SAME node. There is no way
    // to place them at <#it> and <#track> of one document — the scrobble's 5-node
    // layout is unrepresentable by composing the flat entities.
    expect(PlaybackEvent.subject(RES)).toBe(`${RES}#it`);
    expect(Track.subject(RES)).toBe(`${RES}#it`);
    expect(PlaybackEvent.subject(RES)).toBe(Track.subject(RES));
  });

  it("PlaybackEvent.parse does NOT graph-walk: an untitled linked Track is not rejected", () => {
    // Hand-build a document whose PlaybackEvent points at a Track that has NO title
    // (a non-usable scrobble by the fork's parseScrobble, which rejects it). The
    // single-node runtime parse of the event SUCCEEDS anyway — it never dereferences
    // media:playedWork to enforce the linked Track's title MUST. That cross-node,
    // load-bearing validation lives only in the hand-written parseScrobble; the
    // generator/runtime cannot express it, so it cannot be delegated to the audited
    // runtime — which is exactly why a generated core cannot reach the oracle.
    const store = new Store();
    const it = DataFactory.namedNode(`${RES}#it`);
    const track = DataFactory.namedNode(TRACK_IRI);
    const type = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    store.addQuad(it, type, DataFactory.namedNode(`${MEDIA}PlaybackEvent`));
    store.addQuad(it, DataFactory.namedNode(`${MEDIA}playedWork`), track);
    store.addQuad(track, type, DataFactory.namedNode(`${MEDIA}Track`)); // typed, but UNTITLED
    const parsed = PlaybackEvent.parse(RES, store);
    expect(parsed).toBeDefined();
    expect(parsed?.playedWork).toBe(TRACK_IRI); // the event is accepted despite the untitled work
  });

  it("no generated entity projects the composite ScrobbleData (a track title + a played-at)", () => {
    // The fork's ScrobbleData carries trackTitle AND playedAt (from DIFFERENT nodes)
    // in ONE object. No single generated entity carries fields from more than its own
    // node, so none is a drop-in for ScrobbleData.
    for (const entity of generated.manifest.entities) {
      const names = new Set(entity.fields.map((f) => f.name));
      expect(names.has("title") && names.has("playedWork")).toBe(false);
    }
  });
});
