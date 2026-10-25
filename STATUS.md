<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-age2 — DRV-L1 lane report

Branch: `lane/sst-age2`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

## Commits

- `3ad81ce5` — `docs: record sharing model interpretations`: numbered specification
  ambiguities and conservative readings in `QUESTIONS.md`.
- `ef5dcad4` — `feat: add pure Drive sharing model and diffs`: typed WAC/ACP dataset
  projection, sorted/deduplicated people and roles, explicit/inherited provenance,
  anonymous link/public summary, scoped minimal semantic authorization changes,
  synthetic fixtures, tests, coverage gate, approved RDF/test dependencies and lockfile.
- Closing commit — `docs: record sst-age2 lane results` (this file).

## Implementation

Everything executable is under `apps/suite/src/apps/drive/lib/sharing/`, with an
`index.ts` barrel. `readSharing` and `diffSharing` are pure: no React, hooks, fetching,
serialization, persistence or mutation of caller datasets. Read/write fixture construction
uses `@solid/object` and `@rdfjs/wrapper`; no hand-built RDF triples.

WAC uses exact resource targets and nearest effective ACL defaults. ACP handles own and
ancestor member policies, positive allOf/anyOf matcher composition, multiple resource
scopes, and policy management through Read+Write on the ACR. Split grants are combined
without combining agents across independent policies. Commenter uses a separately supplied
comments context; comment changes preserve independent Read/Write/Control permissions.
Conditions and partial permissions that cannot be represented throw `SharingError`.

The returned changes are semantic mode additions/removals per principal/resource/source,
not whole-document rewrites. The future SDK persistence adapter must split shared nodes,
retain unrelated scopes/defaults/metadata and enforce conditional writes. Existing owner
and inherited rows are immutable. No UI or SDK façade integration is part of this lane.

## Verification

Commands run from this checkout unless a pnpm filter changes the script directory:

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds existing dependency declarations/CSS before checking the app. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on final implementation; 71 tests total, including 70 sharing tests. |
| `pnpm run lint:root` | PASS, including workspace/lockfile/fetch/token guards and all 74 contrast pairs. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS; 7/7 tasks, 2 cached. |
| `pnpm run gate:full` | BLOCKED in unchanged `@jeswr/unstorage-solid#build`; npm `EROFS` opening `/home/runner/.npm/_cacache/tmp/...` from its dependency build. 14 tasks successful before cancellation. No unrelated code was changed. |
| `git diff --check` | PASS. |

The normal app test command enables V8 coverage and enforces **100% statements, branches,
functions and lines** for `src/apps/drive/lib/sharing/**/*.ts`, including the barrel/types
in the include glob. Final executable coverage: 204/204 statements, 192/192 branches,
42/42 functions, 170/170 lines. Fixtures use only fictional `example.org` identities.

An initial affected-gate invocation overlapped the standalone Next build and failed its
build lock. After the standalone checks finished, the serialized retry above passed.
The full-gate dependency script independently clones fetch-rdf into a temporary directory
before running npm; it was not retried because of the lane's network-remote restriction.
Its temporary directory was removed by the script's cleanup.

## Dependency policy

`pnpm run check:packages @solid/object @rdfjs/wrapper @rdfjs/types n3 @types/n3 @vitest/coverage-v8`
— PASS, all six packages cleared in full npm policy mode before manifest changes.
Versions already in the workspace lockfile were reused: 0.6.0, 0.34.0, 2.0.1, 2.0.3,
1.26.1 and 4.1.10 respectively. Only the suite app importer changed in the lockfile.
`pnpm install --ignore-scripts --offline` initially failed for missing cached package
metadata; `pnpm install --ignore-scripts` succeeded. Lifecycle scripts remain disabled.

## Unfinished / open questions

Implementation and scoped acceptance checks are complete. Full-workspace verification is
blocked as detailed above. `roborev` is not installed in this environment, so per-commit
background reviews/verdicts could not run. The dispatcher retains bead/merge ownership;
no tracker changes were made from this dedicated checkout.

The four numbered questions in `QUESTIONS.md` document conservative interpretations:
permission-summary `owner`, anonymous link/public aliasing, semantic rather than RDF
patch deltas, and a separate comments context. Unsupported richer grants fail explicitly
rather than silently reporting complete access or widening permissions.

Screenshots: none; this is a pure library with no rendered components or states.
Playwright was not launched. No push, PR, branch switch, or merge was performed.
