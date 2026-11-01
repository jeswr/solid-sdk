/** Filesystem path to the focused scrobble SHACL shape (`listening.shacl.ttl`). */
export declare const LISTENING_SHAPE_PATH: string;
/** Filesystem path to the federation-extension proposal candidates (`listening.proposals.ttl`). */
export declare const LISTENING_PROPOSALS_PATH: string;
/**
 * The focused `media:PlaybackEvent` scrobble SHACL shape, as a Turtle string.
 * Cached after the first read. Pass it (with the data graph) to a SHACL validator
 * — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export declare function listeningShapeTtl(): string;
/**
 * The `fedcon:Proposal` CANDIDATES for the media-sector gaps this fork's real
 * scrobble data surfaced (completion fraction, source-service attribution,
 * loved/skipped, in-progress-vs-completed), as a Turtle string. Cached after the
 * first read. These are CANDIDATES — not yet POSTed to any registry; the sector
 * `.ttl` is never edited here. See `DECISIONS.md`.
 */
export declare function listeningProposalsTtl(): string;
//# sourceMappingURL=shape.d.ts.map