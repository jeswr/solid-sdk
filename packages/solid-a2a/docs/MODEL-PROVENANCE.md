<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# Model provenance ledger — @jeswr/solid-a2a

Standing rule while Fable is unavailable: everything authored by **Claude Opus 4.8** is tagged so it
can be targeted for re-review / upgrade when Fable returns (see the suite charter,
`prod-solid-server/AGENTS.md` § Model provenance).

- **Commit trailers** on every commit: `Model: claude-opus-4-8`,
  `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`,
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Source files** carry an `AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade
  candidate` top-of-file marker.

## Artifacts

| Artifact | Author | Date | Note |
|---|---|---|---|
| Initial package — NL→RDF intent translator, SHACL-bodied Protocol Document, upgrade-handshake codec (M2 of the agentic-Solid roadmap) | Claude Opus 4.8 | 2026-06 | Whole package (`src/`, `test/`, `scripts/`, config, README) is Opus-4.8-authored — a re-review/upgrade candidate. |
| RDFC-1.0 content hashing (0.2.0) — replace bespoke canonicalization with RDFC-1.0 via `rdf-canonize`; new `src/rdf-canonize.d.ts` ambient types; async `buildProtocolDocument`/`hashQuads`/`canonicalNQuads`; spec worked-example conformance vector | Claude Opus 4.8 | 2026-07 | Aligns the content hash to the a2a-rdf extension spec's normative RDFC-1.0 requirement (cross-implementation hash agreement); breaking (hash value + async). |
