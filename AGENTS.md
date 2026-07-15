<!-- AUTHORED-BY Claude Fable 5 -->

# AGENTS.md — solid-sdk

> A README for coding agents. `CLAUDE.md` is a symlink to this file. This charter inherits
> the suite-wide conventions (see `prod-solid-server/AGENTS.md` for the canonical set:
> namespace rule, RDF discipline, provenance trailers, roborev review flow, tracker rules)
> and adds only what is specific to this monorepo.

## What this is

The **@jeswr Solid suite workspace**: the single home for the suite's reusable TypeScript
packages and deployable applications. Publishable libraries live in `packages/`; private
deployables live in `apps/` and consume the SDK through workspace dependencies. The package
design + inventory + phasing lives in:
[`decisions/0001-monorepo-architecture.md`](decisions/0001-monorepo-architecture.md)
(imported from `prod-solid-server/decisions/0022`, the ADR of record).

**Current state:** 40 SDK packages and 13 applications are imported with full history. The
applications comprise the eight `pod-*` apps plus Access Manager, Pod Manager, Issues, App Store,
and Coeliac. Mirror publishing has NOT run yet. Do not import further packages outside the phased
package plan.

## The model in four rules

1. **pnpm suite workspace.** `packages/*` contains publishable libraries; `apps/*` contains
   canonical private applications; nested Vite deployables remain in `apps/*/web`; tooling lives
   in `tools/*`. App names are `@jeswr/app-<slug>` except App Store (`@jeswr/app-store`). Internal
   deps are `workspace:*` — never `github:` pins between workspace members. One lockfile
   (`pnpm-lock.yaml`); workspace guards reject app-local locks, non-private apps, naming drift,
   non-workspace SDK edges, and `git+ssh://` lockfile entries.
2. **`dist/` is never committed here.** It is gitignored and built fresh. The committed-dist
   convention lives in the **mirrors** (rule 3). Biome, Vitest, and Turbo come from the root.
3. **Mirror publishing keeps every `github:jeswr/<pkg>#<sha>` pin working.**
   `scripts/mirror-publish.mjs <pkg>` builds the package (and its workspace deps) and
   publishes { rewritten `package.json`, `dist/`, README (with the read-only banner),
   LICENSE, plus any other literal `files`-array artifact (e.g. solid-bookmark's
   subpath-exported TTL) } to the package's ORIGINAL `jeswr/<pkg>` repo (`Mirror-Of:`
   trailer). Dry-run is the default; `--execute` pushes. Mirrors are **never hand-edited**;
   publishing runs in topological order (`--dep-sha` pins for non-inlined workspace deps;
   an esbuild-inlined dep may be declared in `mirrorPublish.inlined` and dropped from the
   mirror manifest — but ONLY when the emitted `.d.ts` is also self-contained. A package
   whose declarations import the dep's types keeps it NON-inlined and pins it via
   `--dep-sha`, even if the JS is bundled: solid-openid-client's declarations import
   solid-dpop types, so its mirror keeps a pinned `@jeswr/solid-dpop` dep exactly as the
   standalone repo always declared it — roborev finding on 6c3e609). Old consumer pins
   resolve forever. Mirror and future npm publishing are packages-only; apps are private and
   never published. npm publish (changesets, independent versions) is deferred (`needs:user`).
4. **One Turbo gate:** `pnpm run gate` runs lint, dependency-first build, typecheck, and test for
   packages affected relative to `main` plus their dependents, with local caching. Use
   `pnpm run gate:full` at session close and before mirror publishing. Build precedes typecheck/test
   because dist is not committed and workspace `.d.ts` resolution needs built output. roborev
   reviews every commit (`.roborev.toml`: codex / gpt-5.6-sol, min severity low); read verdicts
   and address findings.

<!-- AUTHORED-BY Codex GPT-5 -->
## Local agent skills

Treat this repository as a local skill catalog in addition to any globally installed skills:

- Before working on a package, check `packages/<name>/SKILL.md`. When it exists and the task
  touches that package's documented surface, read it completely before acting.
- For cross-cutting work, scan `skills/*/SKILL.md` frontmatter descriptions for a matching
  trigger and read every matching skill completely before acting.
- Package-local skills take precedence for package API details; top-level skills supply shared
  workflows and guidance for suite packages not yet imported here.

This routing is mandatory because colocated skills are intentionally kept beside their code rather
than copied into a global agent configuration. Keep the README's skill-layout note and this routing
rule in sync when the layout changes.

Agent personas for application development live in [`.claude/agents/`](.claude/agents/) —
canonical here, discovered via each skill's `## Agent persona` section. Leads spawn them with
scoped briefs per the runbook in `.claude/agents/solid-app-orchestration.md` (specialists over
disjoint path sets; persona files omit `model:` so specialists inherit the session model).
When the workspace uses beads (`.beads/` exists), follow-up work is filed as beads per the
runbook — never markdown TODOs. Consuming app repos copy the persona files down with a
canonical-source header pointing back here; edit upstream first, then refresh the copies.

## Merge rule (path-disjoint relaxation — proposed in ADR §9.2)

Branches whose diffs touch **disjoint `packages/<name>` / `apps/<slug>` path sets** may merge
without a full inter-merge re-gate: Turbo's affected gate scopes to changed projects + dependents,
so path-disjoint merges retain their coverage. The full-workspace
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
self-reporting (keep both `packages[]` and `applications[]` current as projects import); no
markdown TODOs — work goes in the tracker.
