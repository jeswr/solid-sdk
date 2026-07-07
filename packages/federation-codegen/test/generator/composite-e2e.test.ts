// AUTHORED-BY Claude Opus 4.8
//
// Phase-M END-TO-END — generate a listening model from the RATCHETED MEDIA SECTOR
// (solid-federation-vocab feat/media-sector-ratchet @ bc54846) and round-trip a full
// five-node scrobble document (build → serialize → parse) with the cross-node MUSTs
// enforced: a titled media:Track and a valid time:Instant MUST be reachable, else the
// whole scrobble is rejected fail-closed.
//
// SHAPES below are a faithful snapshot of the FIVE scrobble-relevant NodeShapes of
// sectors/media/media.shacl.ttl (PlaybackEvent / Track / PlayedAtInstant / Artist /
// Album), semantics-verbatim (sh:path/name/nodeKind/class/datatype/cardinality/minLength/
// pattern/severity preserved; sh:message + rdfs:label dropped as they do not drive
// codegen). The ontology declares the four sector classes so tier-a admission passes
// (time:Instant is a non-sector class, gated only via its shape). Mirrors how
// sector-divergence.test.ts snapshots the bookmarks sector.
import { defineModel } from "@jeswr/model-runtime";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  parseShapes,
} from "../../src/index.js";

const MEDIA = "https://w3id.org/jeswr/sectors/media#";
const CORE = "https://w3id.org/jeswr/core#";
const TIME = "http://www.w3.org/2006/time#";
const FOAF = "http://xmlns.com/foaf/0.1/";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const ONTOLOGY = `
@prefix media: <${MEDIA}> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix vann:  <http://purl.org/vocab/vann/> .

<https://w3id.org/jeswr/sectors/media> a owl:Ontology ;
    vann:preferredNamespaceUri "${MEDIA}" .

media:PlaybackEvent a owl:Class ; rdfs:label "Playback Event"@en ;
    skos:definition "A single datable play occurrence."@en .
media:Track a owl:Class ; rdfs:label "Track"@en ;
    skos:definition "A playable track on a service."@en .
media:Artist a owl:Class ; rdfs:label "Artist"@en ;
    skos:definition "A credited performing agent."@en .
media:Album a owl:Class ; rdfs:label "Album"@en ;
    skos:definition "A collection work."@en .
`;

// Faithful snapshot of the five scrobble NodeShapes (media.shacl.ttl @ bc54846).
const SHAPES = `
@prefix mdsh:  <https://w3id.org/jeswr/sectors/media/shapes#> .
@prefix media: <${MEDIA}> .
@prefix core:  <${CORE}> .
@prefix time:  <${TIME}> .
@prefix foaf:  <${FOAF}> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix dcterms: <${DCT}> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .

mdsh:PlaybackEventShape a sh:NodeShape ;
    sh:targetClass media:PlaybackEvent ;
    sh:property [ sh:path media:playedWork ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ;
        sh:class media:CreativeWork ; sh:severity sh:Violation ] ;
    sh:property [ sh:path core:hadParticipant ; sh:nodeKind sh:IRI ; sh:minCount 1 ;
        sh:class core:Agent ; sh:severity sh:Warning ] ;
    sh:property [ sh:path core:atTime ; sh:nodeKind sh:IRI ; sh:class time:Instant ;
        sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] ;
    sh:property [ sh:path media:msPlayed ; sh:datatype xsd:integer ; sh:minInclusive 0 ;
        sh:maxCount 1 ; sh:severity sh:Info ] ;
    sh:property [ sh:path media:completionFraction ; sh:datatype xsd:decimal ;
        sh:minInclusive 0 ; sh:maxInclusive 1 ; sh:maxCount 1 ; sh:severity sh:Info ] ;
    sh:property [ sh:path media:loved ; sh:datatype xsd:boolean ; sh:maxCount 1 ; sh:severity sh:Info ] .

mdsh:TrackShape a sh:NodeShape ;
    sh:targetClass media:Track ;
    sh:property [ sh:path dcterms:title ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ;
        sh:minLength 1 ; sh:pattern "\\\\S" ; sh:severity sh:Violation ] ;
    sh:property [ sh:path media:performedByArtist ; sh:nodeKind sh:IRI ; sh:class media:Artist ;
        sh:maxCount 1 ; sh:severity sh:Info ] ;
    sh:property [ sh:path media:inAlbum ; sh:nodeKind sh:IRI ; sh:class media:Album ;
        sh:maxCount 1 ; sh:severity sh:Info ] ;
    sh:property [ sh:path media:durationSeconds ; sh:datatype xsd:decimal ; sh:minInclusive 0 ;
        sh:maxCount 1 ; sh:severity sh:Info ] .

mdsh:PlayedAtInstantShape a sh:NodeShape ;
    sh:targetClass time:Instant ;
    sh:property [ sh:path time:inXSDDateTime ; sh:datatype xsd:dateTime ;
        sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] .

mdsh:ArtistShape a sh:NodeShape ;
    sh:targetClass media:Artist ;
    sh:property [ sh:path foaf:name ; sh:datatype xsd:string ; sh:maxCount 1 ; sh:severity sh:Info ] .

mdsh:AlbumShape a sh:NodeShape ;
    sh:targetClass media:Album ;
    sh:property [ sh:path dcterms:title ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ;
        sh:severity sh:Warning ] .
`;

