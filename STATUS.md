<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-6sex — MCP-10 lane report

Implementation complete on `lane/sst-6sex`, based on
`9d38e053caf7381de3b97b5d79075647f55d6a05`. No push, PR, merge, publish, or other-checkout changes.

## Commits

- `bb4b792d` — `feat(mcp-oauth): add encrypted session vault stores`:
  AES-256-GCM with record identity/version authentication, memory/file/Upstash REST ciphertext
  stores, atomic CAS, irreversible deletion, and tamper/wrong-key/store-failure tests.
- `96347d8f` — `feat(mcp-oauth): broker pod login and cascade revocation`:
  Client ID Document public-client login through solid-openid-client/solid-dpop, PKCE/state/nonce,
  profile issuer verification, per-session DPoP keys, encrypted refresh persistence/restoration,
  storage-scoped authenticated fetch, nonce retries, MCP grant/session revocation integration,
  offline issuer/security tests, README/SKILL guidance, and conservative readings in QUESTIONS.md.
  Also selects KV as the default vault backend and fsyncs the file store directory after rename.
- This report is the final `docs: record MCP-10 lane results` commit.

## Validation

Node `v24.22.1`, pnpm `10.4.1`. All broker/vault tests use offline mocks, temporary local files,
and fixture credentials. No real account or production API is used by these tests.

```sh
pnpm --filter @jeswr/mcp-oauth run lint && pnpm --filter @jeswr/mcp-oauth run build && pnpm --filter @jeswr/mcp-oauth run typecheck && pnpm --filter @jeswr/mcp-oauth run test
```

PASS: 222 tests in seven files; 100% statements, branches, functions, and lines. Coverage
thresholds remain 100%. Includes issuer substitution, callback state/nonce/replay, token and
resource DPoP nonce retry, PKCE/code/key binding, refresh rotation with the original private key,
concurrent refresh/revocation, vault corruption/wrong key, and MCP response/token isolation.

```sh
pnpm run lint:root
TURBO_SCM_BASE=9d38e053caf7381de3b97b5d79075647f55d6a05 pnpm run gate
```

PASS: root lint and the affected gate. The implementation run completed 46 tasks; the final
run after removing generated app artifacts completed all ten affected tasks, including the
root suite's 745 tests (seven tasks restored from cache).

```sh
pnpm run gate:full
pnpm --filter @jeswr/federation-trust run test
git diff 9d38e053caf7381de3b97b5d79075647f55d6a05 -- packages/federation-trust
```

Full gate FAILS in the unchanged `@jeswr/federation-trust` package:
`test/characterization.test.ts:196`, “delegation credential structure is stable”. The inline
snapshot expects the serialized JWK keys in `crv,x,kty` order and receives `kty,crv,x` order.
The isolated package command reproduces the same failure (53 pass, one fail); its diff against
the lane base is empty. The final full-gate rerun after the implementation commit fails at the
same test. Unrelated source/snapshots were left unchanged. Generated untracked app callback and
Client ID files from the workspace build were removed; no dist output is committed.

```sh
pnpm install --offline --ignore-scripts
pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
git diff --check
```

PASS: lockfile installation and frozen validation; whitespace check. Existing peer-dependency
warnings remain. Lifecycle scripts stay disabled. Every added dependency version already existed
in the lockfile; changes are confined to the mcp-oauth importer.

## Package policy

Run before adding dependencies:

```sh
pnpm run check:packages openid-client --mode policy
pnpm run check:packages @jeswr/solid-dpop @jeswr/solid-openid-client @jeswr/fetch-rdf @rdfjs/wrapper --mode policy
pnpm run check:packages openid-client @rdfjs/wrapper n3
pnpm run check:packages @types/n3
```

PASS: all policy checks and full registry existence/age checks. Workspace dependencies use
`workspace:*`; no KV SDK was added. Registry requests were dependency-policy checks, separate
from the offline test suite.

## Remaining limitations and questions

Implementation acceptance criteria are covered. The workspace-wide gate remains blocked by the
reproduced federation-trust snapshot failure. `roborev` is not installed in this environment,
so mandated automated per-commit review and its security verdicts could not be obtained.
No tools were installed and no review approval is implied by the passing package gate.

No tracker database exists in this checkout. Tracker operations in another checkout or worktree
are outside the lane's authorization, so the assigned bead and unrelated gate failure were not
mutated in the tracker.

QUESTIONS.md records the nonblocking conservative readings of DESIGN §3/§5: session-wide
revocation through durable liveness checks, issuer-to-WebID fallback only on discovery HTTP 404,
local credential destruction without requiring an issuer revocation endpoint, and fail-closed
refresh/crash handling. A claimed refresh interrupted by process failure requires new login;
stale file lock cleanup requires the store to be offline. MCP-11 owns HTTP/browser composition
and serving the Client ID Document; MCP-15 owns the later pod-auth migration.

