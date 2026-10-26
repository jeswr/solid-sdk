<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-tsax — MCP-09 lane report

Branch: `lane/sst-tsax`. Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.

## Commits

- `f35dd4df` — `feat: implement MCP OAuth authorization core`: create the missing
  `@jeswr/mcp-oauth` package, suite entry and lockfile importer; implement AS/resource
  metadata, public DCR/CIMD clients, upstream login/consent seams, S256 authorization,
  code/refresh endpoints, ES256 JWT/JWKS, live grant verification and family revocation;
  provide pluggable snapshot/atomic-consume stores and memory/testing implementations.
- `d9ee4d48` — `test: cover MCP OAuth flows and adversarial failures`: fixture-only
  integration, protocol, crypto, metadata, store and concurrency tests; enforce 100%
  statements, branches, functions and lines in the package's normal test command.
- `acc10221` — `fix: reject negative client metadata cache ages`: prevent malformed
  negative Age headers from extending the metadata cache lifetime; add regression coverage.
- `docs: record MCP OAuth lane results` — this final report commit.

All commits carry the requested Co-Authored-By trailer. No push, PR, publish, branch switch,
network Git fetch/merge, other-checkout edit or dependency lifecycle script was performed.

## Validation

Commands ran in this checkout on Node 24.22.1 / pnpm 10.4.1. Final package result:
**139 tests passed; 297/297 branches, 340/340 statements, 47/47 functions and 301/301 lines**.
Coverage includes all package source files, with only test files excluded; there are no
coverage-ignore annotations. Tests also typecheck through `tsconfig.test.json`.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build` | PASS; build the existing workspace dependency before resolving its declarations. |
| `pnpm --filter @jeswr/mcp-oauth run lint` | PASS. |
| `pnpm --filter @jeswr/mcp-oauth run build` | PASS. |
| `pnpm --filter @jeswr/mcp-oauth run typecheck` | PASS; production and fixture/test sources. |
| `pnpm --filter @jeswr/mcp-oauth run test` | PASS; 139 fixture-only tests and all four coverage thresholds at 100%. |
| `pnpm run lint:root` | PASS; formatting and lockfile/app/fetch guards. |
| `env GIT_ALLOW_PROTOCOL=none NODE_OPTIONS=--require=/tmp/sst-tsax-network-guard.cjs TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS; 7/7 tasks, including 26 root tests and the OAuth package checks. |
| `env GIT_ALLOW_PROTOCOL=none NODE_OPTIONS=--require=/tmp/sst-tsax-network-guard.cjs pnpm run gate:full` | FAIL outside this lane: `@jeswr/app-pod-manager#build`; 23 successful tasks before the run stopped. |
| `pnpm install --offline --ignore-scripts` | PASS; no downloads or lifecycle scripts. Preserved unrelated lockfile resolutions. |
| `pnpm install --offline --ignore-scripts --frozen-lockfile` | PASS; lockfile up to date, no downloads or lifecycle scripts. |
| `git diff --check` | PASS. |

The temporary gate guard wraps `net.Socket.prototype.connect`, permitting loopback fixture
servers and IPC while refusing external sockets. `GIT_ALLOW_PROTOCOL=none` prevents build
helpers from fetching remote Git dependencies. It is gate-only tooling in `/tmp`, outside
the shipped package. The full gate's unchanged `apps/pod-manager/src/app/layout.tsx` uses
`next/font`; the build tried to fetch **Inter from Google Fonts**, was refused by this guard,
retried three times and failed. No outbound service connection was allowed, and no unrelated
application change was made to work around this failure.

Gate logs: `/tmp/sst-tsax-gate.log`, `/tmp/sst-tsax-gate-full.log`,
`/tmp/sst-tsax-lint-root.log`, `/tmp/sst-tsax-package-test.log`.

Negative coverage includes plain/missing PKCE, wrong verifier, exact redirect mismatch,
missing/duplicate state and other parameters, code replay, refresh reuse across generations,
concurrent exchange/refresh/revocation, resource/audience/issuer/signature mismatches, expiry
boundaries, denied consent, store failures, metadata SSRF/redirect/size failures, malformed
client documents, cache expiry and family isolation. Metadata tests assert the complete
published RFC fields and well-known path rules. ES256 signatures are independently checked
using the published public JWK. Pod credentials never enter MCP responses or token claims.

## Dependency checks

- `pnpm run check:packages --mode policy @jeswr/guarded-fetch` — PASS (workspace dependency;
  registry existence/age checks do not apply).
- `pnpm run check:packages @biomejs/biome typescript vitest @vitest/coverage-v8 @types/node`
  — PASS, all five packages cleared the full registry policy/existence/age check.