const SHAPES_BASE = "https://w3id.org/jeswr/sectors/media/shapes#";

// The Scrobble composite config — five nodes projected as ONE flat object (ScrobbleData).
const CONFIG: CodegenConfig = {
  shapesBase: SHAPES_BASE,
  prefixes: {
    media: MEDIA,
    core: CORE,
    time: TIME,
    foaf: FOAF,
    dcterms: DCT,
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
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
          fields: { msPlayed: {} },
          links: { playedWork: "track", atTime: "playedAt" },
        },
        track: {
          targetClass: `${MEDIA}Track`,
          fragment: "track",
          fields: { title: { rename: "trackTitle" } },
          links: { performedByArtist: "artist", inAlbum: "album" },
        },
        playedAt: {
          targetClass: `${TIME}Instant`,
          fragment: "playedAt",
          fields: { inXSDDateTime: { rename: "playedAt" } },
        },
        artist: {
          targetClass: `${MEDIA}Artist`,
          fragment: "artist",
          fields: { name: { rename: "artistName" } },
        },
        album: {
          targetClass: `${MEDIA}Album`,
          fragment: "album",
          fields: { title: { rename: "albumTitle" } },
        },
      },
    },
  ],
};

const generated = generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: SHAPES, config: CONFIG });
const model = defineModel(generated.manifest);
const Scrobble = model.entities.Scrobble;
if (!Scrobble) throw new Error("expected the generated Scrobble composite entity");

const RES = "https://alice.pod.example/listening/2020-01-01";
const IT = `${RES}#it`;
const TRACK = `${RES}#track`;
const PLAYED_AT = `${RES}#playedAt`;

const WHEN = new Date("2020-01-01T12:00:00.000Z");
const FULL = {
  msPlayed: 210000,
  trackTitle: "Blue Monday",
  artistName: "New Order",
  albumTitle: "Power, Corruption & Lies",
  playedAt: WHEN,
};

function toStore(ttl: string): Store {
  return new Store(new Parser({ baseIRI: RES }).parse(ttl));
}

describe("generate a listening model from the ratcheted media sector (bc54846)", () => {
  it("admits and generates ONE composite Scrobble spanning five nodes", () => {
    expect(generated.admission.ok).toBe(true);
    expect(generated.manifest.entities.map((e) => e.name)).toEqual(["Scrobble"]);
    const scrobble = generated.manifest.entities[0];
    if (scrobble?.kind !== "composite") throw new Error("expected composite");
    expect(scrobble.nodes.map((n) => n.name).sort()).toEqual([
      "album",
      "artist",
      "event",
      "playedAt",
      "track",
    ]);
  });

  it("the generated model.d.ts projects the flat ScrobbleData across the nodes", () => {
    const dts = generated.artifacts["model.d.ts"] ?? "";
    expect(dts).toContain("export interface ScrobbleData {");
    // fields from DIFFERENT nodes, in one flat object
    expect(dts).toContain('"msPlayed"?: number;'); // event
    expect(dts).toContain('"trackTitle": string;'); // track (Violation MUST → required)
    expect(dts).toContain('"playedAt": Date;'); // playedAt (Violation MUST → required)
    expect(dts).toContain('"artistName"?: string;'); // artist
    expect(dts).toContain('"albumTitle"?: string;'); // album (Warning → optional)
  });

  it("fidelity PASSES for the generated composite (the P0 exit criterion)", () => {
    const shapes = parseShapes(SHAPES, SHAPES_BASE);
    expect(() => assertFidelity(shapes, compileManifest(shapes, CONFIG))).not.toThrow();
  });
});

