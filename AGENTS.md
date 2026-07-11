<!-- AUTHORED-BY Claude Fable 5 -->

# AGENTS.md — solid-sdk

> A README for coding agents. `CLAUDE.md` is a symlink to this file. This charter inherits
> the suite-wide conventions (see `prod-solid-server/AGENTS.md` for the canonical set:
> namespace rule, RDF discipline, provenance trailers, roborev review flow, tracker rules)
> and adds only what is specific to this monorepo.

## What this is

The **@jeswr Solid SDK monorepo**: the single home for the suite's reusable TypeScript
packages (auth/DPoP clients, UI components, federation, the agentic stack, data models,
storage/sync adapters, bridges, ecosystem integrations). Full design + inventory + phasing:
[`decisions/0001-monorepo-architecture.md`](decisions/0001-monorepo-architecture.md)
(imported from `prod-solid-server/decisions/0022`, the ADR of record).

**Current state: Phase 0 — scaffold only, zero packages imported.** Do not import a package
outside the phased plan (pilot → consumption-proof go/no-go → bulk, leaves first).

## The model in four rules

1. **pnpm workspace.** `packages/*` (flat, one dir per package, dir name = npm name minus
   the `@jeswr/` scope) + `tools/*`. Internal deps are `workspace:*` — never `github:` pins
   between workspace members. One lockfile (`pnpm-lock.yaml`); the `check:lockfile-transport`
   guard (part of `lint`) fails any `git+ssh://` entry.
2. **`dist/` is never committed here.** It is gitignored and built fresh. The committed-dist
   convention lives in the **mirrors** (rule 3). Per-package `tsconfig.json` extends the root
   `tsconfig.base.json`; Biome + vitest come from the root.
3. **Mirror publishing keeps every `github:jeswr/<pkg>#<sha>` pin working.**
   `scripts/mirror-publish.mjs <pkg>` builds the package and publishes { rewritten
   `package.json`, `dist/`, README (with the read-only banner), LICENSE } to the package's
   ORIGINAL `jeswr/<pkg>` repo (`Mirror-Of:` trailer). Dry-run is the default; `--execute`
   pushes. Mirrors are **never hand-edited**; publishing runs in topological order
   (`--dep-sha` pins for non-inlined workspace deps). Old consumer pins resolve forever.
   npm publish (changesets, independent versions) is the deferred end-state (`needs:user`).
4. **One gate:** `pnpm run gate` (lint + typecheck + test + build, `pnpm -r` across the
   workspace). Scope routine runs with `pnpm --filter '...[origin/main]' <cmd>` (changed
   packages + dependents). roborev reviews every commit (`.roborev.toml`: codex /
   gpt-5.6-sol, min severity low); the hook is installed — read verdicts, address findings.

## Merge rule (path-disjoint relaxation — proposed in ADR §9.2)

Branches whose diffs touch **disjoint `packages/<name>` path sets** may merge without a full
inter-merge re-gate: the diff-aware `--filter '...[origin/main]'` gate scopes to changed
packages + dependents, so path-disjoint merges retain their coverage. The full-workspace
gate still runs at session close and **always before any mirror publish**. Branches touching
root config (`tsconfig.base.json`, `biome.json`, `pnpm-workspace.yaml`, `scripts/`,
`guardrails/`) serialize like any shared-file change. Worktree isolation per mutating agent
is unchanged.

## Security-critical packages

Packages carrying `"securityCritical": true` in their `package.json` (auth, token handling,
verifiers, SSRF surfaces) keep the suite's stricter discipline: exhaustive tests, adversarial
review, never auto-merged — the drive/verify-merge security exclusion maps to their
`packages/<name>/**` path globs.

## Supply chain

- `.npmrc`: `ignore-scripts=true` — no dependency lifecycle script ever runs (pnpm 10 also
  requires explicit build allowlisting; we allowlist nothing).
- Before adding ANY dependency: `pnpm run check:packages <name>`
  (`guardrails/scripts/check-packages.mjs`, policy in `guardrails/package-policy.json` —
  ported from prod-solid-server).
- Follow-up (tracked, not yet wired): the gitleaks/pre-commit stack — not trivially portable
  from PSS (python/ruff hooks don't apply here).

## Conventions inherited verbatim from the suite

Namespace (`@jeswr/…`, never `@solid/…`); RDF discipline (`@jeswr/fetch-rdf` parse,
`@solid/object`/`@rdfjs/wrapper` accessors, `n3.Writer` serialise, never hand-built triples);
provenance (commit trailers naming the actual authoring model + `AUTHORED-BY` file markers);
git identity `63333554+jeswr@users.noreply.github.com`; public repo; `suite.json`
self-reporting (this repo self-reports one entry with a `packages[]` array — keep it current
as packages import); no markdown TODOs — work goes in the tracker.
