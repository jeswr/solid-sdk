<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.22 lane report

Branch: `lane/sst-8xm.22`. Base: `93afe9d606533fc0b36ab314423d2f0b73e528e6`.

## Commits

- `84212c32` — `fix(solid-auth-core): re-arm origins atomically`: stage and validate
  every requested origin before changing the live boundary; add the optional
  `expectedWebId` guard using `webIdsEqual`; update the interface, TSDoc, README,
  skill, and adversarial session/origin tests.
- `e681df86` — `fix(solid-auth-core): guard remembered account metadata`: reject
  inadmissible WebIDs without writing account storage; export
  `MAX_DISPLAY_NAME_LENGTH = 256` and cap newly written labels by Unicode code
  points; retain and test the existing HTTP(S)-only avatar filter; document the
  fallback-label interpretation in `QUESTIONS.md`.
- Final documentation commit — `docs: record auth hardening lane verification`:
  this report, committed after verification.

## Security properties and proof

- A rejected origin-enrichment call cannot widen the credential boundary at all.
  Mixed-list tests check that a new HTTPS origin remains unauthenticated and the
  existing WebID, issuer, and previously added origins remain authenticated. Cases
  include cleartext HTTP, strict-mode loopback HTTP, JavaScript/data/blob URLs,
  relative URLs, malformed URLs, and empty strings. The blob case shares an origin
  with an otherwise admissible HTTPS URL, proving each input's scheme is checked.
  All-admissible lists, duplicates, URL paths, and development loopback succeed.
- Optional identity binding prevents stale profile enrichment from authorizing
  another account's resources. Tests cover different accounts, paths, fragments,
  malformed/empty expected identities, URL-normalized identity matches, and a
  deferred Alice profile read completing after Bob logs in. Mismatches (including
  empty-origin requests) return false without widening. Existing calls without an
  expected identity and empty options retain their live-session behavior.
- Remembering an account cannot persist JavaScript/data/file/FTP/blob, relative,
  malformed, or disallowed cleartext WebIDs. Tests compare the raw storage before
  and after rejected calls. Loopback HTTP succeeds only under the controller's
  explicit opt-in; remote HTTP and deceptive loopback-like hosts still fail.
- Newly written display labels are bounded to 256 Unicode code points. Tests
  cover 255/256/257/1024-code-point inputs, astral characters at the truncation
  boundary, preserved older names, and long WebID fallback labels with the full
  identifier intact. A package-entrypoint test verifies the exported constant.
- Avatar tests check both returned and persisted records: non-HTTP(S), relative,
  and malformed URLs are dropped; valid HTTP(S) avatars remain admissible and an
  unsafe replacement preserves an existing safe avatar.

The new origin/identity and account-input regressions were observed failing before
their fixes. The final package suite passes **323 tests across 8 files**. Tests use
injected fetch/storage/OAuth fixtures; no real account or production service was
used. No RDF construction or parsing code changed.

## Verification

Commands ran from this checkout with Node **24.22.1** and pnpm **10.4.1**. Each
command below used `PATH=/opt/node24/bin:$PATH`; lifecycle scripts remain disabled.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/solid-auth-core^...' --concurrency=4` | PASS; builds fetch-rdf and solid-session-restore prerequisites |
| `pnpm --filter @jeswr/solid-auth-core run lint` | PASS |
| `pnpm --filter @jeswr/solid-auth-core run build` | PASS; declaration self-containment check included |
| `pnpm --filter @jeswr/solid-auth-core run typecheck` | PASS |
| `pnpm --filter @jeswr/solid-auth-core run test` | PASS; 323/323 tests, 8/8 files |
| `pnpm run lint:root` | PASS |
| `TURBO_SCM_BASE=93afe9d606533fc0b36ab314423d2f0b73e528e6 pnpm run gate` | FAIL in unchanged root guard tests; package tasks pass; 7/8 Turbo tasks successful |
| `pnpm run gate:full` | FAIL in unchanged root tests; 76/260 Turbo tasks successful, 5 cached; stopped after 8m50.769s |
| `pnpm exec vitest run test/check-packages-guard.test.mjs --maxWorkers=1` | Diagnostic FAIL; 2/4 unchanged root guard tests fail even in isolation |
| `git diff --check` | PASS |

The affected gate selected the root and solid-auth-core. Root CLI fixture tests
failed because child-process stdout/stderr were empty; one agent-layer test also
timed out at 5 seconds. A standalone Node `spawnSync` probe that only prints a
fixed stdout/stderr message returned `error.code = EPERM` with both streams empty,
reproducing the sandbox capture restriction independently of repository code.
The lane does not modify root guard scripts/tests or gate configuration.

The full gate selected all 100 workspace projects and also stopped at
`//#test:root`. It reproduced the empty child-process diagnostics and root fixture
timeouts (including Vercel origin-environment validation). Unfinished tasks were
not certified by that run. No app or root implementation was changed to work
around these failures. Logs remain outside the checkout at
`/tmp/sst-8xm.22-gate.log`, `/tmp/sst-8xm.22-gate-full.log`, and
`/tmp/sst-8xm.22-root-diagnostic.log`.

This package has no checked-in API report or API Extractor configuration to
regenerate. Public declarations were rebuilt and checked; `dist/` remains ignored.

## Supply chain and remaining review

- No dependencies, manifests, or lockfile entries changed. `check:packages` was
  not applicable and was not run; no lifecycle scripts were enabled.
- `roborev` is not available on PATH and no per-commit automated verdict could be
  obtained in this environment. Author review found no further in-scope changes.
- This security-critical change requires Jesse's review and merge; it has not been
  pushed, published, opened as a PR, or merged.
- Tracker state was left untouched in this dedicated worktree, in accordance with
  the repository's root-checkout-only beads rule and the lane's checkout scope.
- No implementation work remains. Workspace-wide verification is limited by the
  recorded gate failures; app compatibility is not fully certified by this run.
- No blocking design question remains. The conservative interpretation in
  `QUESTIONS.md` applies the label cap to WebID fallbacks and preserved names on
  rewrite; existing stored records are not migrated on read.