describe("round-trip a scrobble document (build → serialize → parse)", () => {
  it("build writes all five nodes at conventional fragments, linked", () => {
    const store = Scrobble.build(RES, FULL);
    expect(store.getQuads(IT, RDF_TYPE, `${MEDIA}PlaybackEvent`, null)).toHaveLength(1);
    expect(store.getQuads(TRACK, RDF_TYPE, `${MEDIA}Track`, null)).toHaveLength(1);
    expect(store.getQuads(PLAYED_AT, RDF_TYPE, `${TIME}Instant`, null)).toHaveLength(1);
    expect(store.getQuads(`${RES}#artist`, RDF_TYPE, `${MEDIA}Artist`, null)).toHaveLength(1);
    expect(store.getQuads(`${RES}#album`, RDF_TYPE, `${MEDIA}Album`, null)).toHaveLength(1);
    expect(store.getQuads(IT, `${MEDIA}playedWork`, TRACK, null)).toHaveLength(1);
    expect(store.getQuads(IT, `${CORE}atTime`, PLAYED_AT, null)).toHaveLength(1);
    expect(store.getQuads(TRACK, `${MEDIA}performedByArtist`, `${RES}#artist`, null)).toHaveLength(
      1,
    );
  });

  it("round-trips the flat ScrobbleData object through build → parse", () => {
    const parsed = Scrobble.parse(RES, Scrobble.build(RES, FULL));
    expect(parsed).toEqual(FULL);
  });

  it("round-trips through serialize → parseDocument (Turtle)", async () => {
    const ttl = await Scrobble.serialize(RES, FULL);
    const parsed = await Scrobble.parseDocument(RES, ttl, "text/turtle");
    expect(parsed).toEqual(FULL);
  });

  it("admits with the optional Artist/Album absent (the Info links drop, MUSTs met)", () => {
    const minimal = { trackTitle: "Solo", playedAt: WHEN };
    const parsed = Scrobble.parse(RES, Scrobble.build(RES, minimal));
    expect(parsed).toEqual(minimal);
  });
});

describe("cross-node MUSTs enforced on an untrusted scrobble document", () => {
  it("rejects when the linked Track has no title (Violation MUST)", () => {
    const store = Scrobble.build(RES, FULL);
    store.removeQuads(store.getQuads(TRACK, `${DCT}title`, null, null));
    expect(Scrobble.parse(RES, store)).toBeUndefined();
  });

  it("rejects when the linked Track's title is whitespace-only (nonBlank MUST)", () => {
    const store = Scrobble.build(RES, FULL);
    store.removeQuads(store.getQuads(TRACK, `${DCT}title`, null, null));
    store.addQuad(
      DataFactory.namedNode(TRACK),
      DataFactory.namedNode(`${DCT}title`),
      DataFactory.literal("   "),
    );
    expect(Scrobble.parse(RES, store)).toBeUndefined();
  });

  it("rejects when the played-at Instant has no dateTime (Violation MUST)", () => {
    const store = Scrobble.build(RES, FULL);
    store.removeQuads(store.getQuads(PLAYED_AT, `${TIME}inXSDDateTime`, null, null));
    expect(Scrobble.parse(RES, store)).toBeUndefined();
  });

  it("rejects a hand-built document whose linked Track is untitled (graph-walk)", () => {
    const ttl = `
      @prefix media: <${MEDIA}> . @prefix core: <${CORE}> . @prefix time: <${TIME}> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${IT}> a media:PlaybackEvent ; media:playedWork <${TRACK}> ; core:atTime <${PLAYED_AT}> .
      <${TRACK}> a media:Track .
      <${PLAYED_AT}> a time:Instant ; time:inXSDDateTime "2020-01-01T12:00:00.000Z"^^xsd:dateTime .
    `;
    expect(Scrobble.parse(RES, toStore(ttl))).toBeUndefined();
  });
});

describe("composite fidelity — the P0 exit criterion FAILS on a tampered composite", () => {
  const shapes = parseShapes(SHAPES, SHAPES_BASE);

  it("FAILS when a node drops a Violation-graded MUST (title) from its projection", () => {
    const compiled = compileManifest(shapes, CONFIG);
    const track = compiled.manifest.entities
      .flatMap((e) => (e.kind === "composite" ? e.nodes : []))
      .find((n) => n.name === "track");
    if (!track) throw new Error("track node missing");
    track.fields = track.fields.filter((f) => f.name !== "trackTitle");
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it("FAILS when a nested link drops its requiredFailClosed (a Violation link)", () => {
    const compiled = compileManifest(shapes, CONFIG);
    const link = compiled.manifest.entities
      .flatMap((e) => (e.kind === "composite" ? e.nodes : []))
      .flatMap((n) => n.fields)
      .find((f) => f.name === "playedWork");
    if (!link) throw new Error("playedWork link missing");
    link.guards = undefined;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it("FAILS on a seeded datatype mutation of a composite flat field", () => {
    const compiled = compileManifest(shapes, CONFIG);
    const field = compiled.manifest.entities
      .flatMap((e) => (e.kind === "composite" ? e.nodes : []))
      .flatMap((n) => n.fields)
      .find((f) => f.name === "msPlayed");
    if (!field) throw new Error("msPlayed field missing");
    field.datatype = "http://www.w3.org/2001/XMLSchema#string"; // was xsd:integer
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
});
