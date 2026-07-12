# Model provenance ledger — @jeswr/solid-drawing

Standing rule while Fable is unavailable: everything authored by **Claude Opus
4.8** is tagged so it can be targeted for re-review / upgrade when Fable returns.

- **Commit trailers:** `Model: claude-opus-4-8`,
  `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`,
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **New source files:** an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

## Artifacts

| Artifact | Author | Notes |
|---|---|---|
| `src/vocab.ts` | Claude Opus 4.8 | The five minted `draw:` terms (IRI + `NamedNode` constants) + re-used dct/schema/prov. |
| `src/scene.ts` | Claude Opus 4.8 | build/serialize (n3.Writer) + parse (@jeswr/fetch-rdf) of a `draw:Scene` descriptor. |
| `src/shape.ts` | Claude Opus 4.8 | Reads the SHACL shape + ontology TTLs as strings. |
| `src/index.ts` | Claude Opus 4.8 | Public API surface. |
| `drawing.ttl` | Claude Opus 4.8 | The ontology — `draw:Scene` rdfs:subClassOf schema:CreativeWork + gufo:SubKind of core:InformationResource. |
| `drawing.shacl.ttl` | Claude Opus 4.8 | The `draw:Scene` SHACL validation contract. |
| `scripts/*.mjs` | Claude Opus 4.8 | check-dist (committed-dist drift guard — plain tsc rebuild vs the git index), check-lockfile-transport (#78 SSH-transport guard). |
| Tests (`src/*.test.ts`) | Claude Opus 4.8 | vocab presence, SHACL validity, serialize→parse round-trip. |

The package is **experimental, AI-agent-generated** — under active development,
not production-hardened.
