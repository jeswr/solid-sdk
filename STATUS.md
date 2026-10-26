<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.4

Base: `93afe9d606533fc0b36ab314423d2f0b73e528e6`.
Branch: `lane/sst-8xm.4`.

## Commits

- `b9c5bcdb` — `fix(auth): exclude issuer from proactive origins by default`.
  Both helpers default `includeIssuerOrigin` to false, preserve explicit true,
  retain resource-derived admission on shared issuer/pod origins, and update TSDoc.
  Tests cover the boundary and preserve the explicit issuer-in-boundary login-stall case.
- `035e465f` — `docs(auth): document proactive issuer opt-in`.
  Update both package READMEs and skills, add focused API behavior reports, and record
  the conservative report interpretation in `QUESTIONS.md`.
- Final commit: `docs: record sst-8xm.4 lane results` — this report.

## Security property and proof

An issuer URL alone no longer authorizes proactive attachment of a Solid resource
credential. In both packages, omitted `includeIssuerOrigin` is passed as false to
`computeAllowedOrigins`; explicit true still opts in. `computeAllowedOrigins` itself
retains its existing issuer-inclusive default. `podRoot` still admits a resource origin
shared with the issuer. WebID inclusion behavior is unchanged.

Both package suites prove default exclusion, an empty issuer-only boundary, explicit
opt-in, explicit opt-out, and shared issuer/pod origins with the default and false options.
Opt-in cannot admit malformed URLs or remote cleartext HTTP origins. Existing direct
`computeAllowedOrigins` tests continue to assert its issuer-inclusive default.

The installed-global-fetch adversarial test uses a provider that unconditionally stamps
both Authorization and DPoP. A non-OIDC `/account/settings` request to a separate issuer
origin carries neither header, triggers no upgrade, and makes exactly one transport call
for both 200 and 401 responses. A positive control proves the same installed wrapper and
provider attach both headers to the pod. Restoring the pre-change implementations caused
four expected failures in each package (the two default-exclusion cases and both
adversarial statuses); the other 51 proactive-fetch tests per package passed. This proves
the new regressions fail without the implementation change.

## Validation

All commands use Node `v24.22.1` and pnpm `10.4.1`, with
`PATH=/opt/node24/bin:$PATH`. Dependency lifecycle scripts remain disabled.

```sh
pnpm exec turbo run build --filter=@jeswr/solid-auth-core... --filter=@jeswr/solid-elements...
pnpm --filter @jeswr/solid-auth-core run lint && pnpm --filter @jeswr/solid-auth-core run build && pnpm --filter @jeswr/solid-auth-core run typecheck && pnpm --filter @jeswr/solid-auth-core run test
pnpm --filter @jeswr/solid-elements run lint && pnpm --filter @jeswr/solid-elements run build && pnpm --filter @jeswr/solid-elements run typecheck && pnpm --filter @jeswr/solid-elements run test
pnpm run lint:root
TURBO_SCM_BASE=93afe9d606533fc0b36ab314423d2f0b73e528e6 pnpm run gate
pnpm run gate:full --continue=always
```

- Dependency-first build: PASS (4 tasks).
- `solid-auth-core` lint/build/typecheck/test: PASS (8 files, 279 tests).
- `solid-elements` lint/build/typecheck/test: PASS (15 files, 332 tests, manifest check).
- Standalone root lint: PASS.
- Affected gate: FAIL (exit 1), 19 successful tasks of 46 scheduled. The root suite had
  730 passing tests and 170 failures across unchanged guard tests:
  `agent-layers-reachability` (1), `agent-layers` (12), `check-packages-guard` (2), and
  `check-sdk-layers` (155). Negative CLI cases returned empty child-process diagnostic
  output, causing the output assertions to fail. No root script, guard, or test changed
  in this lane. Turbo stopped remaining tasks after the root suite failure.
- Full workspace gate: NOT GREEN / INCOMPLETE (interrupted with exit 130).
  `--continue=always` allowed all relevant package/app tests to run despite unrelated
  failures. Both changed packages passed again (279 and 332 tests). The root suite
  reported 719 passes and 181 failures across six unchanged test files, including
  diagnostic-output assertions and test/hook timeouts. Twenty tasks had reported
  failures when the run was stopped; 392 tasks had started. No final Turbo task summary
  was produced.

