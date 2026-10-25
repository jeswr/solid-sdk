<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-ito — A-002 fix round 1

Updated: 2026-10-25. Branch: `lane/sst-ito`; integration base: `61048c43`.
Resumed from `44067f16`; the imports were not repeated.

All four requested fixes are implemented. Both imported packages pass their full tests,
coverage, lint, build, typecheck, and focused Turbo gate. Root lint and root tests pass.
**Repository-wide validation remains blocked:** both affected and full gates stop at an
unchanged federation-trust snapshot mismatch. This report is updated and committed last,
after the validation attempts.

## Commits

The existing import commits remain: `783a6730` (personal-agent history), `9a99b8a4`
(legacy-bridge history), `bccc018e` (drop standalone artifacts), `5fccd959`
(workspace integration), and `44067f16` (previous validation report).

| Fix-round commit | Change |
| --- | --- |
| `ae60152e` | Derive send authorization from the executor's operation; reject and audit mismatched proposal labels. |
| `8cc8b95d` | Validate Actor proposal writes and exclude ACL/ACP resources, containers, and non-RDF content; document credentials without control rights. |
| `2367aa2d` | Apply the bridge calibration/reliability gate and preserve confirmation requirements through proposal storage and execution. |
| `3a170d71` | Record explicit domain ownership and compact only exact conversation/task owner matches. |
| This commit | Replace the previous validation report with fix-round results. |

## Behavior and conservative choices

- The outbox currently performs message sends, including scheduling replies. Its required
  ODRL action is therefore `distribute`, independent of the proposal's action label.
  Mismatches are prohibited even after owner confirmation and recorded in rejected outbox
  receipts. A `read` permission cannot authorize a send.
- The live Actor gate accepts only a parsed proposal at its expected proposal URL and
  serializes the validated record before allowing the write. It denies `.acl`/`.acr`
  paths, discovered `Link rel="acl"` and ACP `accessControl` targets (headers or RDF),
  container URLs/types, arbitrary or malformed RDF, non-RDF writes, and failed discovery.
  Access-control resource comparisons discard fragments. The live Actor injects its read
  fetch for discovery; direct gate/options callers must provide `discoveryFetch`.
- Actor writes remain Turtle-only, matching the existing proposal serializer. This also
  avoids loading remote JSON-LD contexts at the untrusted input boundary. The README
  requires the live Actor's injected authenticated fetch credentials to lack `acl:Control`
  and equivalent ACP control rights.
- Existing deterministic candidate filtering is retained. The bridge reliability gate
  marks selected self-reported, missing/unknown-calibration, intermediate-confidence, or
  security-bearing signals as confirmation-required; audit-only signals are excluded.
  A proposal containing any selected confirmation-required signal carries the flag.
  RDF storage and the content digest preserve it, and the executor requires a matching
  owner confirmation even under an autonomous-send mandate.
- New conversation/task-owned domain entries store `{ owner, value }`. Cleanup compares
  the owner ID exactly; keys and message/effect ID substrings no longer establish ownership.
  Legacy entries without ownership remain readable and are retained. Shared operation
  snapshots explicitly remain unowned because they combine several conversations' state.
- No dependencies, lockfile entries, package names/exports, or securityCritical flags were
  changed in this round. No timeout or enforcement-budget changes were made.

## Package validation

Host: Node `v24.22.1`, pnpm `10.4.1`, Vitest `4.1.10`.
Tests use synthetic fixtures, injected I/O, in-memory stores, and loopback services.
No live provider/model, credential store, provisioning, or send script was invoked.

For both packages, `run lint`, `run build`, and `run typecheck` passed.
The dependency-first build passed all eight dependency tasks.

| Package | Tests | Coverage run |
| --- | --- | --- |
| personal-agent | PASS: 482 tests, 55 files | PASS: 482 tests, 55 files |
| agentic-legacy-bridge | PASS: 650 tests, 37 files | PASS: 650 tests, 37 files |

Coverage includes every non-test TypeScript file under each package's `src/`:

| Package | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| personal-agent | 86.88% | 74.56% | 90.39% | 89.46% |
| agentic-legacy-bridge | 93.95% | 86.75% | 97.32% | 96.30% |

