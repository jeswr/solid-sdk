# solid-sdk

The **@jeswr Solid SDK monorepo** — reusable TypeScript packages for Solid apps and agents,
consolidated from ~42 per-package repos into one pnpm workspace.

**Status: Phase 1 (pilot).** Three pilot packages are imported with full git history —
`solid-dpop` (leaf), `solid-openid-client` (esbuild-inlines solid-dpop, `workspace:*`),
`solid-bookmark` (external npm dep `@jeswr/fetch-rdf`) — chosen to prove the three hard
migration cases. Mirror publishing (`--execute`) has not run yet. The full design,
inventory, and phased migration plan live in
[`decisions/0001-monorepo-architecture.md`](decisions/0001-monorepo-architecture.md).

## Why a monorepo

Every package previously carried its own repo checklist (review hook, lint/typecheck/test
gate, `ignore-scripts` supply-chain posture, lockfile, committed `dist/`). Cross-package
changes were O(N) commits + O(N) sha-repins. Here the conventions are applied **once**:

- **pnpm workspaces** (`packages/*`, `tools/*`) — one content-addressed store, one lockfile;
  internal deps are `workspace:*`, ending intra-suite `github:` sha-pin churn.
- **One gate:** `pnpm run gate` = Biome lint + lockfile-transport guard + `tsc` typecheck +
  vitest + build, fanned across the workspace via `pnpm -r`.
- **`ignore-scripts=true`** (`.npmrc`): no dependency lifecycle script ever runs. Before
  adding any dependency: `pnpm run check:packages <name>`.
- **`dist/` is NOT committed here** — it is built fresh and published to mirrors.

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

Run `node scripts/mirror-publish.mjs <pkg>` for a dry-run plan; `--execute` publishes
(Phase 1+ only). The script is fail-closed: clean tree, scoped gate pass, deterministic
rebuild byte-compare, and a publicly-resolvable monorepo sha are all preconditions.

## Working here

See [`AGENTS.md`](AGENTS.md) for the repo charter (conventions, merge rules, provenance).
Package imports happen per the phased plan in `decisions/0001` — history-preserving
`git filter-repo` grafts, dependency-leaves first.
