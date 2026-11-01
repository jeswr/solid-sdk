/**
 * The listening-history / scrobble model — the thin FACADE over the model GENERATED
 * from the `@jeswr/solid-federation-vocab` media sector (`./generated/`, via
 * `@jeswr/federation-codegen` → the audited `@jeswr/model-runtime`). All the
 * untrusted-input guards, the fail-closed cross-node MUSTs (a titled `media:Track`
 * and a valid `time:Instant` MUST be reachable) and the bounded graph-walk parse
 * now live in the audited runtime — this file only preserves the package's exact
 * public surface (`buildScrobble` / `parseScrobble` / `serializeScrobble` /
 * `parseScrobbleTtl` + `ScrobbleData`) so consumers transition transparently.
 *
 * **Three fork-specific adaptations the sector/runtime can't express here** (the
 * generated composite is faithful to the sector; these bridge it to this fork):
 *  1. `playedAt` defaults to `new Date()` (the sector shape marks it a required
 *     Violation MUST but declares no default — a scrobble omits it as "now").
 *  2. `msPlayed` is truncated to an integer (the runtime's `xsd:integer` mapper
 *     drops a non-integer fail-closed; a scrobbler emits fractional ms).
 *  3. `listener` is a SINGLE `core:hadParticipant` WebID (the sector models it
 *     unbounded, which would project as a set), and blank artist/album names are
 *     dropped — composed here via the typed `Scrobble` view.
 */
import type { DatasetCore } from "@rdfjs/types";
import { type Store } from "n3";
export { isHttpIri } from "./iri.js";
export { Album, Artist, PlayedAtInstant, Scrobble, Track } from "./nodes.js";
/**
 * A scrobble as a plain, serialisable object — the shape a fork's importer works
 * with. `trackTitle` is the one required field; everything else is optional
 * metadata a given source service may or may not carry.
 */
export interface ScrobbleData {
    /** `dct:title` on the `media:Track` — the track title (the one required field). */
    trackTitle: string;
    /** `foaf:name` on the `media:Artist` — the artist's display name. */
    artistName?: string;
    /** `dct:title` on the `media:Album` — the album title. */
    albumTitle?: string;
    /** The played-at instant (`time:inXSDDateTime` on the instant). Defaults to `new Date()` on write. */
    playedAt?: Date;
    /** `media:msPlayed` — how long the work was actually played, in **milliseconds** (xsd:integer). */
    msPlayed?: number;
    /** `media:durationSeconds` — the playable duration of the whole track, in **seconds** (xsd:decimal). */
    durationSeconds?: number;
    /** `media:isrc` — the recording's International Standard Recording Code. */
    isrc?: string;
    /** `core:hadParticipant` — the listener's WebID (an http(s) IRI). Dropped if not absolute http(s). */
    listener?: string;
}
/** The conventional subject IRI for the scrobble (`media:PlaybackEvent`) at `resourceUrl`. */
export declare function scrobbleSubject(resourceUrl: string): string;
/** The conventional subject IRIs of the nodes in a scrobble document. */
export declare function scrobbleNodeIris(resourceUrl: string): {
    event: string;
    track: string;
    artist: string;
    album: string;
    instant: string;
};
/**
 * Build the RDF `Store` for a scrobble from a plain {@link ScrobbleData} object via
 * the generated composite model, applying the three fork adaptations (default
 * `playedAt`, truncate `msPlayed`, single `listener` + drop-blank artist/album).
 */
export declare function buildScrobble(resourceUrl: string, data: ScrobbleData): Store;
/** Serialise a `Store` to Turtle with the model's prefixes. */
export declare function storeToTurtle(store: Store): Promise<string>;
/** Build + serialise a scrobble to a Turtle document in one call. */
export declare function serializeScrobble(resourceUrl: string, data: ScrobbleData): Promise<string>;
/**
 * Read a {@link ScrobbleData} back from an RDF dataset (the inverse of
 * {@link buildScrobble}). Returns `undefined` unless the subject is a usable
 * scrobble (a `media:PlaybackEvent` reaching a titled `media:Track` and a valid
 * played-at `time:Instant` — the generated composite's fail-closed cross-node
 * MUSTs). The listener is read + http(s)-filtered here (the sector projects
 * `core:hadParticipant` as an unbounded set).
 */
export declare function parseScrobble(resourceUrl: string, dataset: DatasetCore): ScrobbleData | undefined;
/**
 * Parse a fetched RDF document into {@link ScrobbleData} via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam). A missing/`null` `contentType` is coalesced
 * to `text/turtle`; the resource URL doubles as the base IRI.
 */
export declare function parseScrobbleTtl(resourceUrl: string, body: string, contentType?: string | null): Promise<ScrobbleData | undefined>;
//# sourceMappingURL=scrobble.d.ts.map