These are complete passing-suite baselines, replacing the previous partial personal-agent
coverage. Both securityCritical flags remain unset because coverage is below 100%.
**Test-only timeout increases: none.** All tests and coverage ran with existing defaults.

Regression coverage includes non-send permissions, confirmed action-label mismatches and
their receipts; ACL/ACP targets advertised on both containers and resources; permitted
proposal writes and every requested write rejection; calibrated versus uncalibrated
derivation and confirmation-only execution; and conversation/task prefix collisions
(`urn:case:1` versus `urn:case:10`) with unowned-state retention.

Commands, with `GIT_ALLOW_PROTOCOL=file`:

```sh
pnpm --filter @jeswr/personal-agent run test
pnpm --filter @jeswr/personal-agent run test:coverage
pnpm --filter @jeswr/agentic-legacy-bridge run test
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
pnpm run lint:root
pnpm run test:root
pnpm exec turbo run lint build typecheck test --filter=@jeswr/personal-agent --filter=@jeswr/agentic-legacy-bridge --concurrency=4 --env-mode=loose
```

The focused package gate passed **16/16 tasks** (nine cached), in 1m8.652s.
Root lint passed all workspace, lockfile-transport, and raw-fetch guards.
Root tests passed **28 tests in two files**.

## Repository gates and remaining blocker

Both gates were run after the final implementation commit and before this report commit:

```sh
TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 ASTRO_TELEMETRY_DISABLED=1 GIT_ALLOW_PROTOCOL=file npm_config_cache=/tmp/sst-ito-npm-cache TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate --env-mode=loose
TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 ASTRO_TELEMETRY_DISABLED=1 GIT_ALLOW_PROTOCOL=file npm_config_cache=/tmp/sst-ito-npm-cache pnpm run gate:full --env-mode=loose
```

| Gate | Result |
| --- | --- |
| Affected repository gate | FAIL, exit 1: Turbo reported 198 successful / 250 tasks; 2m9.466s. |
| Full repository gate | FAIL, exit 1: Turbo reported 180 successful / 208 tasks, 96 cached; 28.832s. |

Both stop at `@jeswr/federation-trust#test`, specifically
`test/characterization.test.ts:196`, "delegation credential structure is stable".
The embedded Ed25519 delegateKey JSON string has a different property order:
the snapshot expects `crv,x,kty`; this host produces `kty,crv,x`.
That package reports **53 passing / one failing test**. Neither federation-trust nor
solid-vc has any source changes relative to the supplied integration base.
The mismatch is outside this fix brief and was left unchanged.

The full gate also logged a Pod Manager worker exit around the fail-fast shutdown.
An isolated Pod Manager rerun passed **1,146 tests, one skipped, in 104 files**.
Pod Manager's build succeeded, including its Google Fonts fetch, so the earlier font
blocker is resolved on this host. Both repository gates stopped before completing all tasks.

## Verification setup, review, and scope

The first dependency build invoked existing fetch-rdf remote-clone bootstrap scripts
before Git was constrained to local transport. Their npm step failed because the default
cache is read-only. This was a deviation from the lane's no-remote-fetch intent.
Subsequent builds used `GIT_ALLOW_PROTOCOL=file`. The exact lockfile-pinned fetch-rdf
source already present in the temporary bootstrap directory (`a8359a3764cb6b3c763e09ea211542a5dc7edc33`)
was compiled with the installed TypeScript into ignored dependency output. No dependency
manifest, source in another checkout, or tracked build artifact was changed.

Manual review checked the four authorization/retention boundaries and the final diff.
Automated roborev review remains unavailable: the CLI is not installed on this host.
No review was claimed. All four fix commits include model provenance trailers.

The lane stayed on `lane/sst-ito`. No push, PR, publish, branch switch, tracker mutation,
or fetch/merge into the lane checkout was performed. Gate-generated untracked app
client-ID/callback files were removed. The working tree is clean after this report commit.

Implementation work from this brief is complete. Remaining acceptance work is the
repository-wide snapshot failure and unavailable automated review. There are no open
design questions.