## Fix round 2 — review of `2a97ab38bde4`

Both requested findings are fixed on `lane/sst-6sex`; this round starts at
`2a97ab38bde485b8c5afe4779c56ae1e967d33c2`.

- `d42ac762` — `fix(mcp-oauth): persist session revocation intent`: persist irreversible
  session tombstones before grant-local revocation and broker cleanup. All bound grants check
  the intent; already-revoked grants retry cleanup. Tests cover vault outages on explicit revoke,
  code replay and refresh reuse, server reconstruction with shared stores, sibling access/refresh
  tokens and pending codes, denied new authorization, unrelated sessions, and cleanup recovery.
  Custom `GrantStore` implementations must implement durable, idempotent `revokeSession` and
  shared `isSessionRevoked` reads, as documented in the package README.
- `a344516e` — `fix(mcp-oauth): send validated request snapshots`: construct the effective
  Request before asynchronous operations, validate its URL and headers, and send that same
  snapshot. Tests mutate URLs, headers, Request inputs and options during liveness checks and
  refresh, including DPoP nonce retries.
- The final `docs: record second review fix results` commit records this validation.

All commands below use Node `v24.22.1` with `/opt/node24/bin` prepended to PATH and pnpm `10.4.1`.

```sh
pnpm exec turbo run build --filter=@jeswr/mcp-oauth
pnpm --filter @jeswr/mcp-oauth run lint && pnpm --filter @jeswr/mcp-oauth run build && pnpm --filter @jeswr/mcp-oauth run typecheck && pnpm --filter @jeswr/mcp-oauth run test
pnpm run lint:root
TURBO_SCM_BASE=2a97ab38bde485b8c5afe4779c56ae1e967d33c2 pnpm run gate
git diff --check
```

PASS: dependency-first build, package gate (238 tests; 100% statements, branches, functions and
lines), root lint, affected gate and whitespace checks. Regression tests first reproduced both
findings against the previous implementation. All new tests use offline issuer fixtures.
The final affected gate after artifact cleanup passed all ten tasks (seven cached), including
all 745 root tests, before the report commit.

```sh
pnpm run gate:full
pnpm exec turbo run test:root
pnpm run gate:full
pnpm --filter @jeswr/federation-trust run test
git diff 2a97ab38bde485b8c5afe4779c56ae1e967d33c2 -- packages/federation-trust scripts test package.json vitest.config.ts
```

The first full gate stopped on the unchanged root timing assertion at
`test/check-sdk-layers.test.mjs:328` (95.48 ms against a 50 ms limit). The isolated root run
passed all 745 tests; the full retry restored that passing result from cache. The full retry
then failed at the previously recorded federation-trust snapshot mismatch:
`test/characterization.test.ts:196` expects serialized JWK keys in `crv,x,kty` order and receives
`kty,crv,x`. The isolated package command reproduced it (53 pass, one fail). The comparison
against this round's base is empty for both failing test surfaces. The full retry completed
296 of 350 tasks, including 67 restored from cache. No unrelated source or snapshot was changed.

Generated callback/Client ID files from the eight pod app builds were removed. No dependency
was added, so no package-policy check or lockfile change was needed. No push, PR, branch switch,
merge, publication, tracker mutation, or other-checkout write occurred. `roborev` remains
unavailable; automated per-commit review could not be run. The requested implementation is
complete, the full gate remains blocked by the unrelated snapshot failure, and this round
introduces no open questions.

## Fix round 3 — review of `470e21a2c692`

The single requested finding is fixed on `lane/sst-6sex`, starting from
`470e21a2c692ae87252bb29953fded214e8ef380`.

- `1266ce01` — `fix(mcp-oauth): validate issuers only during discovery`: limit the adapter's
  issuer validation to client construction, when discovery occurs. Subsequent authenticated
  resource fetches return their responses without interpreting discovery-shaped pathnames.
  Regression tests cover Turtle, JSON without an issuer, and JSON with an unrelated issuer,
  through both cached clients and restored sessions that refresh. The existing discovery
  substitution test now checks the adapter's issuer-mismatch error explicitly.
- The final `docs: record third review fix results` commit records this validation.

All commands ran with `/opt/node24/bin` prepended to PATH: Node `v24.22.1`, pnpm `10.4.1`.

```sh
pnpm exec turbo run build --filter=@jeswr/mcp-oauth
pnpm --filter @jeswr/mcp-oauth exec vitest run src/pod-sessions.test.ts --coverage.enabled=false -t 'pod resources with a discovery pathname|checks discovery equality'
pnpm --filter @jeswr/mcp-oauth run lint && pnpm --filter @jeswr/mcp-oauth run build && pnpm --filter @jeswr/mcp-oauth run typecheck && pnpm --filter @jeswr/mcp-oauth run test
pnpm run lint:root
TURBO_SCM_BASE=470e21a2c692ae87252bb29953fded214e8ef380 pnpm run gate
git diff --check
```

