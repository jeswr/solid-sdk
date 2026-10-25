<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-yrjy — DOC-L2 lane report

Implementation complete on `lane/sst-yrjy`, based on
`ed72921cb1a22d6e10b9488eb8b3246c36155451`.

## Commits

- `e55ff5e6` — `feat(docs): add bounded document version diff`: pure TypeScript
  library and barrel in `apps/suite/src/apps/docs/lib/diff/`, public JSON/change
  types, bounded Myers block alignment and inline text/mark changes, normalization,
  synthetic unit tests, enforced 100% directory coverage, and `QUESTIONS.md`.
- Final `docs: record document diff lane results` commit — this report.

## Behavior and scope

- Inserted/deleted/modified top-level blocks, positional pairing of unmatched runs,
  nested content and structural/attribute snapshots, inline insert/delete ranges,
  and added/removed/attribute-changed marks on surviving text.
- Half-open UTF-16 ProseMirror positions relative to the top-level block start;
  Unicode code points are never split between surrogate halves. Known standard
  image/hardBreak/horizontalRule nodes are atoms; other nodes are containers.
- Fixed per-document limits: 10,000 nodes, 100,000 text code units, 64 JSON levels,
  and 1,000,000 JSON units (values plus string/key lengths). A shared 1,000,000-step
  Myers budget bounds block and inline work and trace growth. Invalid JSON/nodes
  throw TypeError; exceeded limits throw RangeError, with no partial result.
- No React/hooks/network, UI, new dependencies, manifest/lockfile changes, or new
  workspace projects. `suite.json` needs no update. `check:packages`: not applicable.
- Conservative interpretations and spec references are in `QUESTIONS.md`; none
  block this lane. Custom atom schemas remain outside the specified standard nodes.

## Validation

Commands were run inside this checkout before this final report commit.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; prepared workspace declarations before app checks. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on final run; six test files, 150 tests (53 diff tests), 100% statements/branches/functions/lines throughout the diff directory. |
| `pnpm run lint:root` | PASS, including workspace/transport/fetch/token guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=ed72921cb1a22d6e10b9488eb8b3246c36155451 pnpm run gate` | PASS; 7/7 Turbo tasks. |
| `pnpm run gate:full` | FAILED outside lane scope: `@jeswr/unstorage-solid#build`, 33 successful tasks of 172 before termination. Its existing fetch-rdf bootstrap invokes `npm install` and fails with EROFS writing `/home/runner/.npm/_cacache/tmp/`. Inspection also found that bootstrap invokes a network git clone, so it was not retried under the lane's no-network-remotes restriction. |
| `git diff --check` | PASS. |
| `roborev status` | UNAVAILABLE: command not found; no automated verdict obtained. |

The first production build attempt failed transiently in the existing `next/font`
Google loader for Source Code Pro (`Cannot read properties of null (reading '1')`).
Both the affected gate's production build and the subsequent complete direct app
check sequence passed without source changes. An initial standalone typecheck also
ran before suite-ui declarations were built; the final typechecks passed.

Tests cover block insertion/deletion/modification/moves/duplicates, nested lists and
tables, atom/attribute changes, text splitting/default/key/mark normalization,
Unicode and offsets, mark transitions, immutable inputs, malformed JSON, cycles and
all input/work bounds. An exhaustive independent dynamic-programming oracle checks
Myers reconstruction and shortest edit cost for every pair of binary sequences up
to length four. Large similar-text and worst-case dissimilar-text cases are covered.

Screenshots / Playwright / visual mockup comparison: not applicable to this pure
library; no components or rendered states were added, and no browser was launched.

## Unfinished / blocked

No DOC-L2 implementation work remains. Full-workspace validation and automated
roborev review remain unverified for the environmental/tooling reasons above.
No pushes, PRs, branch switches, merges, or edits to other checkouts were performed.
