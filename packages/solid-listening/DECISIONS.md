# Design decisions — @jeswr/solid-listening

<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

Rationale for the listening-history / scrobble model, and the machine-readable
`fedcon:Proposal` candidates it surfaced. Recorded per the suite
proceed-without-greenlight rule: the maintainer reviews + steers after the fact.

## D1 — Mint nothing; reuse the media sector verbatim

Unlike a leaf model (e.g. `@jeswr/solid-bookmark`, which mints `book:Bookmark`
because bookmarks had no sector home), a scrobble is **exactly** what the
`@jeswr/solid-federation-vocab` **media sector**
(`media:`, `https://w3id.org/jeswr/sectors/media#`) already models: a
`media:PlaybackEvent` (WHAT/WHEN/HOW-LONG) → a `media:Track` credited to a
`media:Artist` and (optionally) on a `media:Album`, aggregated by a
`media:ListeningHistory`. So the model reuses those terms and **mints no new
IRI**. This keeps the fork on the federation's canonical spine rather than a
second dialect, and makes the deliverable's real value the **gap list** below,
not new terms.

## D2 — The reified played-at instant, not a literal on `core:atTime`

`core:atTime`'s range is `time:TemporalEntity` (an object), not a literal — the
sector deliberately gives it no `rdfs:domain`/literal range because it spans
endurants and events (gUFO-disjoint). So the played-at time is carried by a
`time:Instant` node (`<#playedAt>`) with a `time:inXSDDateTime` value. This is
the RDF-correct shape the media SHACL profile's `PlaybackEventShape` expects
(`core:atTime` present, WHEN recorded), rather than a datatype-mismatched literal
directly on `core:atTime`. `time:inXSDDateTime` (range `xsd:dateTime`) is chosen
over `time:inXSDDateTimeStamp` so the value round-trips through the proven
`LiteralFrom.dateTime` / `LiteralAs.date` mappers with a consistent datatype.

## D3 — `foaf:name` for the artist display name (reuse-before-mint)

