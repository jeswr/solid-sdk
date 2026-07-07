// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import {
  ALBUM_CLASS,
  ARTIST_CLASS,
  CORE_AT_TIME,
  CORE_HAD_PARTICIPANT,
  DCT_TITLE,
  FOAF_NAME,
  MEDIA_DURATION_SECONDS,
  MEDIA_IN_ALBUM,
  MEDIA_ISRC,
  MEDIA_MS_PLAYED,
  MEDIA_PERFORMED_BY_ARTIST,
  MEDIA_PLAYED_WORK,
  PLAYBACK_EVENT_CLASS,
  PREFIXES,
  RDF_TYPE,
  TIME_IN_XSD_DATE_TIME,
  TIME_INSTANT_CLASS,
  TRACK_CLASS,
  XSD_DECIMAL,
} from "./vocab.js";

// Re-exported so the `.` entry point keeps exposing the untrusted-input filter.
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
export function scrobbleSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/** The conventional subject IRIs of the other nodes in a scrobble document. */
export function scrobbleNodeIris(resourceUrl: string): {
  event: string;
  track: string;
  artist: string;
  album: string;
  instant: string;
} {
  return {
    event: `${resourceUrl}#it`,
    track: `${resourceUrl}#track`,
    artist: `${resourceUrl}#artist`,
    album: `${resourceUrl}#album`,
    instant: `${resourceUrl}#playedAt`,
  };
}

/**
 * Assign `target[key] = value` ONLY when `value` is defined — the "copy an
 * optional field through, omitting it when absent" pattern.
 */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Run an untrusted read, returning `undefined` on ANY throw — the "a malformed
 * foreign literal drops the field, never aborts the parse" guard. A returned
 * `Invalid Date` is treated as absent too (a `LiteralAs.date` of a non-date
 * literal yields `Invalid Date` rather than throwing).
 */
function tryRead<T>(fn: () => T | undefined): T | undefined {
  try {
    const value = fn();
    if (value instanceof Date && Number.isNaN(value.getTime())) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** A finite, non-negative number, else `undefined` — the numeric untrusted-input filter. */
function nonNegativeNumberOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Typed `@rdfjs/wrapper` view of the scrobble (`media:PlaybackEvent`) subject.
 * Each accessor reads/writes through the vetted mappers — no quad is ever
 * hand-built.
 */
export class Scrobble extends TermWrapper {
  /** The scrobble subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `media:PlaybackEvent`. Idempotent; returns `this`. */
  mark(): this {
    this.types.add(PLAYBACK_EVENT_CLASS);
    return this;
  }

  /** Whether this subject is a `media:PlaybackEvent`. */
  get isPlaybackEvent(): boolean {
    return this.types.has(PLAYBACK_EVENT_CLASS);
  }

  /** `media:playedWork` — the played work IRI (→ the Track). */
  get playedWork(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_PLAYED_WORK, NamedNodeAs.string);
  }
  set playedWork(value: string | undefined) {
    OptionalAs.object(this, MEDIA_PLAYED_WORK, value, NamedNodeFrom.string);
  }

  /** `core:atTime` — the played-at `time:Instant` node IRI. */
  get atTimeInstant(): string | undefined {
    return OptionalFrom.subjectPredicate(this, CORE_AT_TIME, NamedNodeAs.string);
  }
  set atTimeInstant(value: string | undefined) {
    OptionalAs.object(this, CORE_AT_TIME, value, NamedNodeFrom.string);
  }

  /** `core:hadParticipant` — the listener's WebID IRI. */
  get listener(): string | undefined {
    return OptionalFrom.subjectPredicate(this, CORE_HAD_PARTICIPANT, NamedNodeAs.string);
  }
  set listener(value: string | undefined) {
    OptionalAs.object(this, CORE_HAD_PARTICIPANT, value, NamedNodeFrom.string);
  }

  /** `media:msPlayed` — milliseconds actually played (xsd:integer). */
  get msPlayed(): number | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_MS_PLAYED, LiteralAs.number);
  }
  set msPlayed(value: number | undefined) {
    OptionalAs.object(this, MEDIA_MS_PLAYED, value, LiteralFrom.integer);
  }
}

