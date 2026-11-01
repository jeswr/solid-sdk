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
import { TermWrapper } from "@rdfjs/wrapper";
/**
 * Typed view of the scrobble (`media:PlaybackEvent`) subject. Each accessor
 * reads/writes through the vetted mappers — no quad is ever hand-built.
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
//# sourceMappingURL=nodes.d.ts.map