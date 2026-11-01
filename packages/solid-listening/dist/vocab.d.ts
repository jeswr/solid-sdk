/**
 * Vocabulary IRIs for the listening-history / scrobble model (the data model a
 * [Web Scrobbler](https://github.com/web-scrobbler/web-scrobbler)→Solid fork
 * writes to a pod).
 *
 * **This package MINTS NOTHING.** Unlike a leaf model that has no sector home,
 * a scrobble is exactly what the `@jeswr/solid-federation-vocab` **media sector**
 * (`media:`, `https://w3id.org/jeswr/sectors/media#`) already models: a
 * `media:PlaybackEvent` (WHAT was played, WHEN, HOW-LONG) referencing a
 * `media:Track`, itself credited to a `media:Artist` and (optionally) part of a
 * `media:Album`, aggregated into a `media:ListeningHistory`. So the model REUSES
 * the sector's terms verbatim and mints no new IRI. Where a real scrobble needs a
 * field the sector LACKS (completion fraction, source-service attribution,
 * loved/skipped, in-progress-vs-completed) the gap is written up as a
 * `fedcon:Proposal` CANDIDATE (see `listening.proposals.ttl` / `DECISIONS.md`) —
 * the sector `.ttl` is NEVER edited here. Real fork usage drives sector evolution.
 *
 * **Reused terms (nothing minted):**
 * - **`media:` — the media sector** (`https://w3id.org/jeswr/sectors/media#`):
 *   `media:PlaybackEvent`, `media:Track`, `media:Artist`, `media:Album`,
 *   `media:ListeningHistory`; the object links `media:playedWork`,
 *   `media:performedByArtist`, `media:inAlbum`; and the literal service metadata
 *   `media:msPlayed` (xsd:integer), `media:durationSeconds` (xsd:decimal),
 *   `media:isrc` (xsd:string).
 * - **`core:` — the gUFO-rebased Solid Core** (`https://w3id.org/jeswr/core#`):
 *   `core:atTime` (→ a `time:Instant`), `core:hadParticipant` (the listener
 *   WebID), `core:subject` and `core:hasPart` (the ListeningHistory spine).
 * - **`dct:` — Dublin Core Terms**: `dct:title` (the track / album title — the
 *   term the media SHACL itself requires on a titled work).
 * - **`foaf:` — FOAF**: `foaf:name` for the artist's display name. The media
 *   sector models `media:Artist` (a role of `core:Agent`) but declares no literal
 *   name property, so `foaf:name` is REUSED (the dereferenceable, universal agent
 *   name) rather than minting one — see `DECISIONS.md`.
 * - **`time:` — W3C Time**: `time:Instant` + `time:inXSDDateTime` reify the
 *   played-at instant (`core:atTime`'s range is `time:TemporalEntity`, an object,
 *   not a literal). See `scrobble.ts` for why a reified instant, not a bare
 *   literal.
 * - **`acl:` / `rdf:` / `xsd:`** — WAC (the owner-only ACL helper), rdf:type and
 *   the XSD datatypes.
 *
 * **PERSISTENT-ID NOTE.** The `media:`/`core:` IRIs are historically minted under
 * `w3id.org/jeswr` — LEGACY identifiers that re-mint to the maintainer's live
 * `jeswr.org` persistent-ID layer per the staged migration (charter prose only;
 * minted IRIs in code/specs are not hand-edited). `fedcon:`
 * (`https://jeswr.org/fedcon#`) is already `jeswr.org`-rooted. This package mints
 * no NEW persistent identifier, so there is nothing new to place under jeswr.org.
 */
