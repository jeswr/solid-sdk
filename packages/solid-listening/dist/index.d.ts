/**
 * `@jeswr/solid-listening` — the media-sector **listening-history / scrobble** RDF
 * model (the data model a [Web Scrobbler](https://github.com/web-scrobbler/web-scrobbler)→Solid
 * fork writes one-per-play to a pod).
 *
 * **Mints nothing.** A scrobble is a `media:PlaybackEvent` (from the
 * `@jeswr/solid-federation-vocab` media sector) referencing a `media:Track`
 * credited to a `media:Artist` and optionally on a `media:Album`; the model reuses
 * those terms verbatim. Where a real scrobble needs a field the sector LACKS, the
 * gap is written up as a `fedcon:Proposal` CANDIDATE (`listening.proposals.ttl` /
 * `DECISIONS.md`) rather than edited into the sector — real fork usage drives the
 * sector's evolution. See {@link ./vocab.ts}.
 *
 * **Browser-safe root.** This entry point pulls in NO `node:*` built-ins — the
 * vocab + the typed model + the owner-only ACL BUILDER run in the browser. The
 * shape/proposals file readers live behind the `@jeswr/solid-listening/shape`
 * subpath ONLY (they `readFileSync` the shipped `.ttl`s, so they are Node-only).
 *
 * @packageDocumentation
 */
export { aclUrlFor, buildOwnerOnlyAcl, writeOwnerOnlyAcl, } from "./acl.js";
export { Album, Artist, buildScrobble, isHttpIri, PlayedAtInstant, parseScrobble, parseScrobbleTtl, Scrobble, type ScrobbleData, scrobbleNodeIris, scrobbleSubject, serializeScrobble, storeToTurtle, Track, } from "./scrobble.js";
export { ACL, ALBUM_CLASS, ARTIST_CLASS, acl, CORE, CORE_AT_TIME, CORE_HAD_PARTICIPANT, CORE_HAS_PART, CORE_SUBJECT, core, DCT, DCT_TITLE, dct, FOAF, FOAF_NAME, foaf, LISTENING_ACTIVITY_CLASS, LISTENING_HISTORY_CLASS, MEDIA, MEDIA_DURATION_SECONDS, MEDIA_IN_ALBUM, MEDIA_ISRC, MEDIA_MS_PLAYED, MEDIA_PERFORMED_BY_ARTIST, MEDIA_PLAYED_WORK, media, PLAYBACK_EVENT_CLASS, PREFIXES, RDF, RDF_TYPE, RDFS, rdf, TIME, TIME_IN_XSD_DATE_TIME, TIME_INSTANT_CLASS, TRACK_CLASS, time, XSD, XSD_DECIMAL, xsd, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map