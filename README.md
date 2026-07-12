# solid-sdk

The **@jeswr Solid suite workspace** — reusable TypeScript SDK packages plus the private
applications that consume them, consolidated into one pnpm + Turborepo workspace.

Forty publishable packages and thirteen private applications are imported with full git history.
Libraries live in `packages/`; deployables live in `apps/` and use `workspace:*` for every SDK
dependency that exists here. Mirror publishing (`--execute`) has not run yet. The package design,
inventory, and phased migration plan live in
[`decisions/0001-monorepo-architecture.md`](decisions/0001-monorepo-architecture.md).

## Why a monorepo

Every project previously carried its own repo checklist (review hook, lint/typecheck/test
gate, `ignore-scripts` supply-chain posture, lockfile, committed `dist/`). Cross-package
changes were O(N) commits + O(N) sha-repins. Here the conventions are applied **once**:

- **pnpm workspaces** (`packages/*`, `apps/*`, nested `apps/*/web`, `tools/*`) — one
  content-addressed store and one lockfile; internal deps are `workspace:*`.
- **One cached gate:** `pnpm run gate` uses Turbo's affected package graph; dependency builds run
  first, then typechecks and tests. `pnpm run gate:full` verifies every project.
- **`ignore-scripts=true`** (`.npmrc`): no dependency lifecycle script ever runs. Before
  adding any dependency: `pnpm run check:packages <name>`.
- **`dist/` is NOT committed here** — package output is built fresh and published to mirrors;
  app output is deployable but never published as a package.

## How `github:` installs keep working — mirrors

Consumers install `github:jeswr/<pkg>#<sha>` under `ignore-scripts=true`, which needs a
committed `dist/` in a repo named `jeswr/<pkg>`. npm cannot install a subdirectory of a git
repo, so the monorepo itself can never be the install target. Instead:

- Each package's **original repo becomes a read-only mirror**, published by
  [`scripts/mirror-publish.mjs`](scripts/mirror-publish.mjs): built `dist/` + rewritten
  `package.json` + README + LICENSE (+ any other literal `files`-array artifact, e.g.
  solid-bookmark's subpath-exported TTL), committed with a
  `Mirror-Of: jeswr/solid-sdk@<sha>` trailer.
- **Existing pins never break**: old shas resolve forever (mirror repos are never deleted),
  new shas appear only via mirror publishes. There is no flag-day; consumers repoint on
  their normal cadence.
- npm publishing (changesets, independent versions) is the deferred end-state; mirrors are
  the bridge until the npm org login exists.

Run `node scripts/mirror-publish.mjs <pkg>` for a dry-run plan; `--execute` publishes.
The script accepts only `packages/<pkg>`, rejects private packages, and is fail-closed: clean tree,
full gate pass, deterministic
rebuild byte-compare, and a publicly-resolvable monorepo sha are all preconditions.

## Working here

See [`AGENTS.md`](AGENTS.md) for the repo charter (conventions, merge rules, provenance).
Package imports happen per the phased plan in `decisions/0001`; application histories are grafted
under `apps/<slug>` and remain private deployables.

<!-- AUTHORED-BY Codex GPT-5 -->
## Agent skills

Reusable agent guidance lives with the code it describes:

- A skill for a workspace package is [`packages/<package>/SKILL.md`](packages/solid-dpop/SKILL.md).
  Keeping it beside the implementation makes API and security guidance reviewable in the same
  change as the package.
- Cross-cutting guidance is in [`skills/<skill>/SKILL.md`](skills/solid-server-matrix/SKILL.md).
  This also temporarily holds guidance for external suite packages that have not yet been imported
  into this workspace (`@jeswr/fetch-rdf`, `@solid/object`, notifications, and Client Identifier
  Documents). Move such a skill beside its package when that package joins the monorepo.

Every skill has trigger-oriented YAML frontmatter and a concise body. Update the relevant skill when
a package's public API, security boundary, or recommended workflow changes; avoid copying package
guidance back into a central catch-all document.
