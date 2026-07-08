# @jeswr/solid-listening

The RDF model for a **listening history** — one **scrobble** (a single play) per pod
resource, owner-private. The data model a
[Web Scrobbler](https://github.com/web-scrobbler/web-scrobbler)→Solid fork writes
to a pod, and the first model package of the OSS-forks batch 2.

It **mints nothing.** A scrobble is exactly what the
[`@jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)
**media sector** already models — a `media:PlaybackEvent` referencing a
`media:Track`, credited to a `media:Artist` and (optionally) on a `media:Album`,
aggregated into a `media:ListeningHistory` — so the model reuses those terms
verbatim. It gives you typed read/write accessors that **never hand-build a
triple** (parse via [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf),
serialise via `n3.Writer`), a focused SHACL shape, an owner-only fail-closed WAC
ACL helper, and — its real point — a set of **`fedcon:Proposal` candidates** for
the media-sector gaps that modelling real scrobble data surfaced.

The scrobble **model is generated from the media sector** via
[`@jeswr/federation-codegen`](https://github.com/jeswr/federation-codegen)'s
composite/document-projection generator, interpreted by the audited
[`@jeswr/model-runtime`](https://github.com/jeswr/model-runtime) — the guards, the
fail-closed cross-node MUSTs and the graph-walk parse live in that one audited
runtime, not hand-written here. `src/scrobble.ts` is a thin facade over the
generated core; `codegen/` holds the generation inputs (`npm run gen` regenerates,
`check:generated` guards drift). See [`DECISIONS.md`](./DECISIONS.md) D6.

## Install

GitHub-installable now (no build step — the built `dist/` is committed and the
package sets `ignore-scripts=true`):

```bash
npm install github:jeswr/solid-listening#main
```

## The model — one scrobble document

```turtle
<#it>  a media:PlaybackEvent ;              # the scrobble
  media:playedWork <#track> ;              # WHAT
  core:atTime <#playedAt> ;                # WHEN (a reified instant)
  media:msPlayed 194000 ;                  # HOW-LONG (ms)
  core:hadParticipant <…/card#me> .        # WHO (the listener WebID)
<#playedAt> a time:Instant ; time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
<#track>  a media:Track ; dct:title "Teardrop" ;
  media:performedByArtist <#artist> ; media:inAlbum <#album> ;
  media:durationSeconds 329.5 ; media:isrc "GBAAA9900123" .
<#artist> a media:Artist ; foaf:name "Massive Attack" .
<#album>  a media:Album  ; dct:title "Mezzanine" .
```

Everything above is a **reused** term. `dct:title` is the media profile's own
titled-work property; `foaf:name` is reused for the artist display name (the
sector declares no literal name property — see `DECISIONS.md`); `time:Instant` +
`time:inXSDDateTime` reify the played-at instant because `core:atTime`'s range is
`time:TemporalEntity`, an object, not a literal.

> **Persistent IDs.** The `media:` / `core:` IRIs are historically minted under
> `w3id.org/jeswr` — legacy identifiers that re-mint to the maintainer's live
> `jeswr.org` persistent-ID layer per the staged migration (minted IRIs in code
> are not hand-edited). `fedcon:` (`https://jeswr.org/fedcon#`) is already
> `jeswr.org`-rooted. This package mints no new persistent identifier.

## Usage

```ts
import {
  buildScrobble,
  serializeScrobble,
  parseScrobble,
  parseScrobbleTtl,
  writeOwnerOnlyAcl,
} from "@jeswr/solid-listening";

// Build + serialise one scrobble to Turtle (n3.Writer under the hood)
const ttl = await serializeScrobble("https://alice.pod/listening/2026/07/07-1", {
  trackTitle: "Teardrop",
  artistName: "Massive Attack",
  albumTitle: "Mezzanine",
  msPlayed: 194000,
  durationSeconds: 329.5,
  listener: "https://alice.pod/profile/card#me",
});

// Parse a fetched RDF document back (dispatches via @jeswr/fetch-rdf — any
// content-type it supports: Turtle, N-Triples, N-Quads, TriG, JSON-LD)
const data = await parseScrobbleTtl("https://alice.pod/listening/2026/07/07-1", ttl, "text/turtle");
//   → { trackTitle, artistName, albumTitle, playedAt, msPlayed, durationSeconds, listener }

// Scrobbles are owner-private — write an owner-only, fail-closed ACL first
await writeOwnerOnlyAcl(
  "https://alice.pod/listening/",
  "https://alice.pod/profile/card#me",
  authedFetch,
);
```

`parseScrobble` returns `undefined` for anything that is not a usable scrobble (no
played work, an untitled track, or no valid played-at instant), and its
untrusted-input hardening drops a hostile / malformed field (a non-http(s)
listener IRI, a malformed date/number literal) rather than aborting the parse.

## The point — media-sector extension needs (fedcon proposals)

This package is an **ontology test rig**: as it maps concrete scrobble data onto
the media sector, it discovers fields the sector lacks. Rather than editing the
sector `.ttl`, each gap is written up as a concrete **`fedcon:Proposal`
candidate** — machine-readable in
[`listening.proposals.ttl`](./listening.proposals.ttl), with the rationale + the
alternatives in [`DECISIONS.md`](./DECISIONS.md). Real fork usage drives the
sector's evolution through the registry contribution lifecycle.

| # | Gap the sector lacks | Proposed additive term(s) | Status |
|---|---|---|---|
| 1 | Per-event **completion fraction** + **in-progress-vs-completed** status (`media:msPlayed`/`media:durationSeconds` are lossy and can't say "now playing") | `media:completionFraction` (0..1 decimal), `media:playbackStatus` (NowPlaying/Completed/Skipped) | `completionFraction` **ADOPTED** (@3fba46e); `playbackStatus` candidate |
| 2 | **Source-service attribution** — which platform a play came from when there is no `media:MediaAccount` (a scrobbled YouTube/SoundCloud play) | `media:playedVia` (service IRI / labelled node) | **ADOPTED** (@3fba46e) |
| 3 | **Loved / skipped** per-play user feedback (Web Scrobbler "love" + skip) | `media:loved`, `media:skipped` (booleans) | `loved` **ADOPTED** (@3fba46e); `skipped` candidate |
| 4 | media:Artist has no literal **display-name** property (this package reuses `foaf:name`) | document `foaf:name` as the artist-name alignment | **ADOPTED** (@3fba46e — ArtistShape names `foaf:name`) |

**Three of the four have since landed in the media sector** (@`3fba46e`) — the rig
working as intended: real fork usage → sector terms → the generated model reuses
them. `media:playbackStatus` and `media:skipped` remain candidates. The sector is
never edited here.

## Public API

`./` (main — **browser-safe, no `node:*`**): `Scrobble`, `Track`, `Artist`,
`Album`, `PlayedAtInstant`, `ScrobbleData`, `scrobbleSubject`,
`scrobbleNodeIris`, `buildScrobble`, `serializeScrobble`, `storeToTurtle`,
`parseScrobble`, `parseScrobbleTtl`, `isHttpIri`; the owner-only ACL helpers
`buildOwnerOnlyAcl`, `writeOwnerOnlyAcl`, `aclUrlFor`; and the reused vocab
constants/builders (`MEDIA`, `PLAYBACK_EVENT_CLASS`, `MEDIA_PLAYED_WORK`,
`CORE_AT_TIME`, `PREFIXES`, …).

`./shape` (**Node-only** — `readFileSync`s the shipped `.ttl`s):
`listeningShapeTtl`, `listeningProposalsTtl`, `LISTENING_SHAPE_PATH`,
`LISTENING_PROPOSALS_PATH`. Kept off the root so a browser bundle never pulls in
`node:fs`.

Subpath exports: `@jeswr/solid-listening/vocab`, `/shape`,
`/listening.shacl.ttl`, `/listening.proposals.ttl`.

## Develop

```bash
npm run gen    # regenerate src/generated/ from codegen/ inputs (the media sector)
npm run gate   # lint + typecheck + test + build + check:generated + check:dist + check:lockfile-transport
```

`dist/` and `src/generated/` are committed. `check:generated` fails if the
generated model drifts from a fresh generation (edit `codegen/` inputs, never the
generated files, then `npm run gen`); `check:dist` fails if `dist/` drifts from a
fresh build — rebuild + commit both alongside any change.

## License

[MIT](./LICENSE) © Jesse Wright
