<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-2ax6 — HM-00 lane report

Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`; branch: `lane/sst-2ax6`.

## Commits

- `0de73012` — `feat: add Home taxonomy and typed RDF model`: nine domains and
  data types, canonical/legacy class tables, predicate disambiguation, primary
  subject selection, forgiving typed readers, parse/serialise helpers and tests.
  Declares the required RDF dependencies and enforces model coverage in Vitest.
- `92b8a054` — `feat: discover Home data and resolve provenance`: public/private
  Type Index readers, injected-fetch discovery merging registrations with suite
  folders, deduplication, sorting, Drive file previews, aggregate profile contact
  details, Other handling, provenance rules and the connector host table. Includes
  partial failures, validators, cancellation, storage scope checks and tests.
- Final commit — `docs: record HM-00 lane results`: this report.

All model code lives in `apps/suite/src/apps/home/lib/model/`, per the model-first
amendment. No React, hooks, suite SDK, shell, routes or UI were added. Existing
Pod Manager modules were ported into a standalone model rather than imported
across private applications. No new package/application was created, so the
`suite.json` inventory remains current.

## Validation

Commands below ran in this checkout before the final report commit.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS. Production build, strict typecheck, lint and 137 tests across 6 files. |
| `pnpm run lint:root` | PASS. Workspace/lock transport/fetch/token guards and all 74 contrast pairs. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS. 9/9 tasks; affected scope is workspace root and `@jeswr/app-suite`, with dependency builds. |
| `pnpm run gate:full` | FAIL outside this lane. `@jeswr/unstorage-solid#build` dependency bootstrap failed during `npm install --no-audit --no-fund --ignore-scripts --prefer-offline`: `EROFS` writing `/home/runner/.npm/_cacache/tmp/`. Turbo reported 27 successful tasks of 82 scheduled before stopping. No unrelated package was changed. |
| `pnpm install --ignore-scripts` | PASS. Lifecycle scripts stayed disabled; only existing-lockfile dependencies were declared for the app. |
| `pnpm install --ignore-scripts --frozen-lockfile` | PASS. Lockfile changes are confined to the app's importer. |
| `git diff --check` | PASS. |

Vitest V8 coverage of **every file in `lib/model`**: statements 281/281, branches
206/206, functions 69/69, lines 244/244 — **100% in all four metrics**, with 100%
thresholds enforced by the normal app test command. Tests cover the independently
transcribed §5.1 class table, legacy aliases, all disambiguation rules, four
provenance rules, public/private index merging, discovery, malformed RDF, partial
failures, unsafe locations, cancellation and bounded traversal. A negative check
(`pnpm --filter @jeswr/app-suite exec vitest run test/fixture-access.test.ts`)
correctly failed at 0% model coverage; the complete suite subsequently passed.

Prerequisite builds used `pnpm --filter @jeswr/suite-ui run build` and
`pnpm --filter @jeswr/rdf-serialize run build`, plus
`PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/suite-vocab run build`
because that package relies on root tooling. No built output is committed.

Screenshots/axe/Playwright: not applicable to this model-only lane. No UI states
or fixture routes were created, and Chromium was not launched.

## Dependency policy

Each exact command below passed in full npm policy/existence/age mode before
manifest changes:

- `pnpm run check:packages @jeswr/fetch-rdf` — PASS.
- `pnpm run check:packages @rdfjs/wrapper` — PASS.
- `pnpm run check:packages @solid/object` — PASS; checked but not added, since
  local `TermWrapper` accessors cover this model's surface.
- `pnpm run check:packages n3` — PASS.
- `pnpm run check:packages @rdfjs/types` — PASS.
- `pnpm run check:packages @types/n3` — PASS.
- `pnpm run check:packages @vitest/coverage-v8` — PASS.

The internal `@jeswr/rdf-serialize` and `@jeswr/suite-vocab` dependencies use
`workspace:*`; registry checks do not apply to local workspace specifications.

## Limitations and open questions

Model implementation and affected validation are complete. Full-workspace
validation remains blocked by the unrelated build bootstrap described above.
`roborev` is not installed in this environment (`command -v roborev` returned no
executable), and no review hook is installed here; automated per-commit verdicts
remain for the dispatcher/integrator.

Conservative readings are recorded in [QUESTIONS.md](QUESTIONS.md):

1. Provenance consumes caller-resolved identity names and the active WebID via an
   optional context; the later hooks supply this metadata without implicit
   third-party requests during classification.
2. Discovery uses a configurable 256-request budget, reports truncation and partial
   failures, and retains ETags for the later SDK cache adapter. Authenticated reads
   stay inside the selected storage; an externally hosted profile may be supplied.
3. Connector collection documents follow the explicit primary-subject rule and
   contribute one item per resource, plus an aggregate contact-details card for a
   qualifying profile. Expanding every collection subject needs spec clarification.

