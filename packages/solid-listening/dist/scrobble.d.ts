/**
 * The listening-history / scrobble model — typed read/write accessors over a
 * single owner-private **scrobble document** (the data model a Web Scrobbler→Solid
 * fork writes one-per-play to a pod).
 *
 * **One scrobble = one pod resource, owner-private.** The document holds a small
 * connected graph, all reusing the `@jeswr/solid-federation-vocab` **media
 * sector** (this package mints nothing — see {@link ./vocab.ts}):
 *
 * ```turtle
 * <#it>  a media:PlaybackEvent ;         # the scrobble (WHAT/WHEN/HOW-LONG/WHO)
 *   media:playedWork <#track> ; core:atTime <#playedAt> ;
 *   media:msPlayed 194000 ; core:hadParticipant <…/card#me> .
 * <#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T…Z"^^xsd:dateTime .
 * <#track>  a media:Track ; dct:title "…" ;
 *   media:performedByArtist <#artist> ; media:inAlbum <#album> ;
 *   media:durationSeconds 210.0 ; media:isrc "…" .
 * <#artist> a media:Artist ; foaf:name "…" .
 * <#album>  a media:Album  ; dct:title "…" .
 * ```
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store` — no quad is ever hand-concatenated. Serialisation is `n3.Writer`;
 * parsing of a fetched body is `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * **Untrusted-input hardening.** Pod data is untrusted: every optional read is
 * `tryRead`-guarded so a malformed foreign literal DROPS the field rather than
 * aborting the whole parse; every IRI-valued field (the listener WebID, the
 * played-work / artist / album references, the instant) is passed through the
 * http(s)-only {@link ./iri.ts} filter so a hostile `javascript:`/`data:` value is
 * never surfaced as a clickable/dereferenceable IRI; and a Date literal that
 * parses to `Invalid Date` is dropped.
 *
 * **The reified played-at instant (not a bare literal).** `core:atTime`'s range is
 * `time:TemporalEntity` (an OBJECT), not a literal, so the played-at time is
 * carried by a `time:Instant` node with a `time:inXSDDateTime` value — the RDF-
 * correct shape the media SHACL profile expects, not a datatype-mismatched literal
 * on `core:atTime` directly.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
export { isHttpIri } from "./iri.js";
/**
 * A scrobble as a plain, serialisable object — the shape a fork's importer works
 * with. `trackTitle` + `playedAt` are the load-bearing fields; everything else is
 * optional metadata a given source service may or may not carry.
 */
export interface ScrobbleData {
    /** `dct:title` on the `media:Track` — the track title (the one required field). */
    trackTitle: string;
    /** `foaf:name` on the `media:Artist` — the artist's display name. */
    artistName?: string;
    /** `dct:title` on the `media:Album` — the album title. */
    albumTitle?: string;
    /**
     * The played-at instant — `time:inXSDDateTime` on the `time:Instant` that
     * `core:atTime` points at. Defaults to `new Date()` on write.
     */
    playedAt?: Date;
    /**
     * `media:msPlayed` — how long the work was actually played, in **milliseconds**
     * (xsd:integer). Distinguishes a skip from a full listen. Non-negative;
     * truncated to an integer on write.
     */
    msPlayed?: number;
    /**
     * `media:durationSeconds` — the playable duration of the whole track, in
     * **seconds** (xsd:decimal). Together with {@link msPlayed} this is what a
     * completion fraction WOULD be derived from — see the `DECISIONS.md`
     * completion-fraction gap.
     */
    durationSeconds?: number;
    /** `media:isrc` — the recording's International Standard Recording Code. */
    isrc?: string;
    /**
     * `core:hadParticipant` — the listener's WebID (an http(s) IRI). The pod owner
     * for an owner-private scrobble. Dropped if not an absolute http(s) IRI.
     */
    listener?: string;
}
/** The conventional subject IRI for the scrobble (`media:PlaybackEvent`) at `resourceUrl`. */
export declare function scrobbleSubject(resourceUrl: string): string;
/** The conventional subject IRIs of the other nodes in a scrobble document. */
export declare function scrobbleNodeIris(resourceUrl: string): {
    event: string;
    track: string;
    artist: string;
    album: string;
    instant: string;
};
/**
 * Typed `@rdfjs/wrapper` view of the scrobble (`media:PlaybackEvent`) subject.
 * Each accessor reads/writes through the vetted mappers — no quad is ever
 * hand-built.
 */