/** Typed view of the `time:Instant` node carrying the played-at `xsd:dateTime`. */
export class PlayedAtInstant extends TermWrapper {
  /** Stamp this subject as a `time:Instant`. Idempotent; returns `this`. */
  mark(): this {
    SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
      TIME_INSTANT_CLASS,
    );
    return this;
  }

  /** `time:inXSDDateTime` — the instant, as a JS `Date`. */
  get dateTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, TIME_IN_XSD_DATE_TIME, LiteralAs.date);
  }
  set dateTime(value: Date | undefined) {
    OptionalAs.object(this, TIME_IN_XSD_DATE_TIME, value, LiteralFrom.dateTime);
  }
}

/** Typed view of the `media:Track` subject. */
export class Track extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  mark(): this {
    this.types.add(TRACK_CLASS);
    return this;
  }

  get isTrack(): boolean {
    return this.types.has(TRACK_CLASS);
  }

  /** `dct:title` — the track title. */
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
  }

  /** `media:performedByArtist` — the artist IRI (→ the Artist). */
  get artist(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_PERFORMED_BY_ARTIST, NamedNodeAs.string);
  }
  set artist(value: string | undefined) {
    OptionalAs.object(this, MEDIA_PERFORMED_BY_ARTIST, value, NamedNodeFrom.string);
  }

  /** `media:inAlbum` — the album IRI (→ the Album). */
  get album(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_IN_ALBUM, NamedNodeAs.string);
  }
  set album(value: string | undefined) {
    OptionalAs.object(this, MEDIA_IN_ALBUM, value, NamedNodeFrom.string);
  }

  /** `media:durationSeconds` — the track length in seconds (xsd:decimal). */
  get durationSeconds(): number | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_DURATION_SECONDS, LiteralAs.number);
  }
  set durationSeconds(value: number | undefined) {
    // xsd:decimal via a datatype tuple (LiteralFrom.double would type it xsd:double,
    // which the media SHACL's xsd:decimal constraint would reject).
    OptionalAs.object(
      this,
      MEDIA_DURATION_SECONDS,
      value === undefined ? undefined : [XSD_DECIMAL, String(value)],
      LiteralFrom.datatypeTuple,
    );
  }

  /** `media:isrc` — the recording's ISRC. */
  get isrc(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MEDIA_ISRC, LiteralAs.string);
  }
  set isrc(value: string | undefined) {
    OptionalAs.object(this, MEDIA_ISRC, value, LiteralFrom.string);
  }
}

/** Typed view of the `media:Artist` subject. */
export class Artist extends TermWrapper {
  mark(): this {
    SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
      ARTIST_CLASS,
    );
    return this;
  }

  /** `foaf:name` — the artist display name. */
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FOAF_NAME, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, FOAF_NAME, value, LiteralFrom.string);
  }
}

/** Typed view of the `media:Album` subject. */
export class Album extends TermWrapper {
  mark(): this {
    SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
      ALBUM_CLASS,
    );
    return this;
  }

  /** `dct:title` — the album title. */
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
  }
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
export function buildScrobble(resourceUrl: string, data: ScrobbleData): Store {
  const store = new Store();
  const iris = scrobbleNodeIris(resourceUrl);

  const event = new Scrobble(iris.event, store, DataFactory).mark();
  const track = new Track(iris.track, store, DataFactory).mark();
  event.playedWork = iris.track;

  // The reified played-at instant (core:atTime → a time:Instant).
  const instant = new PlayedAtInstant(iris.instant, store, DataFactory).mark();
  instant.dateTime = data.playedAt ?? new Date();
  event.atTimeInstant = iris.instant;

  // The listener WebID is untrusted / security-sensitive (it becomes a linkable
  // WebID): drop anything that is not an absolute http(s) IRI.
  event.listener = httpIriOrUndefined(data.listener);

  const ms = nonNegativeNumberOrUndefined(data.msPlayed);
  event.msPlayed = ms === undefined ? undefined : Math.trunc(ms);

  // The track. A blank/whitespace-only title is DROPPED (an untitled track is
  // non-conforming, and this keeps build symmetric with parseScrobble's read
  // rejection of a whitespace-only title) — but a non-blank title is written
  // VERBATIM (surrounding whitespace preserved), never normalised, so build and
  // read agree on the exact stored value.
  const rawTitle = data.trackTitle;
  track.title = rawTitle === undefined || rawTitle.trim() === "" ? undefined : rawTitle;
  track.durationSeconds = nonNegativeNumberOrUndefined(data.durationSeconds);
  track.isrc = data.isrc || undefined;

  const artistName = data.artistName?.trim();
  if (artistName) {
    new Artist(iris.artist, store, DataFactory).mark().name = artistName;
    track.artist = iris.artist;
  }

  const albumTitle = data.albumTitle?.trim();
  if (albumTitle) {
    new Album(iris.album, store, DataFactory).mark().title = albumTitle;
    track.album = iris.album;
  }

  return store;
}

