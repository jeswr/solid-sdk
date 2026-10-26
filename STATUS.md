<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-otem — CON-L2 duplicate detection and merge plans

Implemented on `lane/sst-otem`, based on
`1683635136063eb147125ded9574527220c16bae`. No push, PR, branch switch, merge or
changes to another source checkout. The full gate's pre-existing bootstrap performed
a remote clone as disclosed below; no manual remote fetch/merge was performed.

## Commits

- `6abd67e3` — `feat(contacts): normalise duplicate identity fields`: typed errors;
  email/phone/name normalisers; vendored Unicode 17 default full case-fold data and its
  license; initial unit tests and dedupe coverage glob; conservative questions.
- `572efe7a` — `feat(contacts): plan deterministic duplicate merges`: validated contact
  projection, union-find clustering, deterministic scalar winners and multi-value unions,
  UI conflict alternatives with source IDs, public barrel/types, API documentation and tests.
- Final documentation commit — `docs(contacts): record lane verification`: this report.

## Verification (2026-10-26)

All commands ran inside this checkout. Existing workspace dependencies were already installed;
no dependency or lockfile changes were needed. Initial standalone typechecking exposed missing
`suite-ui/dist` declarations; building the existing dependency resolved that prerequisite.
Development-time validation typing errors were fixed before the successful checks below.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; prerequisite declarations built, ignored output only. |
| `pnpm --filter @jeswr/app-suite exec vitest run contacts-dedupe --coverage.include='src/apps/contacts/lib/dedupe/**/*.ts'` | PASS; 155 tests in 2 files, including a seeded property test over 100 generated identity networks. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint clean, Next production build successful, strict typecheck clean, 22 test files / 869 tests passed. |
| `pnpm run lint:root` | PASS; lockfile/workspace/layer/fetch/token guards green; 74 contrast pairs passed. |
| `TURBO_SCM_BASE=1683635136063eb147125ded9574527220c16bae pnpm run gate` | PASS; 7/7 Turbo tasks successful, including app lint/build/typecheck/test and root tests. |
| `pnpm run gate:full` | FAIL outside lane scope: `@jeswr/unstorage-solid#build`, 11 successful / 126 scheduled tasks before cancellation. Details below. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable: command not found (exit 127); no automated per-commit verdicts available. |

Coverage is enforced at 100% statements, branches, functions and lines **per file** in
`src/apps/contacts/lib/dedupe/**/*.ts`. The focused run measured 178/178 statements,
100/100 branches, 47/47 functions and 148/148 lines. The final app run measured 100%
for all configured source globs. The JSON summary confirms 100% for each dedupe file,
including the barrel and type-only module. Coverage artifacts remain ignored.

Tests cover normalisation boundaries and rejection cases, Unicode folding beyond lowercase,
plus-tag preservation, default calling codes, transitive/cyclic matches, singleton partitioning,
independent graph-reachability comparison, input permutations, deterministic serialization,
field-by-field fallback, all conflict alternatives, union provenance, duplicate-value elimination,
frozen inputs, prototype-like field keys and unsupported input shapes/accessors.

The full-workspace gate invokes `packages/unstorage-solid/scripts/build-deps.mjs`, which
bootstraps missing `@jeswr/fetch-rdf/dist` by cloning its GitHub repository into a temporary
directory and installing/building it. This existing remote-cloning step was not identified
before invoking the mandated gate; it ran before the build failed on npm cache writes:
`EROFS` at `/home/runner/.npm/_cacache/tmp/`. The script's `finally` removes its temporary
clone. The full gate was not rerun, because the lane prohibits network-remote operations.
No bootstrap workaround or unrelated package change was made. Diagnostic logs for this session
are `/tmp/sst-otem-affected-gate.log` and `/tmp/sst-otem-full-gate.log` (not committed).

## Dependencies and visual checks

No third-party package was added, so `check:packages` was not required. Unicode mapping data
is vendored with its source URL and Unicode-3.0 license. No UI was built: no dev fixture route,
Playwright spec, axe state or screenshot applies. Chromium/Playwright was not launched.

## Open questions and remaining limits

Implementation is complete. Full-workspace verification remains blocked by the unrelated
bootstrap/cache failure; roborev review remains unavailable in this environment.

The spec leaves four boundaries open; [QUESTIONS.md](QUESTIONS.md) records the options and the
conservative defaults used: lowest-ID field precedence with an explicit string projection;
no inferred phone trunk/IDD rules; exact validated WebIDs and email/phone-only identity
matching; complete partitions including singletons. Unsupported formats throw `DedupeError`.
No blocking product question remains for this pure-library implementation. Callers must adapt
RDF/structured contact metadata and review proposals before applying changes.