export declare class Scrobble extends TermWrapper {
    /** The scrobble subject IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `media:PlaybackEvent`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `media:PlaybackEvent`. */
    get isPlaybackEvent(): boolean;
    /** `media:playedWork` — the played work IRI (→ the Track). */
    get playedWork(): string | undefined;
    set playedWork(value: string | undefined);
    /** `core:atTime` — the played-at `time:Instant` node IRI. */
    get atTimeInstant(): string | undefined;
    set atTimeInstant(value: string | undefined);
    /** `core:hadParticipant` — the listener's WebID IRI. */
    get listener(): string | undefined;
    set listener(value: string | undefined);
    /** `media:msPlayed` — milliseconds actually played (xsd:integer). */
    get msPlayed(): number | undefined;
    set msPlayed(value: number | undefined);
}
/** Typed view of the `time:Instant` node carrying the played-at `xsd:dateTime`. */
export declare class PlayedAtInstant extends TermWrapper {
    /** Stamp this subject as a `time:Instant`. Idempotent; returns `this`. */
    mark(): this;
    /** `time:inXSDDateTime` — the instant, as a JS `Date`. */
    get dateTime(): Date | undefined;
    set dateTime(value: Date | undefined);
}
/** Typed view of the `media:Track` subject. */
export declare class Track extends TermWrapper {
    get types(): Set<string>;
    mark(): this;
    get isTrack(): boolean;
    /** `dct:title` — the track title. */
    get title(): string | undefined;
    set title(value: string | undefined);
    /** `media:performedByArtist` — the artist IRI (→ the Artist). */
    get artist(): string | undefined;
    set artist(value: string | undefined);
    /** `media:inAlbum` — the album IRI (→ the Album). */
    get album(): string | undefined;
    set album(value: string | undefined);
    /** `media:durationSeconds` — the track length in seconds (xsd:decimal). */
    get durationSeconds(): number | undefined;
    set durationSeconds(value: number | undefined);
    /** `media:isrc` — the recording's ISRC. */
    get isrc(): string | undefined;
    set isrc(value: string | undefined);
}
/** Typed view of the `media:Artist` subject. */
export declare class Artist extends TermWrapper {
    mark(): this;
    /** `foaf:name` — the artist display name. */
    get name(): string | undefined;
    set name(value: string | undefined);
}
/** Typed view of the `media:Album` subject. */
export declare class Album extends TermWrapper {
    mark(): this;
    /** `dct:title` — the album title. */
    get title(): string | undefined;
    set title(value: string | undefined);
}
/**
 * Build the RDF `Store` for a scrobble from a plain {@link ScrobbleData} object,
 * via the typed accessors (no hand-built quads).
 *
 * - The track title is written only when non-empty (an empty title carries no
 *   information and the shape requires a title, so a `{ trackTitle: "" }` yields
 *   a non-conforming document — intentional, matching the suite convention).
 * - `playedAt` defaults to `new Date()`.
 * - `msPlayed` / `durationSeconds` are dropped unless finite and non-negative;
 *   `msPlayed` is truncated to an integer.
 * - `listener` is dropped unless it is an absolute http(s) IRI (never coerce an
 *   untrusted value into a malformed `NamedNode`).
 * - The artist / album sub-nodes are written only when their field is present.
 */
export declare function buildScrobble(resourceUrl: string, data: ScrobbleData): Store;
/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export declare function storeToTurtle(store: Store): Promise<string>;
/** Build + serialise a scrobble to a Turtle document in one call. */
export declare function serializeScrobble(resourceUrl: string, data: ScrobbleData): Promise<string>;
/**
 * Read a {@link ScrobbleData} back from an RDF dataset (the inverse of
 * {@link buildScrobble}). Returns `undefined` unless the subject is a
 * `media:PlaybackEvent` that has ALL of: a played work (`media:playedWork`, an
 * http(s) IRI) whose `media:Track` carries a `dct:title`, and a `core:atTime`
 * instant with a valid `time:inXSDDateTime`. Those are the load-bearing MUSTs
 * (per the media SHACL profile + the shipped shape); a scrobble missing any of
 * them is not a usable scrobble. Every optional field is `tryRead`-guarded and
 * IRI fields are http(s)-filtered — untrusted pod data can drop a field but can
 * never abort the parse or surface a hostile IRI.
 */
export declare function parseScrobble(resourceUrl: string, dataset: DatasetCore): ScrobbleData | undefined;
/**
 * Parse a fetched RDF document into {@link ScrobbleData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam — never a bespoke parser). `contentType`
 * is the response `Content-Type` header (any format `parseRdf` supports); a
 * missing/`null` header is coalesced to `text/turtle`, the suite default. The
 * resource URL doubles as the base IRI so the relative `#it`/`#track`/… subjects
 * resolve.
 */
export declare function parseScrobbleTtl(resourceUrl: string, body: string, contentType?: string | null): Promise<ScrobbleData | undefined>;
//# sourceMappingURL=scrobble.d.ts.map