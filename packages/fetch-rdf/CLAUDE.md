# fetch-rdf

Part of [`solid-app-suite`](../../) — Jesse Wright's master Solid workspace.

This file is the bootstrap CLAUDE.md for this sub-repo. It is **not**
overwritten by `sync-standards.sh`; you can edit it freely. The shared
standards live in [`STANDARDS.md`](./STANDARDS.md) (which *is* managed by
the master repo — don't edit there).

## What this repo is

`@jeswr/fetch-rdf` — the canonical fetch + parse helpers for Solid RDF
across Jesse's workspace. `parseRdf` dispatches on `Content-Type`
(Turtle / N-Triples / N-Quads / TriG via `n3`; JSON-LD via
`jsonld-streaming-parser`). `fetchRdf` wraps a caller-supplied (or
default) `fetch`, sends `text/turtle, application/ld+json;q=0.9` by
default, and returns dataset + ETag + final URL + raw `Response`.

Other workspace packages import from here instead of re-implementing
the same dispatch. Deliberately not `rdf-parse` — Solid only needs
Turtle and JSON-LD in practice (Solid Protocol §5.2).

## Conventions inherited from the master repo

- Continuous review by `roborev` (post-commit hook installed).
- Unsigned commits; no `--no-verify`.
- See [`STANDARDS.md`](./STANDARDS.md).
