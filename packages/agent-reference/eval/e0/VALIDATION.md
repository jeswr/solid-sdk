<!-- AUTHORED-BY Codex GPT-6 -->
# E0 validation

All commands used Node 24.22.3 through `PATH=/opt/node24/bin:$PATH`. No dependencies were added. No gate, runtime, personal-agent source, profile, scenario or original trace change is retained. Build-generated traces and outlines were restored from copies captured before verification.

| Command | Result |
|---|---|
| `pnpm --filter @jeswr/agent-reference lint` | Passed. Existing warnings and informational diagnostics remain outside this lane. |
| `pnpm --filter @jeswr/agent-reference build` | Passed, including schema check, original trace generation and all 151 scenario paths. |
| `pnpm --filter @jeswr/agent-reference typecheck` | Passed. |
| `pnpm --filter @jeswr/agent-reference test` | 200 existing tests and 17 E0 tests passed. |
| `pnpm --filter @jeswr/personal-agent lint` | Passed. |
| `pnpm --filter @jeswr/personal-agent build` | Passed. |
| `pnpm --filter @jeswr/personal-agent typecheck` | Passed. |
| `pnpm --filter @jeswr/personal-agent test` | Attempted with default limits. Local-server tests each waited ten seconds without obtaining a permitted port; this run was interrupted. |
| Bounded complete personal-agent run, command below | 492/573 passed, 77/573 failed, 4/573 not run because localhost setup failed. 42/58 files passed, 16/58 failed. |
| `node scripts/check-agent-layers.mjs` | Passed. |
| `pnpm gate:full --cache=local:rw` | The first attempt stopped at solid-federation-vocab because n3 was unavailable. The session-close attempt stopped at app-shell because react, react/jsx-runtime and lucide-react were unavailable, causing JSX/type cascades. Eight tasks succeeded before the latter stop. No network install was attempted. |

The full personal-agent command with bounded waits was:

```sh
PATH=/opt/node24/bin:$PATH pnpm --filter @jeswr/personal-agent test --testTimeout=2000 --hookTimeout=2000 --teardownTimeout=1000 --reporter=json --outputFile=/tmp/e0-personal-results.json
```

The 77 failures are not explained by the two root-sensitive exceptions in the brief. Most are direct listen/spawn EPERM errors, exhausted localhost port searches, or the demo reporting a listen EPERM in fictional scenario C. Three tests wait for a localhost listener or a child readiness handshake and time out. The standalone diagnostic child was a fictional script that waits for stdin EOF and then writes fictional-ok; under this sandbox it exited zero with empty stdout. That also explains the empty helper reply and failed helper handshake assertions. The focused policy/helper/credential/custody run completed with 78/108 passing and 30/108 failing, confirming these constraints independently of E0. No personal-agent or reference gate/runtime source was changed. The rename test fails at its earlier localhost setup here, so this run does not isolate its root-sensitive persistence assertion.

Every failed assertion and its explanation is retained in validation-personal.json. Failed assertion counts by file:

| File | Failed assertions |
|---|---:|
| src/actions/providers.test.ts | 2 |
| src/actions/providers/credentials.test.ts | 2 |
| src/credentials/credentials.test.ts | 20 |
| src/dashboard/actions-api.test.ts | 2 |
| src/dashboard/server.test.ts | 18 |
| src/pilot/a2a.test.ts | 14 |
| src/pilot/conventional.test.ts | 1 |
| src/pilot/demo.test.ts | 1 |
| src/pilot/energy-durable.test.ts | 1 |
| src/pilot/mcp.test.ts | 1 |
| src/pilot/policy-config.test.ts | 6 |
| src/pilot/policy-engine.test.ts | 1 |
| src/pilot/protected-disclosure.test.ts | 4 |
| src/pilot/provider-http.test.ts | 1 |
| src/pilot/public-reply.test.ts | 3 |

guarded-fetch-undici.test.ts has a setup-hook failure and four tests not run, in addition to the 77 failed assertions.

The evaluation itself uses no subprocess, local server, network or model. Its commit field records the clean starting HEAD, 4a6714886ff298451ecc34dcd4ab7ae01e929c3a. evaluationSourceDigest binds the uncommitted E0 implementation that Claude will review and commit.

Original scenario outlines are compared during every evaluation run. This catches observer events leaking into the baseline. The snapshots for all six required-claim-removal false admits contain zero copies of the removed claim at arrival; targetHeldBefore is false. Subsequent baseline admission does not mutate the saved snapshots.

Reproducibility and final run counts are recorded in E0-SUMMARY.md. The detailed A data contains nine atomic-register repeat trials: five first executions completed and none executed twice; four trials could not execute the first action. These four are not counted as proof of a successful consumption/repeat test.

The six false admits arise because Admission.complete considers required failures only for supplied claims in its cache. Removing a required kind removes the corresponding cache entry, so no missing-kind check rejects or challenges the envelope. The gate remains unchanged for Claude to review.

Two complete sequential runs with seed 20261113 and N = 200 produced byte-identical A, B, C and compact JSON files. Their evaluationSourceDigest matches the current implementation. Elapsed time appears only in the Markdown summary. SHA-256 digests:

- a-worst-case.json: `7ad15d1cace28b401ca4c844c1de4a001cae09ab6c3334e70ec91f41aecd966a`
- b-mutations.json: `15959c675277583a18133808f3d0e971d7127e33acfa7b8171c57bf067a98b21`
- c-faults.json: `d0f60568e5d33492016cf616f95e252e499f56aef0f0cd238b9e22ac8a7a5fff`
- e0-compact.json: `70a5988f9443d797117c91a7563895fda12f6bcc2433d881e27b4eefbbf526a4`

All 432 unmodified scripted outbound proposals produced the same authorisation decision in their isolated clone as in the real baseline. Checkpoint clocks and transient gate state are preserved.
