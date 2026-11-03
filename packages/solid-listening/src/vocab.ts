// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
export const MEDIA = "https://w3id.org/jeswr/sectors/media#";
/** The gUFO-rebased Solid Core ontology namespace (`@jeswr/solid-federation-vocab`). */
export const CORE = "https://w3id.org/jeswr/core#";
/** Dublin Core Terms — `dct:title`. */
export const DCT = "http://purl.org/dc/terms/";
/** FOAF — `foaf:name` (the artist display name) + `foaf:Agent` (referenced by the ACL negative tests). */
export const FOAF = "http://xmlns.com/foaf/0.1/";
/** W3C Time — `time:Instant`, `time:inXSDDateTime`. */
export const TIME = "http://www.w3.org/2006/time#";
/** WAC — the owner-only ACL helper (`acl:Authorization`, `acl:agent`, `acl:mode`, …). */
export const ACL = "http://www.w3.org/ns/auth/acl#";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — `xsd:dateTime`, `xsd:integer`, `xsd:decimal`, `xsd:string`. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Build a `media:` term IRI. */
export const media = (local: string): string => `${MEDIA}${local}`;
/** Build a `core:` term IRI. */
export const core = (local: string): string => `${CORE}${local}`;
/** Build a `dct:` term IRI. */
export const dct = (local: string): string => `${DCT}${local}`;
/** Build a `foaf:` term IRI. */
export const foaf = (local: string): string => `${FOAF}${local}`;
/** Build a `time:` term IRI. */
export const time = (local: string): string => `${TIME}${local}`;
/** Build an `acl:` term IRI. */
export const acl = (local: string): string => `${ACL}${local}`;
/** Build an `rdf:` term IRI. */
export const rdf = (local: string): string => `${RDF}${local}`;
/** Build an `xsd:` term IRI. */
export const xsd = (local: string): string => `${XSD}${local}`;

// --- Classes (all reused from the media sector / W3C Time) ---

/** `media:PlaybackEvent` — a single datable play occurrence (the scrobble). */
export const PLAYBACK_EVENT_CLASS = media("PlaybackEvent");
/** `media:ListeningActivity` — the act of consuming a work over time (referenced in docs / alignments). */
export const LISTENING_ACTIVITY_CLASS = media("ListeningActivity");
/** `media:ListeningHistory` — an imported/aggregated record of a person's plays. */
export const LISTENING_HISTORY_CLASS = media("ListeningHistory");
/** `media:Track` — a music recording as a playable track on a service. */
export const TRACK_CLASS = media("Track");
/** `media:Artist` — the role an agent plays when credited on a work. */
export const ARTIST_CLASS = media("Artist");
/** `media:Album` — a released collection of recordings. */
export const ALBUM_CLASS = media("Album");
/** `time:Instant` — the reified played-at instant a `core:atTime` points to. */
export const TIME_INSTANT_CLASS = time("Instant");

// --- Reused predicates (nothing minted) ---

/** `media:playedWork` — the creative work played in a playback event (→ the Track). */
export const MEDIA_PLAYED_WORK = media("playedWork");
/** `media:performedByArtist` — the artist credited on a work (→ the Artist). */
export const MEDIA_PERFORMED_BY_ARTIST = media("performedByArtist");
/** `media:inAlbum` — the album a recording belongs to (→ the Album). */
export const MEDIA_IN_ALBUM = media("inAlbum");
/** `media:msPlayed` — how long the work was actually played, in milliseconds (xsd:integer). */
export const MEDIA_MS_PLAYED = media("msPlayed");
/** `media:durationSeconds` — the playable duration of the track, in seconds (xsd:decimal). */
export const MEDIA_DURATION_SECONDS = media("durationSeconds");
/** `media:isrc` — the International Standard Recording Code of the recording (xsd:string). */
export const MEDIA_ISRC = media("isrc");
/** `core:atTime` — associates the event with a W3C Time temporal entity (the played-at instant). */
export const CORE_AT_TIME = core("atTime");
/** `core:hadParticipant` — an agent that took part in an event (the listener WebID). */
export const CORE_HAD_PARTICIPANT = core("hadParticipant");
/** `core:subject` — the agent a record is primarily about (the ListeningHistory's data subject). */
export const CORE_SUBJECT = core("subject");
/** `core:hasPart` — the parts of a whole (the plays a ListeningHistory aggregates). */
export const CORE_HAS_PART = core("hasPart");
/** `dct:title` — the track / album title. */
export const DCT_TITLE = dct("title");
/** `foaf:name` — the artist's display name. */
export const FOAF_NAME = foaf("name");
/** `time:inXSDDateTime` — the xsd:dateTime value of a `time:Instant`. */
export const TIME_IN_XSD_DATE_TIME = time("inXSDDateTime");

/** The `rdf:type` predicate IRI (convenience). */
export const RDF_TYPE = rdf("type");
/** `xsd:decimal` — the datatype for `media:durationSeconds` (written via a datatype tuple). */
export const XSD_DECIMAL = xsd("decimal");

/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export const PREFIXES = {
  media: MEDIA,
  core: CORE,
  dct: DCT,
  foaf: FOAF,
  time: TIME,
  rdf: RDF,
  xsd: XSD,
} as const;