The media sector models `media:Artist` (a RoleMixin of `core:Agent`) but declares
**no literal name property** — a real gap, since a scrobble only ever knows the
artist as a string. Rather than mint one, this package **reuses `foaf:name`**
(the dereferenceable, universal agent-name term). Filed as an OBSERVATION
(proposal #4) recommending the sector document `foaf:name` as the artist-name
alignment, so every producer agrees rather than each independently picking
`foaf:name` / `schema:name` / `rdfs:label`.

## D4 — Owner-private scrobbles; a focused, additive SHACL shape

A listening history is behavioural data, so every scrobble is owner-private: the
`buildOwnerOnlyAcl` / `writeOwnerOnlyAcl` helper (shared design with
`@jeswr/solid-health-diary`) writes a fail-closed owner-only ACL — no public /
`acl:agentClass` grant, throwing on a non-http(s) owner WebID or a
fragment/query-bearing resource URL rather than emitting an open ACL.

The shipped `listening.shacl.ttl` is a DOWNSTREAM, additive profile that checks
the scrobble wire contract. Where the media sector's own profile is stricter
(`core:hadParticipant` and `media:onAccount` are MUST/SHOULD on every
`PlaybackEvent`), this focused shape treats them as OPTIONAL — a scrobble
legitimately omits the account and carries the listener only as the implicit pod
owner. That very divergence is a signal feeding the gap list.

## D5 — Untrusted-input hardening

Pod data is untrusted. Every optional read is `tryRead`-guarded so a malformed
foreign literal drops the field rather than aborting the whole parse; every
IRI-valued field (the listener WebID, the played-work / artist / album / instant
references) passes through the http(s)-only filter (`httpIriOrUndefined`) so a
hostile `javascript:`/`data:` value is never surfaced; a Date literal that parses
to `Invalid Date` is dropped; numeric fields are dropped unless finite and
non-negative. `parseScrobble` returns `undefined` for anything that is not a
usable scrobble (no played work, an untitled track, or no valid played-at).

## D6 — The MODEL is generated from the media sector (not hand-written)

The scrobble document MODEL — `buildScrobble` / `parseScrobble` /
`serializeScrobble` / `parseScrobbleTtl` — is now **generated** from the media
sector via [`@jeswr/federation-codegen`](https://github.com/jeswr/federation-codegen)'s
composite/document-projection generator, interpreted by the audited
[`@jeswr/model-runtime`](https://github.com/jeswr/model-runtime). This is the suite
directive "models are generated from the federation, not hand-written": the
untrusted-input guards, the fail-closed cross-node MUSTs (a titled `media:Track`
and a valid `time:Instant` MUST be reachable) and the bounded graph-walk parse now
live in the ONE audited runtime rather than being re-implemented per package.

- **Inputs** (`codegen/`): a minimal admission ontology (the four sector classes,
  labels+definitions verbatim), the five scrobble NodeShapes copied verbatim from the
  sector's `media.shacl.ttl`, and a composite config (`Scrobble` = event `#it` → track
  `#track` → artist `#artist` / album `#album` + played-at `#playedAt`). `npm run gen`
  regenerates `src/generated/`; `check:generated` fails if it drifts from a fresh
  generation.
- **Dependency shape** — following the bookmarks generated-reference:
  `@jeswr/model-runtime` is a sha-pinned `git+https` RUNTIME dependency (the generated
  `model.js` is a fixed-template shim over it); nothing is inlined. `dist/` ships the
  copied generated `model.js`/`.d.ts` so the package stays GitHub-installable under
  `ignore-scripts=true`.
- **Facade** (`src/scrobble.ts`, ~130 LOC) preserves the exact public surface and adds
  three fork-specific bridges the sector/runtime can't express here: default `playedAt`
  to now; truncate `msPlayed` to an integer (the `xsd:integer` mapper drops a float
  fail-closed); treat `core:hadParticipant` as a SINGLE http(s)-filtered `listener` (the
  sector models it unbounded) + drop-blank artist/album + reject a malformed-dateTime
  played-at. The `Track`/`Artist`/`Album`/`PlayedAtInstant` typed VIEWS stay hand-written
  in `src/nodes.ts` because the composite runtime exposes only the root wrapper — a
  follow-up for federation-codegen to emit per-node wrappers.

---

## The media-sector extension needs (fedcon:Proposal candidates)

Modelling real scrobble data (a Web Scrobbler connector emits track/artist/album,
a played-at time, ms-played, a source connector, a love toggle, and a
now-playing-vs-scrobble distinction) surfaced four gaps in the media sector. Each
is written up as a `fedcon:Proposal` candidate in
[`listening.proposals.ttl`](./listening.proposals.ttl), the sector `.ttl` **never
edited here**; real fork usage drives the sector's evolution through the registry
contribution lifecycle (`fedcon:` = `https://jeswr.org/fedcon#`).

**Status (2026-07): three of the four are now ADOPTED into the media sector**
(solid-federation-vocab @ `3fba46e`) — `media:completionFraction`, `media:playedVia`
and `media:loved` are graded properties on the sector's PlaybackEvent shape, and the
ArtistShape now names `foaf:name` (adopting observation #4). The generated model reuses
the landed terms. The remaining candidates are `media:playbackStatus` (gap #1) and
`media:skipped` (gap #3) — this is the rig working as intended: gaps → sector terms →
generated model.

### 1. Per-event completion fraction + in-progress-vs-completed status

**Gap.** The sector has `media:msPlayed` (ms played, on the event) and
`media:durationSeconds` (total length, on the work) but **no normalised completion
fraction** and **no in-progress-vs-completed distinction**. A scrobbler must know
"full listen or skip", and Web Scrobbler additionally emits a **"nowplaying"**
signal (currently playing, not finalised) distinct from a committed "scrobble".
Deriving a fraction from `msPlayed`/`durationSeconds` is lossy (`durationSeconds`
is often absent, and a live stream has none) and cannot express "in progress".

**Proposal (Extend).** `media:completionFraction` (a `[0,1]` `xsd:decimal` on the
event) + `media:playbackStatus` (a coded value: NowPlaying / Completed /
Skipped). Kept explicit rather than derived so intent is first-class.

### 2. Source-service attribution (`media:playedVia`)

**Gap.** `media:onAccount` links a play to a `media:MediaAccount` (a reified
streaming account). But a Web Scrobbler play very often has **no account** — it is
scrobbled from an anonymous web player (YouTube, SoundCloud, Bandcamp, a radio
site). What the fork always knows is the **service / connector**. The sector has no
way to say "played via YouTube Music" without inventing a fake account.

**Proposal (Extend).** `media:playedVia` — the media service/platform a play
occurred on, as a service IRI or labelled node — independent of whether a
`media:MediaAccount` is known.

### 3. Loved / skipped flags

**Gap.** Web Scrobbler exposes a love/unlove affordance and a skip signal — per-play
user feedback the sector cannot record. `media:msPlayed` hints at a skip but
conflates "skipped by the user" with "stopped for any reason".

**Proposal (Extend).** `media:loved` + `media:skipped` (`xsd:boolean` on the
event), so the user's intent is first-class, not inferred.

### 4. A literal artist-name term on `media:Artist` (observation)

**Gap.** `media:Artist` has no literal display-name property (see D3). This package
reuses `foaf:name`.

**Proposal (Extend / observation).** The sector SHOULD document `foaf:name` as the
expected artist-name alignment so every producer agrees.
