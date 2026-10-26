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

## Fix round 1 — 2026-10-26

Starting head: `fb1a57c24f102d59fecc8f6c49084ea4fea671b1` on `lane/sst-age2`.
Both findings from the supplied Codex review are addressed:

- `3a9cf6af` — `fix: validate ACP management permissions`: validate ACR grants
  independently of resource rows. Conservatively reject nonempty management-only,
  partial and anonymous ACR permissions in both projection and diff planning. Full
  named resource/ACR Read+Write remains an immutable owner, including split grants;
  empty management policies confer no access. Update the sharing-core documentation.
- `3a6d008d` — `fix: ignore empty inherited sharing grants`: only inherited grants
  with modes block changes. Regression tests cover explicit Viewer creation and
  revocation alongside empty ancestor policies for named and anonymous principals.
  Both new cases failed before the fix and passed afterwards; existing nonempty
  inherited-grant immutability tests still pass.
- Closing commit — `docs: record sst-age2 fix verification` (this section).

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; prepare existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 106 tests, including 105 sharing tests. Sharing coverage: 100% statements (215/215), branches (205/205), functions (45/45) and lines (178/178). |
| `pnpm run lint:root` | PASS; all workspace, lockfile, fetch, token and contrast guards. |
| `TURBO_SCM_BASE=fb1a57c24f102d59fecc8f6c49084ea4fea671b1 pnpm run gate` | PASS; 6/6 tasks, none cached. |
| `PATH="/tmp/sst-age2-gate-bin:$PATH" pnpm run gate:full` | BLOCKED in unchanged `@jeswr/unstorage-solid#build` after 23 successful tasks. A temporary Git wrapper blocked its attempted remote `git clone https://github.com/jeswr/fetch-rdf.git`, honoring the lane restrictions; no remote Git operation ran. |
| `git diff --check` | PASS. |

No dependencies added. No UI, screenshots, tracker updates or changes outside this
checkout. No new open questions or unfinished implementation. Full-workspace
verification remains blocked as above; `roborev` is still unavailable, so automated
per-commit reviews could not run. No push, PR, branch switch, fetch or merge performed.

## Fix round 2 — 2026-10-26

Starting head: `f0a05e47d24c02a75adb36a701273fc70cc2c6ca` on `lane/sst-age2`.
The supplied review finding is addressed:

- `13baaaa0` — `fix: preserve comments access on editor promotions`: Editor and
  Owner selections only plan file and management permission changes, preserving
  existing comments permissions. Only Commenter requests comments Append.
  WAC/ACP regression tests cover Viewer promotions without a comments destination,
  preservation of empty, Read, Append, Read+Write and Read+Write+Append comments
  grants, and the continued destination requirement for Commenter.
- Closing commit — `docs: record sst-age2 round two verification` (this section).

The new regressions produced eight failures before the fix and all passed afterwards.
No dependencies or unrelated implementation changes were added.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; prepare existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS after formatting the new tests; 120 tests, including 119 sharing tests. Sharing coverage: 100% statements (215/215), branches (206/206), functions (45/45) and lines (178/178). |
| `pnpm run lint:root` | PASS; workspace, lockfile, fetch, token and contrast guards. |
| `TURBO_SCM_BASE=f0a05e47d24c02a75adb36a701273fc70cc2c6ca pnpm run gate` | PASS; 6/6 tasks, none cached. |
| `PATH="/tmp/sst-age2-gate-bin:$PATH" pnpm run gate:full` | BLOCKED in unchanged `@jeswr/unstorage-solid#build` after 4 successful tasks (1 cached). The existing temporary Git wrapper blocked its attempted remote clone, honoring the lane restrictions; no remote Git operation ran. |
| `git diff --check` | PASS. |

Implementation is complete with no new open questions. Full-workspace verification
remains blocked as above. `roborev` is unavailable, so per-commit automated reviews
could not run. No UI, screenshots, tracker updates, push, PR, branch switch, fetch
or merge was performed.
