// AUTHORED-BY Claude Opus 4.8
/**
 * Typed `@rdfjs/wrapper` VIEWS over the individual nodes of a scrobble document
 * (`Scrobble` / `Track` / `Artist` / `Album` / `PlayedAtInstant`).
 *
 * **Why these are still hand-written.** The document MODEL — build / parse /
 * serialise of the whole five-node scrobble graph — is now GENERATED from the media
 * sector (see `./scrobble.ts` + `./generated/`). But the generated composite runtime
 * (`@jeswr/model-runtime`) exposes only the composite's ROOT wrapper, not a wrapper
 * per sub-node. These small typed views preserve the package's exact export surface
 * (a caller can still do low-level typed access to a Track / Artist / Album / Instant
 * subject) until the codegen grows a per-node-wrapper export. Follow-up:
 * federation-codegen should optionally emit composite per-node wrappers so these too
 * can be generated. They mint nothing; every read/write goes through the vetted
 * `@rdfjs/wrapper` mappers (never a hand-built quad).
 */
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { ALBUM_CLASS, ARTIST_CLASS, CORE_AT_TIME, CORE_HAD_PARTICIPANT, DCT_TITLE, FOAF_NAME, MEDIA_DURATION_SECONDS, MEDIA_IN_ALBUM, MEDIA_ISRC, MEDIA_MS_PLAYED, MEDIA_PERFORMED_BY_ARTIST, MEDIA_PLAYED_WORK, PLAYBACK_EVENT_CLASS, RDF_TYPE, TIME_IN_XSD_DATE_TIME, TIME_INSTANT_CLASS, TRACK_CLASS, XSD_DECIMAL, } from "./vocab.js";
/**
 * Typed view of the scrobble (`media:PlaybackEvent`) subject. Each accessor
 * reads/writes through the vetted mappers — no quad is ever hand-built.
 */
export class Scrobble extends TermWrapper {
    /** The scrobble subject IRI. */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `media:PlaybackEvent`. Idempotent; returns `this`. */
    mark() {
        this.types.add(PLAYBACK_EVENT_CLASS);
        return this;
    }
    /** Whether this subject is a `media:PlaybackEvent`. */
    get isPlaybackEvent() {
        return this.types.has(PLAYBACK_EVENT_CLASS);
    }
    /** `media:playedWork` — the played work IRI (→ the Track). */
    get playedWork() {
        return OptionalFrom.subjectPredicate(this, MEDIA_PLAYED_WORK, NamedNodeAs.string);
    }
    set playedWork(value) {
        OptionalAs.object(this, MEDIA_PLAYED_WORK, value, NamedNodeFrom.string);
    }
    /** `core:atTime` — the played-at `time:Instant` node IRI. */
    get atTimeInstant() {
        return OptionalFrom.subjectPredicate(this, CORE_AT_TIME, NamedNodeAs.string);
    }
    set atTimeInstant(value) {
        OptionalAs.object(this, CORE_AT_TIME, value, NamedNodeFrom.string);
    }
    /** `core:hadParticipant` — the listener's WebID IRI. */
    get listener() {
        return OptionalFrom.subjectPredicate(this, CORE_HAD_PARTICIPANT, NamedNodeAs.string);
    }
    set listener(value) {
        OptionalAs.object(this, CORE_HAD_PARTICIPANT, value, NamedNodeFrom.string);
    }
    /** `media:msPlayed` — milliseconds actually played (xsd:integer). */
    get msPlayed() {
        return OptionalFrom.subjectPredicate(this, MEDIA_MS_PLAYED, LiteralAs.number);
    }
    set msPlayed(value) {
        OptionalAs.object(this, MEDIA_MS_PLAYED, value, LiteralFrom.integer);
    }
}
/** Typed view of the `time:Instant` node carrying the played-at `xsd:dateTime`. */
export class PlayedAtInstant extends TermWrapper {
    /** Stamp this subject as a `time:Instant`. Idempotent; returns `this`. */
    mark() {
        SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(TIME_INSTANT_CLASS);
        return this;
    }
    /** `time:inXSDDateTime` — the instant, as a JS `Date`. */
    get dateTime() {
        return OptionalFrom.subjectPredicate(this, TIME_IN_XSD_DATE_TIME, LiteralAs.date);
    }
    set dateTime(value) {
        OptionalAs.object(this, TIME_IN_XSD_DATE_TIME, value, LiteralFrom.dateTime);
    }
}
/** Typed view of the `media:Track` subject. */
export class Track extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(TRACK_CLASS);
        return this;
    }
    get isTrack() {
        return this.types.has(TRACK_CLASS);
    }
    /** `dct:title` — the track title. */
    get title() {
        return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
    }
    set title(value) {
        OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
    }
    /** `media:performedByArtist` — the artist IRI (→ the Artist). */
    get artist() {
        return OptionalFrom.subjectPredicate(this, MEDIA_PERFORMED_BY_ARTIST, NamedNodeAs.string);
    }
    set artist(value) {
        OptionalAs.object(this, MEDIA_PERFORMED_BY_ARTIST, value, NamedNodeFrom.string);
    }
    /** `media:inAlbum` — the album IRI (→ the Album). */
    get album() {
        return OptionalFrom.subjectPredicate(this, MEDIA_IN_ALBUM, NamedNodeAs.string);
    }
    set album(value) {
        OptionalAs.object(this, MEDIA_IN_ALBUM, value, NamedNodeFrom.string);
    }
    /** `media:durationSeconds` — the track length in seconds (xsd:decimal). */
    get durationSeconds() {
        return OptionalFrom.subjectPredicate(this, MEDIA_DURATION_SECONDS, LiteralAs.number);
    }
    set durationSeconds(value) {
        // xsd:decimal via a datatype tuple (LiteralFrom.double would type it xsd:double,
        // which the media SHACL's xsd:decimal constraint would reject).
        OptionalAs.object(this, MEDIA_DURATION_SECONDS, value === undefined ? undefined : [XSD_DECIMAL, String(value)], LiteralFrom.datatypeTuple);
    }
    /** `media:isrc` — the recording's ISRC. */
    get isrc() {
        return OptionalFrom.subjectPredicate(this, MEDIA_ISRC, LiteralAs.string);
    }
    set isrc(value) {
        OptionalAs.object(this, MEDIA_ISRC, value, LiteralFrom.string);
    }
}
/** Typed view of the `media:Artist` subject. */
export class Artist extends TermWrapper {
    mark() {
        SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(ARTIST_CLASS);
        return this;
    }
    /** `foaf:name` — the artist display name. */
    get name() {
        return OptionalFrom.subjectPredicate(this, FOAF_NAME, LiteralAs.string);
    }
    set name(value) {
        OptionalAs.object(this, FOAF_NAME, value, LiteralFrom.string);
    }
}
/** Typed view of the `media:Album` subject. */
export class Album extends TermWrapper {
    mark() {
        SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(ALBUM_CLASS);
        return this;
    }
    /** `dct:title` — the album title. */
    get title() {
        return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
    }
    set title(value) {
        OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
    }
}
//# sourceMappingURL=nodes.js.map