No push, PR, branch switch, merge or mirror publish was performed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — review of c08bee62c4f5

Commit `150fb7dd` — `fix: preserve Home profile and modification metadata`:

- Resolve the exact WebID subject for profile cards, independently of statement
  counts and preferred fragments on unrelated subjects. Test supplied and fetched
  profiles with larger linked email nodes, including an unrelated `#it` subject.
- Merge container modification metadata after resource deduplication, normalizing
  resource fragments and preserving resource-level dates. Test both registration
  orders, date precedence, ordering and one fetch per resource.
- Fall back from valid Dublin Core dates to POSIX modification date-times or epoch
  seconds. Test malformed sibling values, zero/negative/fractional epochs, date
  range overflow and selection of the six most recent Drive files.

Validation ran before the final report commit. Root `node_modules/.bin` was added
to the command PATH for workspace packages relying on root tooling. Missing
ignored dependency output was rebuilt with
`pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4`.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS. Lint, production build, typecheck, 159 tests across 6 files. Model coverage: 100% statements (308/308), branches (233/233), functions (71/71), lines (267/267). |
| `pnpm run lint:root` | PASS. Workspace guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=c08bee62c4f52ecde59372a0f6996345e2e60d40 pnpm run gate` | PASS. 8/8 tasks. |
| `pnpm run gate:full` | FAIL outside this lane: two tests in `tools/federation-codegen/test/generator.test.ts` expect legacy `https://w3id.org/jeswr/` bookmark namespaces and generated ontology output, while the input uses `https://jeswr.org/ns/`. Turbo stopped at `@jeswr/federation-codegen#test` with 182 successful tasks of 252 scheduled. |
| `git diff --check` | PASS. |

All three requested findings are fixed. No dependencies or unrelated source files
were changed. No UI or screenshots apply. No open questions remain for this fix
round; full-workspace validation is blocked by the unrelated tests above.
`roborev` remains unavailable in this environment, so automated review is left to
the dispatcher/integrator. The final documentation commit records this report.

## Fix round 4 — review of d7758b3c472c

The checkout started at `a7f5d90c`, which already addresses finding 1 with a shared
`DiscoveryBudget` for Type Index reads and resource traversal. Its regression
tests pass: many index links respect the request limit, failed reads consume the
shared budget, caller cancellation rejects, deadlines abort pending reads and
remain shared between phases, and late responses report incomplete results.

Commit `4acf780a` — `fix: normalize Home discovery resource URLs` addresses finding
2. Normalize HTTP(S) resource URLs before queue deduplication, ETag indexing,
listing-metadata matching and binary-file item keys. Preserve RDF subject terms
exactly as supplied. Scope checks still inspect the original location so URL
normalization cannot erase encoded-path ambiguity checks.

Regression tests reproduce duplicate RDF cards for hostname casing, default
HTTP/HTTPS ports and fragments, then verify one fetch and one card, retained
listing dates and unchanged RDF subjects. Binary listing aliases also produce
one card without fetching the file. Malformed URLs and encoded path ambiguities
remain rejected.

Validation ran before the final documentation commit. Workspace prerequisites
were rebuilt with `PATH="$PWD/node_modules/.bin:$PATH" pnpm exec turbo run build
--filter='@jeswr/app-suite^...' --concurrency=4` (PASS, 3/3 tasks). Root tooling
was also added to PATH for root lint and both Turbo gates below.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/home-model/discovery.test.ts --coverage.enabled=false` | Before the fix: expected FAIL, reproducing duplicate RDF and binary cards in three cases. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS. Lint, production build, typecheck and 169 tests across 6 files. Model coverage: 100% statements (339/339), branches (264/264), functions (76/76), lines (291/291). |
| `pnpm run lint:root` | PASS. Workspace guards and all 74 contrast pairs. |
| `TURBO_SCM_BASE=c08bee62c4f52ecde59372a0f6996345e2e60d40 pnpm run gate` | PASS. 9/9 tasks. |
| `pnpm run gate:full` | FAIL outside this lane at `@jeswr/federation-codegen#test`: the same two previously recorded failures in `tools/federation-codegen/test/generator.test.ts` (lines 81 and 126). Tests expect legacy `https://w3id.org/jeswr/` bookmark namespaces and generated ontology output; inputs use `https://jeswr.org/ns/`. Turbo completed 193 tasks successfully of 261 scheduled before stopping. |
| `git diff --check` | PASS. |

Both requested findings are addressed. No dependencies were added. No UI or
screenshots apply. Full-workspace validation remains blocked by the unrelated
federation-codegen failures; no open implementation questions remain. Generated
public auth artifacts from the full gate were removed before the final commit.
`roborev` is still unavailable (`command -v roborev` found no executable), so
per-commit automated review remains for the dispatcher/integrator. The final
commit, `docs: record Home fix round four validation`, updates this report last.
