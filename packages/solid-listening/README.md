<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 (workspace import edits) -->

# @jeswr/solid-listening

> **Experimental, AI-agent-generated.** Lives in `packages/solid-listening` of the
> [`jeswr/solid-sdk`](https://github.com/jeswr/solid-sdk) workspace; the standalone
> `jeswr/solid-listening` repository becomes a read-only build mirror. Design of record:
> [`decisions/0003-domain-model-codegen.md`](../../decisions/0003-domain-model-codegen.md).

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
generated core; `codegen/` holds the generation inputs (`pnpm run codegen`
regenerates, and `test/codegen.test.ts` guards drift). See [`DECISIONS.md`](./DECISIONS.md) D6.

## Install

Inside the workspace, depend on it as `"@jeswr/solid-listening": "workspace:*"`.
Outside it, install the read-only mirror once it is published
(`github:jeswr/solid-listening#<sha>`); mirrors carry the built `dist/`.

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

From the workspace root:

```bash
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-listening run codegen   # regenerate src/generated/ from codegen/
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-listening
```

`src/generated/` is committed; `dist/` is built fresh and never committed here. The
drift test (`test/codegen.test.ts`) regenerates into a temporary directory and fails on
any byte difference, and the workspace `check:codegen` guard requires it. Edit the
`codegen/` inputs, never the generated files; for a deliberate input change pass
`--update-lock` to the codegen command and review the lock diff.

The codegen input profile (`codegen/media.shapes.ttl`) is the media sector's five
scrobble shapes, with three deliberate projections documented in its header: the ISRC
`sh:pattern` and the unprojected `media:playedVia` shape are left out (the generator
has no reviewed guard for them, and no earlier model enforced them), and
`media:playedWork` is narrowed to `sh:class media:Track`, matching
`listening.shacl.ttl`. The published `listening.shacl.ttl` keeps the ISRC pattern (it
never constrained `playedVia`).

### Exact divergences from the July package

The model now runs on the workspace `@jeswr/model-runtime`, which follows the media
SHACL profile exactly. Compared with the July package (the same generated core on the
git-pinned runtime `8c7f78e`), `parseScrobble` differs as follows, pinned in
`test/compatibility.test.ts`:

- A required value that does not conform rejects the scrobble: a language-tagged,
  repeated or IRI `dct:title` on the track, or two `time:inXSDDateTime` values. July
  admitted these. A scrobble written by another client with a language-tagged title
  therefore no longer parses; whether the profile should accept `rdf:langString` titles
  is an open normative question.
- An ambiguous optional value drops that field (two `media:isrc` values, two artist
  names) instead of keeping the first.
- A track typed with a class that the same document declares `rdfs:subClassOf
  media:Track` is accepted (SHACL `sh:class` semantics). Field values are still read only
  from the scrobble's own `#track` node.

## License

[MIT](./LICENSE) © Jesse Wright

## Owner-only access changes (sst-9ku5)

Online owner-only writes now delegate to `@jeswr/pod-access/roles` `makeOwnerOnly`.
They discover the server's ACL/ACR Link, support WAC and CSS ACP, and refuse missing
or ambiguous Links, unknown/mixed models, malformed/unsupported policies, unsafe URLs
and foreign resource bindings. Targets must exist and support HEAD discovery; an
`acl`-only Link requires model evidence in readable own or ancestor RDF. Credentialed
URLs, resource queries/fragments and ambiguous encoded paths now refuse. The wrappers
use the default trusted CSS dialect;
ESS deployments should call `makeOwnerOnly` with `implementation: "ess"` directly.
Creation uses `If-None-Match: *`; replacement requires a strong ETag and `If-Match`.
An existing document naming other principals now refuses instead of silently removing
their access; explicit removal requires a direct helper call with `replace: true`.
Foreign inherited ACP member grants always refuse. No error is swallowed and 412 is
never retried. Access transport now refuses redirects and disables caching; failures
use pod-access's typed role errors (parser errors propagate).

The owner receives Read/Write/Append and management; explicit Append is redundant with
Write. Containers retain member defaults; resource writes omit defaults. Descendants'
own policies are not rewritten. Private access is still installed before imported content.
The exported offline WAC builders keep their signatures and graph meaning (Read/Write/
Control and their historical defaults) but now use pod-access's policy serializer, so
Turtle prefix spelling and authorization subject names can change. They do not perform
server discovery or prove that a resource is private. Any `aclUrlFor` export remains a
deprecated offline convention, and is never used to choose an online write URL.
