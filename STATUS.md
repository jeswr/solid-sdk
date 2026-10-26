<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-lurx — CHT-L4 link preview extraction

Implemented the pure TypeScript preview library in `apps/suite/src/apps/chat/lib/preview/`.
It extracts OpenGraph, Twitter, title, description, canonical and icon metadata; resolves URLs
against the supplied page URL; enforces HTTP(S); and chooses a card with documented fallbacks.
The bounded parser rejects malformed/unsupported input with typed, input-redacting errors.
No network, DOM, hooks, React, or new dependencies are involved. The coverage glob is registered.

## Commits

| Commit | Change |
| --- | --- |
| `e64cc695` | Record conservative parser/precedence interpretations in QUESTIONS.md. |
| `791b044d` | Implement extraction, card selection, barrel, documentation and unit coverage. |
| `0812b3d7` | Merge local `origin/main` (`d6a9c8b5c94d5bb8829f355afcd20e30182bab85`) before final gates. |
| `61fec211` | Reject metadata outside a closed HTML document. |
| `01a0c094` | Use equivalent hexadecimal entity fixtures to avoid false colour-guard matches. |
| `d9bec05d` | Reject malformed Unicode page URLs instead of allowing URL() repair. |
| This final documentation commit | Record validation and remaining environment limitations. |

## Validation

All final checks below ran after the local main merge. No network remote was fetched or merged.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter='@jeswr/app-suite^...'
```

PASS: install with lifecycle scripts disabled, then four dependency builds. An initial app
typecheck before these builds could not resolve workspace dist declarations; building resolved it.

```sh
pnpm --filter @jeswr/app-suite exec vitest run test/chat-preview.test.ts --coverage.include='src/apps/chat/lib/preview/**/*.ts'
```

PASS: 116 preview tests, 100% statements, branches, functions and lines throughout the directory.

```sh
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
```

PASS on the final implementation: 73 test files, 4,515 tests; 100% statements, branches, functions
and lines across configured coverage includes. Lint reports 40 existing warnings outside preview;
the preview files and tests have no diagnostics. Production Next.js build and tsc both pass.

```sh
pnpm run lint:root
TURBO_SCM_BASE=9d38e053caf7381de3b97b5d79075647f55d6a05 pnpm run gate
```

PASS: root lint/guards, then 42 successful Turbo tasks (28 cached). An earlier root-lint attempt
flagged decimal numeric entity fixtures as raw colours; the equivalent hex fixtures fixed it.
An earlier affected gate collided with a simultaneous focused coverage run in Vitest's shared
coverage directory; the final gate ran sequentially and passed.

```sh
pnpm run gate:full
```

FAIL outside lane scope: `@jeswr/federation-trust#test`,
`test/characterization.test.ts:196`, “delegation credential structure is stable”. The snapshot
expects delegateKey JSON property order `crv,x,kty`; this environment emits `kty,crv,x`.
53 tests pass and one snapshot fails in that package. Turbo reports 311 successful tasks out of
359 scheduled (34 cached) before stopping. `packages/federation-trust` has no diff from the lane
base and was not changed. Generated callback/client-id files from full-workspace builds were
removed; no unrelated artifacts are committed.

```sh
git diff --check
roborev status
```

PASS: diff whitespace check. Roborev is unavailable (`command not found`, exit 127); no automated
review verdicts could be read. The existing review configuration was left intact.

## Scope, dependencies, screenshots and open points

- No lane dependency additions; `check:packages` was not required. Lockfile/dependency changes
  inherited through the prescribed main merge were not authored by this lane.
- No UI was built, so no fixture routes, Playwright specs or screenshots apply. Playwright was
  not launched.
- QUESTIONS.md records the unspecified limits, HTML subset and fallback order. Conservative
  defaults are implemented and documented; there are no blocking implementation questions.
- Some valid HTML is deliberately rejected rather than repaired. Callers can display a plain
  link when receiving a typed error. See the preview README for the exact supported subset.
- Implementation and acceptance checks are complete. Remaining validation gaps are the unrelated
  full-workspace snapshot failure and unavailable roborev CLI.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — review of f503fd43a9ab