/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/** Build + serialise a scrobble to a Turtle document in one call. */
export function serializeScrobble(resourceUrl: string, data: ScrobbleData): Promise<string> {
  return storeToTurtle(buildScrobble(resourceUrl, data));
}

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
export function parseScrobble(resourceUrl: string, dataset: DatasetCore): ScrobbleData | undefined {
  const event = new Scrobble(scrobbleSubject(resourceUrl), dataset, DataFactory);
  if (!event.isPlaybackEvent) return undefined;

  // WHAT — the played work must resolve to a titled media:Track.
  const trackIri = httpIriOrUndefined(tryRead(() => event.playedWork));
  if (trackIri === undefined) return undefined;
  const track = new Track(trackIri, dataset, DataFactory);
  if (!track.isTrack) return undefined;
  // An untitled track is not a usable scrobble. Reject an absent title AND an
  // empty/whitespace-only one (a whitespace title carries no information and the
  // shape flags it non-conforming). The value is returned as-read (not trimmed)
  // so faithful foreign data is preserved.
  const trackTitle = tryRead(() => track.title);
  if (trackTitle === undefined || trackTitle.trim() === "") return undefined;

  // WHEN — the played-at instant must carry a valid xsd:dateTime.
  const instantIri = httpIriOrUndefined(tryRead(() => event.atTimeInstant));
  if (instantIri === undefined) return undefined;
  const playedAt = tryRead(() => new PlayedAtInstant(instantIri, dataset, DataFactory).dateTime);
  if (playedAt === undefined) return undefined;

  const data: ScrobbleData = { trackTitle, playedAt };

  const artistIri = httpIriOrUndefined(tryRead(() => track.artist));
  if (artistIri !== undefined) {
    setIfDefined(
      data,
      "artistName",
      tryRead(() => new Artist(artistIri, dataset, DataFactory).name),
    );
  }

  const albumIri = httpIriOrUndefined(tryRead(() => track.album));
  if (albumIri !== undefined) {
    setIfDefined(
      data,
      "albumTitle",
      tryRead(() => new Album(albumIri, dataset, DataFactory).title),
    );
  }

  setIfDefined(data, "msPlayed", nonNegativeNumberOrUndefined(tryRead(() => event.msPlayed)));
  setIfDefined(
    data,
    "durationSeconds",
    nonNegativeNumberOrUndefined(tryRead(() => track.durationSeconds)),
  );
  setIfDefined(
    data,
    "isrc",
    tryRead(() => track.isrc),
  );
  setIfDefined(data, "listener", httpIriOrUndefined(tryRead(() => event.listener)));

  return data;
}

/**
 * Parse a fetched RDF document into {@link ScrobbleData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam — never a bespoke parser). `contentType`
 * is the response `Content-Type` header (any format `parseRdf` supports); a
 * missing/`null` header is coalesced to `text/turtle`, the suite default. The
 * resource URL doubles as the base IRI so the relative `#it`/`#track`/… subjects
 * resolve.
 */
export async function parseScrobbleTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<ScrobbleData | undefined> {
  const resolvedContentType = contentType ?? "text/turtle";
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
  return parseScrobble(resourceUrl, dataset);
}