/** The media sector namespace — the canonical home of the terms this model reuses. */
export declare const MEDIA = "https://w3id.org/jeswr/sectors/media#";
/** The gUFO-rebased Solid Core ontology namespace (`@jeswr/solid-federation-vocab`). */
export declare const CORE = "https://w3id.org/jeswr/core#";
/** Dublin Core Terms — `dct:title`. */
export declare const DCT = "http://purl.org/dc/terms/";
/** FOAF — `foaf:name` (the artist display name) + `foaf:Agent` (referenced by the ACL negative tests). */
export declare const FOAF = "http://xmlns.com/foaf/0.1/";
/** W3C Time — `time:Instant`, `time:inXSDDateTime`. */
export declare const TIME = "http://www.w3.org/2006/time#";
/** WAC — the owner-only ACL helper (`acl:Authorization`, `acl:agent`, `acl:mode`, …). */
export declare const ACL = "http://www.w3.org/ns/auth/acl#";
/** RDF — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema. */
export declare const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — `xsd:dateTime`, `xsd:integer`, `xsd:decimal`, `xsd:string`. */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `media:` term IRI. */
export declare const media: (local: string) => string;
/** Build a `core:` term IRI. */
export declare const core: (local: string) => string;
/** Build a `dct:` term IRI. */
export declare const dct: (local: string) => string;
/** Build a `foaf:` term IRI. */
export declare const foaf: (local: string) => string;
/** Build a `time:` term IRI. */
export declare const time: (local: string) => string;
/** Build an `acl:` term IRI. */
export declare const acl: (local: string) => string;
/** Build an `rdf:` term IRI. */
export declare const rdf: (local: string) => string;
/** Build an `xsd:` term IRI. */
export declare const xsd: (local: string) => string;
/** `media:PlaybackEvent` — a single datable play occurrence (the scrobble). */
export declare const PLAYBACK_EVENT_CLASS: string;
/** `media:ListeningActivity` — the act of consuming a work over time (referenced in docs / alignments). */
export declare const LISTENING_ACTIVITY_CLASS: string;
/** `media:ListeningHistory` — an imported/aggregated record of a person's plays. */
export declare const LISTENING_HISTORY_CLASS: string;
/** `media:Track` — a music recording as a playable track on a service. */
export declare const TRACK_CLASS: string;
/** `media:Artist` — the role an agent plays when credited on a work. */
export declare const ARTIST_CLASS: string;
/** `media:Album` — a released collection of recordings. */
export declare const ALBUM_CLASS: string;
/** `time:Instant` — the reified played-at instant a `core:atTime` points to. */
export declare const TIME_INSTANT_CLASS: string;
/** `media:playedWork` — the creative work played in a playback event (→ the Track). */
export declare const MEDIA_PLAYED_WORK: string;
/** `media:performedByArtist` — the artist credited on a work (→ the Artist). */
export declare const MEDIA_PERFORMED_BY_ARTIST: string;
/** `media:inAlbum` — the album a recording belongs to (→ the Album). */
export declare const MEDIA_IN_ALBUM: string;
/** `media:msPlayed` — how long the work was actually played, in milliseconds (xsd:integer). */
export declare const MEDIA_MS_PLAYED: string;
/** `media:durationSeconds` — the playable duration of the track, in seconds (xsd:decimal). */
export declare const MEDIA_DURATION_SECONDS: string;
/** `media:isrc` — the International Standard Recording Code of the recording (xsd:string). */
export declare const MEDIA_ISRC: string;
/** `core:atTime` — associates the event with a W3C Time temporal entity (the played-at instant). */
export declare const CORE_AT_TIME: string;
/** `core:hadParticipant` — an agent that took part in an event (the listener WebID). */
export declare const CORE_HAD_PARTICIPANT: string;
/** `core:subject` — the agent a record is primarily about (the ListeningHistory's data subject). */
export declare const CORE_SUBJECT: string;
/** `core:hasPart` — the parts of a whole (the plays a ListeningHistory aggregates). */
export declare const CORE_HAS_PART: string;
/** `dct:title` — the track / album title. */
export declare const DCT_TITLE: string;
/** `foaf:name` — the artist's display name. */
export declare const FOAF_NAME: string;
/** `time:inXSDDateTime` — the xsd:dateTime value of a `time:Instant`. */
export declare const TIME_IN_XSD_DATE_TIME: string;
/** The `rdf:type` predicate IRI (convenience). */
export declare const RDF_TYPE: string;
/** `xsd:decimal` — the datatype for `media:durationSeconds` (written via a datatype tuple). */
export declare const XSD_DECIMAL: string;
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export declare const PREFIXES: {
    readonly media: "https://w3id.org/jeswr/sectors/media#";
    readonly core: "https://w3id.org/jeswr/core#";
    readonly dct: "http://purl.org/dc/terms/";
    readonly foaf: "http://xmlns.com/foaf/0.1/";
    readonly time: "http://www.w3.org/2006/time#";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly xsd: "http://www.w3.org/2001/XMLSchema#";
};
//# sourceMappingURL=vocab.d.ts.map