- `781a0f0d` (`fix: preserve literal ampersands and HTML link relations`) fixes both review findings.
  Literal ampersands survive title/text and URL extraction. Semicolonless reference detection
  distinguishes title text from attributes; unsupported and malformed references still reject.
  Link relations decode independently and split only on HTML ASCII whitespace, preserving
  nonbreaking and other Unicode whitespace inside tokens.
- Added 38 regression cases covering literal text/query separators, reference rejection,
  ASCII relation separators and Unicode whitespace in canonical/icon relations. Before the fix,
  15 regression cases failed. After the fix, all 154 preview tests pass with 100% statements,
  branches, functions and lines across the preview directory.
- Changes are confined to the two reviewed parser files, their existing tests and this report.
  No dependency, UI or design changes; no network remote operations or other checkouts used.

Commands use Node 24 (`PATH=/opt/node24/bin:$PATH`), with `XDG_DATA_HOME=/tmp/sst-lurx-data`
and `XDG_CACHE_HOME=/tmp/sst-lurx-cache` to keep package-manager writes inside the sandbox.

```sh
pnpm --filter @jeswr/app-suite exec vitest run test/chat-preview.test.ts --coverage.include='src/apps/chat/lib/preview/**/*.ts'
pnpm exec turbo run build --filter='@jeswr/app-suite^...'
pnpm --filter @jeswr/app-suite run lint
pnpm --filter @jeswr/app-suite run build
pnpm --filter @jeswr/app-suite run typecheck
pnpm run lint:root
```

PASS: focused coverage, all four dependency builds, app lint/build/typecheck and root guards.
App lint reports 40 existing warnings outside preview; the changed files have no diagnostics.

```sh
pnpm --filter @jeswr/app-suite run test
```

Initial run: 4,552 tests pass, one unrelated vCard performance assertion fails at
`apps/suite/test/vcard.test.ts:185` (5,599 ms against a 4,000 ms bound).

```sh
VITEST_MAX_WORKERS=2 pnpm --filter @jeswr/app-suite run test
```

PASS on rerun with fewer workers: all 73 test files and 4,553 tests pass, with 100% statements,
branches, functions and lines across all configured coverage files. No test thresholds or
repository configuration were changed.

```sh
TURBO_SCM_BASE=f503fd43a9ab0731073fe96371dc08d1279bd016 pnpm run gate
```

Initial affected gate fails outside preview: `test/check-sdk-layers.test.mjs:328`,
"validates pathological specs in under 50 ms each", measured 93 ms. Root tests otherwise
pass (744 tests). Turbo's default strict environment filters out `VITEST_MAX_WORKERS`, so
the retry also sets `TURBO_ENV_MODE=loose` to pass the worker limit through to test tasks.

```sh
VITEST_MAX_WORKERS=2 TURBO_ENV_MODE=loose TURBO_SCM_BASE=f503fd43a9ab0731073fe96371dc08d1279bd016 pnpm run gate
```

PASS: all 10 Turbo tasks, including 745 root tests and all 4,553 app tests with 100% coverage.

```sh
VITEST_MAX_WORKERS=2 TURBO_ENV_MODE=loose pnpm run gate:full
```

FAIL outside this fix round: `@jeswr/federation-trust#test`,
`test/characterization.test.ts:196`, "delegation credential structure is stable". This is the
same previously recorded snapshot mismatch: expected delegateKey JSON order `crv,x,kty`,
received `kty,crv,x`. That package has no diff from `f503fd43a9ab`; its other 53 tests pass.
Turbo reports 307 successful tasks out of 360 scheduled (9 cached) before stopping.
The generated callback/client-ID files from the eight pod web builds were removed.

```sh
git diff --check
roborev status
```

PASS: diff whitespace check. Roborev remains unavailable (`command not found`, exit 127),
so no additional automated review verdict could be read. Both supplied findings are fixed;
there is no unfinished implementation or open question. The existing conservative rejection
of unsupported references is retained. No dependencies were added, so `check:packages` was
not required; no UI or screenshots apply. The final report commit records this validation.