PASS: dependency-first build, all four focused cases, package gate (241 tests in seven files;
100% statements, branches, functions and lines), root lint, affected gate (nine tasks, four
cached), and whitespace checks. The three new resource cases reproduced the reported JSON
parse/issuer errors before the fix. All tests use offline issuer fixtures; no dependency was
added, so no package-policy check or lockfile change was needed.

```sh
pnpm run gate:full
pnpm exec turbo run test:root
pnpm run gate:full
pnpm --filter @jeswr/federation-trust run test
git diff 470e21a2c692ae87252bb29953fded214e8ef380 -- packages/federation-trust test scripts package.json vitest.config.ts
```

The first full gate stopped on a five-second timeout in the unchanged root test at
`test/agent-layers.test.mjs:509` (the `require.resolve(TARGET)` disallowed-path-character case;
744 tests passed). The isolated root suite passed all 745 tests. The full retry reused that
passing result, then failed at the previously recorded federation-trust snapshot mismatch at
`test/characterization.test.ts:196`: serialized JWK keys are expected in `crv,x,kty` order and
received in `kty,crv,x` order. The isolated federation-trust test reproduced it (53 pass, one
fail). The full retry completed 295 of 350 tasks, with 56 cached. The comparison against this
round's base is empty for both failing surfaces; no unrelated source or snapshot was changed.

Removed the 16 generated callback/Client ID files from the eight pod app builds. No dist output
is committed. `roborev` remains unavailable, so automated per-commit review could not run.
No push, PR, branch switch, merge, publication, tracker mutation, or other-checkout write
occurred. The requested fix is complete; the full workspace gate remains blocked by the
unrelated snapshot failure. This round introduces no open questions.

## Fix round 4 — review of `c17534d6b760`

The single requested discovery cancellation finding is fixed on `lane/sst-6sex`, starting from
`c17534d6b760118cdaa98e4e6f935f8118c0cd60`.

- `dd0e077a` — `fix(mcp-oauth): avoid discovery cancellation deadlock`: read and validate the
  original discovery body, then reconstruct the response with its status and headers for the
  OIDC engine. Cancelling an oversized stream no longer waits for an unread cloned branch.
  Regression tests cover login start, callback completion and restored-session refresh with
  oversized streams that remain open, plus valid streamed metadata at the 64 KiB limit.
- The final `docs: record fourth review fix results` commit records this validation.

All commands ran with `/opt/node24/bin` prepended to PATH: Node `v24.22.1`, pnpm `10.4.1`.

```sh
pnpm exec turbo run build --filter=@jeswr/mcp-oauth
pnpm --filter @jeswr/mcp-oauth exec vitest run src/pod-sessions.test.ts --coverage.enabled=false -t 'streaming engine discovery|streamed discovery at the size limit'
pnpm --filter @jeswr/mcp-oauth run lint && pnpm --filter @jeswr/mcp-oauth run build && pnpm --filter @jeswr/mcp-oauth run typecheck && pnpm --filter @jeswr/mcp-oauth run test
pnpm run lint:root
TURBO_SCM_BASE=c17534d6b760118cdaa98e4e6f935f8118c0cd60 pnpm run gate
git diff --check
```

PASS: dependency-first build, all four focused cases, package gate (245 tests in seven files;
100% statements, branches, functions and lines), root lint, affected gate (nine tasks, four
cached) and whitespace checks. Before the fix, all three oversized streaming cases reproduced
the deadlock by timing out. The tests use only offline issuer fixtures. No dependency was
added, so no package-policy check or lockfile change was needed.

```sh
pnpm run gate:full
pnpm exec turbo run test:root
pnpm run gate:full
pnpm --filter @jeswr/federation-trust run test
git diff c17534d6b760118cdaa98e4e6f935f8118c0cd60 -- packages/federation-trust test scripts package.json vitest.config.ts
```

The first full gate stopped on the unchanged root timing assertion at
`test/check-sdk-layers.test.mjs:328` (70.39 ms against a 50 ms limit; 744 tests passed).
The isolated root suite passed all 745 tests. The full retry reused that passing result,
then failed at the previously recorded federation-trust snapshot mismatch at
`test/characterization.test.ts:196`: serialized JWK keys are expected in `crv,x,kty` order and
received in `kty,crv,x` order. The isolated federation-trust test reproduced it (53 pass, one
fail). The full retry completed 340 of 376 tasks, with 44 cached. The comparison against this
round's base is empty for both failing surfaces; no unrelated source or snapshot was changed.

Removed the 16 generated callback/Client ID files from the eight pod app builds. No dist output
is committed. `roborev` remains unavailable, so automated per-commit review could not run.
No push, PR, branch switch, merge, publication, tracker mutation, or other-checkout write
occurred. The requested fix is complete; the full workspace gate remains blocked by the
unrelated snapshot failure. This round introduces no open questions.
