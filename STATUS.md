<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.31 — T-010 lane report

Fix round 1 completed on `lane/sst-8xm.31`, resuming from `de23003c`.
Original implementation base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Commits

Fix round 1:

- `0c61ebe6` — `fix: bound and tokenize Link header parsing`: replace the backtracking member
  regex with a deterministic tokenizer; skip malformed members; ignore fields over 8 KiB; stop
  after 64 members; add boundary, recovery, quoting, escape, and pathological-input tests.
- `1050b824` — `fix: retain WAC permissions alongside extensions`: parse permission groups
  generically; retain recognised user/public modes while ignoring unknown groups/modes; validate
  syntax before accepting the field; merge repeated groups without duplicate modes; add regressions.
- `docs: record storage parser fix results` — this final STATUS.md update.

Original T-010 implementation:

- `c4d49fb2` — `feat: define storage capability vocabulary and types`: ADR-002 vocabulary and
  public type contracts, including ProbeResult, root type exports, and coverage thresholds.
- `ae2c9249` — `feat: parse capability Link and probe headers`: internal RFC 8288 parsing,
  pure response-header parsing, tests, and package documentation.
- `de23003c` — `docs: record storage capabilities lane results`: original lane report.

## Gate results

All required checks passed before the final report commit. Commands from the workspace root:

```sh
pnpm --filter @jeswr/storage-capabilities run lint
pnpm --filter @jeswr/storage-capabilities run build
pnpm --filter @jeswr/storage-capabilities run typecheck
pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
```

- Package lint, build, and typecheck: passed.
- Tests: 4 files, 84 tests passed (49 Link, 33 probe-header, 2 vocabulary/type-export tests).
  The timing regression parses pathological whitespace, escaped strings, and an unterminated
  target, asserting the combined parsing time is below 50 ms; passed.
- Coverage: 100% statements (152/152), branches (100/100), functions (12/12), lines (124/124).
  All four 100% thresholds remain enforced by the package's Vitest configuration.
- Root lint: passed, including lockfile transport, application workspace, and raw-fetch guards.
- Scoped Turbo build/typecheck/test: 3 successful tasks; the current graph selects only
  storage-capabilities. No whole-workspace gate was run, per the lane brief.
- Test-source TypeScript check: passed, run from `packages/storage-capabilities`:

```sh
pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM,DOM.Iterable src/*.test.ts
```

`git diff --check` passed. Generated dist and coverage outputs remain ignored.

## Scope and conservative choices

- The 8 KiB bound counts UTF-8 bytes per header value; oversized fields contribute no links,
  while other fields still parse. A cheap string-length check rejects arbitrarily large values
  before encoding. The 64-member limit is shared across all supplied fields, counts malformed
  members too, and excludes empty list members.
- Recovery uses only unquoted commas outside URI brackets. An unterminated quote or target
  consumes the remaining field because subsequent commas cannot be identified as separators;
  separate fields still parse. Targets and anchor contexts retain their original semantics.
- WAC-Allow ignores extensions individually, following
  [WAC §6.1 error handling](https://solidproject.org/TR/wac#wac-allow).
  Syntactically invalid unknown groups/modes still invalidate the complete field. Repeated
  recognised groups combine only the modes explicitly advertised, preserving their order.
- No dependencies added; `check:packages` was not needed. Manifests and lockfile are unchanged.
- Network probing, discovery/resolution, feature derivation, caches, and fixtures remain outside
  this fix round and belong to subsequent tasks.

## Unfinished work, blockers, and open questions

- Both supplied review findings are addressed; no unfinished implementation or open questions
  within this brief.
- Automated commit review could not run: `command -v roborev` found no executable in the
  sandbox. The dispatcher must run the mandated review before merge.
- No tracker mutation was attempted; lane claim/merge/close tracking remains with the dispatcher.
- No push, PR, branch switch, remote fetch/merge, dependency installation, or deployment occurred.