The full run was stopped after remaining loopback-dependent suites stopped reporting
progress. `guarded-fetch` and `federation-client` repeatedly await local-server setup in
30-second hooks, and `personal-agent` also contains local-server fixtures. This sandbox
rejects listeners with `listen EPERM ... 127.0.0.1`; continuing those hooks cannot validate
the server behavior here. Other observed failures included restricted IPC/process
operations, blocked font downloads, unchanged snapshot assertions, and unrelated
timeouts. No unrelated source or test was changed to bypass these failures.

Failed tasks recorded before interruption:

```text
//#test:root
@jeswr/fetch-rdf#test
@jeswr/app-pod-manager#build
@jeswr/solid-dpop#test
@jeswr/app-coeliac#build
@jeswr/app-issues#build
@jeswr/app-mcp-server#test
@jeswr/federation-trust#test
@jeswr/suite-ui#test
@jeswr/rxdb-solid#test
@jeswr/app-suite#build
solid-agent-notify#test
@jeswr/solid-app-store-web#test
@jeswr/solid-pod-guard#test
@jeswr/rdf-engine#test
@jeswr/app-pod-manager#test
@jeswr/solid-seed#test
@jeswr/solid-mcp#test
@jeswr/solid-components#test
create-solid-demo#test
```

All nine web app callers passed their complete suites. Eight passed in the full gate;
App Store had one 5-second restore-latch timeout under that load (204 other tests passed),
then its entire suite passed separately without any source changes:

```sh
pnpm --filter @jeswr/solid-app-store-web run test
```

| Caller suite | Passing tests |
| --- | ---: |
| Pod Chat | 177 |
| Pod Docs | 136 |
| Pod Drive | 173 |
| Pod Health | 181 |
| Pod Mail | 168 |
| Pod Money | 179 |
| Pod Music | 176 |
| Pod Photos | 183 |
| App Store (separate rerun) | 205 |

No app test asserted issuer membership in the proactive allow-set, so no app changes
were needed. All new tests use provider/fetch doubles and fixture URLs.

A separate diagnostic run reproduced the root failures (exit 1; 3 failed, 38 passed),
including empty stderr for an expected agent-layer error and empty stdout/stderr for
both denylisted-dependency checks:

```sh
pnpm exec vitest run test/agent-layers-reachability.test.mjs test/check-packages-guard.test.mjs
```

The existing generated `solid-elements/auth` API signature report was checked offline
using the already installed API Extractor, from `packages/solid-elements`:

```sh
node ../../node_modules/.pnpm/@microsoft+api-extractor@7.58.9_@types+node@22.20.1/node_modules/@microsoft/api-extractor/bin/api-extractor run --config api-extractor.auth.json
```

Result: PASS; generated report matches the committed report byte for byte. Runtime
default changes are recorded in each package's `etc/proactive-fetch.api.md`.

The initial direct proactive-fetch test attempt could not resolve unbuilt workspace
dependencies. Building dependencies first resolved that setup issue. The old-default
regression commands then each exited 1 as expected, and the complete updated package
suites passed:

```sh
pnpm --filter @jeswr/solid-auth-core exec vitest run test/proactive-fetch.test.ts
pnpm --filter @jeswr/solid-elements exec vitest run test/proactive-fetch.test.ts
```

`check:packages`: not applicable; no dependencies or manifests changed, and no packages
were installed. No lockfile changes. No committed `dist/` artifacts.

## Review and remaining work

`roborev status` exited 127 (`roborev: command not found`); no post-commit review hook is
installed in this checkout. Automated per-commit verdicts are therefore unavailable.
Jesse must review this security-critical change and perform the merge; no auto-merge,
push, PR, or publication was attempted.

Implementation is complete; a green workspace gate and automated review remain blocked
as described above. Open questions: none. The conservative API report choice is documented
in `QUESTIONS.md`. Build-generated, untracked callback/client-ID files were removed after
validation; the final commit contains only this report.