- Only the existing guarded-fetch workspace runtime dependency and existing lockfile versions
  of development tooling were added to the new importer. No new third-party runtime library;
  ES256 uses Node crypto. Policy output: `/tmp/sst-tsax-package-policy.log`.

## Unfinished validation and open questions

- The full workspace gate is incomplete because of the unrelated network-dependent font
  build described above. This lane's package gate, root lint and affected gate are green.
- Automated per-commit review is unavailable: `command -v roborev` found no executable and
  this checkout has no installed post-commit review hook. The repository's
  [review skill](skills/roborev-review/SKILL.md) specifies review of “every commit asynchronously”;
  no automated verdicts can be reported. The security-critical package remains private and
  has not been merged or published. Integrator review remains required.
- MCP-10's actual pod broker/vault and revoke cascade, and MCP-11's consent/login UI, remain
  separate tasks. This lane supplies their typed seams and trusted completion API.
- [QUESTIONS.md](QUESTIONS.md) records the conservative readings: missing MCP-01 scaffold in
  the named base, bounded lifetimes, public-client-only authentication, exact resource/state
  requirements, consent completion, grant-wide revocation and metadata cache limits. No
  blocking implementation question remains; those defaults should be reviewed on integration.

## Fix round 1 — 2026-10-26

Review base: `78f2eb3de02af46c63cc9353e75460b638e204db`. All four supplied findings are
addressed on `lane/sst-tsax`, with changes confined to the OAuth implementation, its tests
and this report.

- `bcca5b56` — `fix: validate scope sets before consuming credentials`: compare scope sets
  before atomic consumption. Equivalent reordered/duplicate scope tokens work; invalid
  scope requests leave codes and refresh tokens usable for retry. Regression tests also
  verify rotation and family revocation when a successfully consumed token is replayed.
- `2b04c835` — `fix: normalize OAuth endpoint routing URLs`: derive routing and endpoint
  URLs from the parsed issuer, retaining the configured issuer identifier in metadata,
  authorization responses and JWTs. Full-flow regressions cover explicit default ports,
  uppercase hosts and trailing slashes.
- `454a0d16` — `fix: redirect OAuth errors with issuer identification`: send authorization
  validation errors to a registered redirect with the exact state and configured issuer;
  advertise `authorization_response_iss_parameter_supported` and include `iss` on denied
  consent in both trusted completion and broker callback flows. Tests cover unsafe client
  identity/redirects, ambiguous parameters, preserved query/state and generic server errors.
- `docs: record MCP OAuth review fixes` — this report commit.

The conservative policy remains set equality for refresh scope: scope narrowing is still
rejected. Duplicate parameters, invalid clients/redirects and absent/empty required state
continue to fail locally before establishing a redirect response context.

Final package result: **165 tests passed; 342/342 statements, 299/299 branches, 50/50
functions and 304/304 lines covered**. No coverage exclusions or thresholds were changed.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build` | PASS; existing workspace dependency. |
| `pnpm --filter @jeswr/mcp-oauth run lint` | PASS. |
| `pnpm --filter @jeswr/mcp-oauth run build` | PASS. |
| `pnpm --filter @jeswr/mcp-oauth run typecheck` | PASS; implementation and tests. |
| `pnpm --filter @jeswr/mcp-oauth run test` | PASS; 165 tests, 100% coverage. |
| `pnpm run lint:root` | PASS. |
| `env GIT_ALLOW_PROTOCOL=none NODE_OPTIONS=--require=/tmp/sst-tsax-network-guard.cjs TURBO_SCM_BASE=78f2eb3de02af46c63cc9353e75460b638e204db pnpm run gate` | PASS; 6/6 tasks. |
| `env GIT_ALLOW_PROTOCOL=none NODE_OPTIONS=--require=/tmp/sst-tsax-network-guard.cjs pnpm run gate:full` | FAIL outside this lane: `@jeswr/app-pod-manager#build`, 26 successful tasks before stopping. Root tests passed, 26/26. |
| `git diff --check` | PASS. |

The full gate encounters the same unchanged Pod Manager `next/font` dependency on fetching
Inter from Google Fonts, refused by the existing temporary network guard. No unrelated
application workaround was added. Gate commands ran before the final report commit.

Logs: `/tmp/sst-tsax-fix-package-gate.log` (package tests),
`/tmp/sst-tsax-fix-lint-root.log`, `/tmp/sst-tsax-fix-gate.log` and
`/tmp/sst-tsax-fix-gate-full.log`.

No dependencies were added, so no new package-policy checks were needed. No push, PR,
publish, branch switch or other-checkout edit was performed. Automated roborev remains
unavailable in this checkout; no new automated verdict is claimed. All four implementation
fixes are complete. Full-workspace validation and automated review retain the limitations
above; there are no new open questions.
