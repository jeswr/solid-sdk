<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-543 / A-007 lane status

Implemented on `lane/sst-543`; no push, PR, remote fetch, merge or branch switch.

## Commits

- `81ce3948` — `feat(credentials): port pilot OAuth and store`: retain the pilot store,
  PKCE/state/nonce loopback flow, signed ID-token checks, account/client pinning, profile locks,
  refresh rotation, calendar adapters and helper protocol; import the pilot tests.
- `d3c87e8d` — `feat(credentials): separate grants and provision tokens`: platform store paths,
  explicit purpose/resource binding, Google/Microsoft scope profiles, eight token-file providers,
  structural channel TokenProvider, package exports/documentation and fake-op provisioning tests.
- `6c18c920` — `test(credentials): cover adversarial credential paths`: exercise ownership,
  symlinks, permissions, atomic-write failures, callback/identity errors, refresh races,
  helper failures and CLI boundaries; enforce unchanged 100% per-file coverage thresholds.
- `806daf62` — `fix(credentials): verify provisioning process exit`: pipe op stdout privately
  inside the writer and check process completion independently before storing anything; reject
  arbitrary partial output from failed op processes, including a trailing NUL.
- Final `docs: record credential lane verification` commit — this status and public-export TSDoc.

## Implementation and scope

The pilot modules were absent from `packages/personal-agent` in this base, so the port used
only the read-only pilot source path supplied in the brief. No source checkout was modified.
The existing scaffold already appears in `suite.json`; no new package entry was needed.

OAuth profiles and grants explicitly bind provider, connection/account, purpose (`read` or
`send`) and resource (`mail`, `calendar`, `teams`). Overlapping scopes never substitute for the
other purpose. Missing, ambiguous, malformed, expired or incorrectly bound credentials refuse.
Calendar grants remain separate from mail; the pilot Microsoft calendar read adapter remains.
The task's explicit token-file list is implemented: anthropic, openai, slack, matrix, discord,
telegram, bluesky and mastodon. Telegram personal-account MTProto remains deferred.

Conservative choices where the base supplied no concrete contract:

- `agent-channels` is a scaffold without TokenProvider types, so this package exposes the
  structural `read(account): Promise<string>` / `send(account): Promise<string>` seam locally.
  Account denotes the registry connection id; provider and resource are constructor options.
- Network transport must be injected explicitly. Missing transport refuses; the executable
  helper can serve cached tokens but does not acquire an ambient network capability. Hosts
  supply transport through the library API for login/refresh and provider adapters.
- Existing CLI profile creation defaults to calendar/read. Persisted profiles/grants require
  purpose/resource fields; unmarked legacy records do not silently gain authority.
- Store parents must exist, retaining the pilot's explicit-directory semantics. The default
  path function performs no filesystem access. Platforms without verifiable ownership refuse.
- Provisioning requires an explicit directory and provider; token files also require account
  and purpose. The zsh entry delegates each op read to its private pipe writer, exactly once
  per reference. Receipts contain only `credentialRef`; values never enter argv, shell variables,
  public output or temporary files outside the private store. Runtime never invokes op.

## Verification

All commands ran in this checkout. No live provider, real credential store or real op
executable was used by lane tests. Fake-op tests prepend their own executable to PATH.

| Command | Result |
| --- | --- |
| `pnpm run check:packages zod jose` | PASS; both dependencies cleared full npm policy checks before manifest changes. These are existing pilot dependencies required by the port. |
| `pnpm install --ignore-scripts` | PASS; lifecycle scripts stayed disabled. Lockfile changes are limited to the credential package importer. Existing unrelated peer warnings were reported. |
| `pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile` | PASS. |
| `pnpm --filter @jeswr/agent-credentials run lint` | PASS; no warnings or fixes. |
| `pnpm --filter @jeswr/agent-credentials run build` | PASS. |
| `pnpm --filter @jeswr/agent-credentials run typecheck` | PASS, including test TypeScript. |
| `pnpm --filter @jeswr/agent-credentials run test` | PASS; 8 files, 117 tests; 100% statements (1319), branches (993), functions (203), lines (1193), with per-file thresholds unchanged. Includes all imported pilot tests and fake-op shell tests. |
| `pnpm run lint:root` | PASS, also rerun by the affected gate. |
| `TURBO_SCM_BASE=agent/integration pnpm run gate` | Cannot resolve SCM base: this checkout has no `agent/integration` ref. Root lint passed before Turbo stopped. |
| `TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate` | PASS using the exact base SHA supplied in the brief; 6 tasks, including 686 root tests and credential package checks. Final rerun after public-export documentation also passed: 6/6 tasks, 686 root tests, in 21.943s. |
| `pnpm run gate:full` | FAIL in unrelated `@jeswr/federation-codegen#test`, after 285 successful tasks out of 345, in 2m21s. Two generator tests expect old `https://w3id.org/jeswr/...` inputs/output while the vocabulary source uses `https://jeswr.org/ns/...`. |
| `git diff --exit-code 6ad0939808c3c1c438415d45409a5a4c30e281bd -- tools/federation-codegen packages/solid-federation-vocab` | PASS; the full-gate failure paths are unchanged from the supplied base. |
| `git diff --check` | PASS. |

No timeout configuration was raised and no test timeout flakes were observed. The loaded-machine
package rerun took about 30 seconds overall and still passed. The shell script uses the POSIX
subset and was tested with bash because zsh is unavailable; native zsh execution was not verified.
Build-generated untracked public assets from the full gate were removed; no dist is committed.

## Remaining limitations and open questions

Implementation and acceptance tests are complete. The full-workspace gate remains blocked by
the unrelated namespace fixture drift above; no out-of-scope correction was made.

Roborev is not installed (`command -v roborev` returned no executable), so automated per-commit
review could not run. This security-critical lane still needs the repository's review process
before integration. Bead closure/sync remains with the integration owner; no tracker was opened
inside this worktree.

Open design questions: none. No live consent, provisioning, provider request or send was performed.

## Fix round 1 — review of `d0971191b7eb`

Commit `7a7394e0` (`fix(credentials): address provider review findings`) fixes exactly the
six supplied findings, with regression tests:

- Filter Microsoft signing keys by issuer before jose key selection, substituting the token's
  validated tenant ID into `{tenantid}` templates. Missing, malformed and foreign key issuers
  refuse; unrelated permitted keys cannot authorize a restricted signing key.
- Read OAuth response chunks incrementally, enforce the 256 KiB cap before retaining excess
  data, cancel oversized streams, release reader locks and sanitize read/cancellation errors.
  Tests include an unfinished stream, exact-limit JSON and split UTF-8 characters.
- Catch malformed request-target URLs inside the loopback callback handler; return HTTP 400,
  retain no grant and continue accepting a legitimate callback.
- Request `calendar.readonly` from the Google helper to match normal calendar login grants.
  The regression drives signed fake login through helperExchange into googleFreeBusy.
- Generate calendar provider configuration from calendar/read profiles only. Mail and Teams
  profiles sorted before the calendar profile, and send profiles, are excluded. This is the
  conservative review option and preserves the existing configuration/lookup contract.
- Resolve ambiguous times from actual offsets sampled on either side of the timezone
  transition. Lord Howe's thirty-minute overlap returns both instants and widens Microsoft
  busy intervals; skipped and unambiguous times remain checked.

The final `docs: record credential fix verification` commit records this round's results.

Verification for this round:

| Command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks including root lint. 8 test files, 124 tests; 100% statements (1342), branches (1003), functions (205), lines (1214), with per-file thresholds unchanged. |
| `TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate` | PASS; 6/6 tasks, including 686 root tests. Uses the original brief's exact base SHA, as this checkout lacks the integration ref. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/federation-codegen#test`: the same two `test/generator.test.ts` namespace fixture failures recorded above (`https://w3id.org/jeswr/...` versus `https://jeswr.org/ns/...`). 224 successful tasks out of 293; 1m41s. |
| `git diff --exit-code d0971191b7eb05dfdad0c194da589120c1902496 -- tools/federation-codegen packages/solid-federation-vocab` | PASS; failing paths unchanged from this fix round's starting commit. |
| `git diff --check` | PASS. |

Initial verification rejected a test-local identifier named `window` under the agent layer
rule, then caught a fake calendar response missing its JSON content type. Both test fixtures
were corrected before the passing package gate. No runtime dependency, manifest, lockfile,
coverage threshold or timeout configuration changed. No dependency policy check was needed.
All credential tests use injected fake providers, temporary stores and fake op executables.
Roborev remains unavailable (`command -v roborev` found no executable); no review tool was
installed, no tracker was changed and no network remote was fetched or modified.

All six requested findings are addressed. No implementation work or open questions remain for
this fix round. Integration still requires the repository's review process; the unrelated
full-workspace failure remains outside this brief. Only the credential package and this lane
status changed. No generated build artifacts are included.

## Fix round 2 — review of `0d45e1083ce2`

This round addresses exactly the three supplied findings on `lane/sst-543`:

- `902b9cd9` — `fix(credentials): replace provisioned tokens by account purpose`:
  key token-file names by provider/account/purpose, so each successful reference atomically
  replaces that tuple's previous token. Tests cover replacement, independent accounts and
  purposes, invalid replacement preservation, and the shell's two-reference flow followed by
  a successful StoreTokenProvider lookup. Failed fake-op reads preserve the last good value.
- `8a4c3f2d` — `fix(credentials): require trusted identities and unique helpers`:
  Microsoft profiles bind to operator-verified tenant/object GUIDs via `expectedIdentity`
  (`--tenant-id` / `--object-id` in the CLI). Both signed claims must match before consent is
  accepted. Token use also requires this binding, so legacy username-only grants cannot bypass
  it. Tests reject missing bindings and signed wrong-object/wrong-tenant identities even when
  the username matches. Helper configuration loading and generation reject duplicate
  provider/connection mappings; lookup independently requires exactly one match before spawning
  a helper. Tests prove ambiguity cannot invoke the helper or replace a valid configuration.
- Final `docs: record second credential fix verification` commit — README instructions for
  trusted Microsoft identity setup and token replacement, plus this verification record.

The conservative review option is a trusted identity supplied independently by the operator;
there is no automatic first-login identity approval or fallback to a matching username.
No runtime dependency, manifest, lockfile, coverage threshold or timeout setting changed.
Dependency policy checks were unnecessary because no dependencies were added.

Verification for this round:

| Command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks including root lint. 8 files, 126 tests; 100% statements (1364), branches (1031), functions (207), lines (1235), with per-file thresholds unchanged. |
| `TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate` | PASS; 6/6 tasks, including all package checks and 686 root tests, in 27.341s. Uses the original brief's base SHA because this checkout lacks the integration ref. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/federation-codegen#test`: the same two `test/generator.test.ts` namespace fixture failures recorded in prior rounds (`https://w3id.org/jeswr/...` versus `https://jeswr.org/ns/...`). 287 successful tasks out of 348; 3m2.385s. |
| `git diff --exit-code 0d45e1083ce2a9396e1b42a9931ac6bb5002e382 -- tools/federation-codegen packages/solid-federation-vocab` | PASS; failing paths unchanged from this round's starting commit. |
| `git diff --check` | PASS. |

An initial package-gate attempt caught an unformatted test declaration; formatting was corrected
before the passing package and affected gates. No test timeout flakes occurred. The shell tests
used bash with a fake op, as zsh remains unavailable. All credential tests use temporary stores
and injected fake transports. No live credential, provider, real op, tracker or network remote
was accessed. Generated untracked application callback/client-id assets from the full build
were removed; no dist or other build artifact is committed.

All three requested fixes and their regression tests are complete. The full-workspace gate
remains blocked solely by the unchanged federation-codegen failures. Roborev remains unavailable
(`command -v roborev` found no executable); no tool was installed. Integration review and bead
closure remain with the integration owner. Open questions: none.

## Fix round 3 — review of `681e43b76f82`

This round addresses exactly the two supplied findings on `lane/sst-543`:

- `a495b5d6` — `fix(credentials): validate helper config ownership by descriptor`:
  open helper configuration once with `O_NOFOLLOW`, verify the regular-file type,
  current-user ownership and existing group/world write restrictions with `fstat`, then
  parse that descriptor and close it on success or failure. Tests reject foreign ownership,
  unavailable ownership checks, symlinks, non-files and writable modes; a path-replacement
  regression proves validation and parsing use the same opened file. Ownership trust is
  conservatively limited to the current user.
- `bcd8fd51` — `fix(credentials): remove unreadable grants on local logout`:
  deserialize only for requested Google revocation. Local logout removes corrupt JSON and
  legacy grants missing purpose/resource under the profile lock, retaining filesystem checks.
  Tests cover both providers, lock ownership during deletion, refusal of insecure/symlinked/
  non-file records, preservation of unreadable grants on Google remote revocation, and no
  provider calls for local removal or missing refresh tokens. Microsoft logout also avoids
  deserialization with `--revoke`, since it has no supported remote revocation endpoint.
- Final `docs: record third credential fix verification` commit — this verification record,
  committed last.

Verification for this round:

| Command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks including root lint. 9 files, 139 tests; 100% statements (1374), branches (1038), functions (207), lines (1244), with per-file thresholds unchanged. |
| `pnpm run lint:root` (also invoked by the affected gate below) | PASS; all root guards passed. |
| `TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate` | PASS; 6/6 tasks, including 686 root tests, in 16.531s. Uses the original brief's base SHA because this checkout lacks the integration ref. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/federation-codegen#test`: the same two `test/generator.test.ts` namespace fixture failures recorded in earlier rounds (`https://w3id.org/jeswr/...` versus `https://jeswr.org/ns/...`). 209 successful tasks out of 291 scheduled before stopping; 1m24.34s. |
| `git diff --exit-code 681e43b76f821121cf2a4f4a975d2b631a37ec5d -- tools/federation-codegen packages/solid-federation-vocab` | PASS; failing paths unchanged from this round's starting commit. |
| `git diff --check` | PASS. |

An initial direct typecheck ran before building the package exports and caught a numeric type
in the new ownership fixture; build order and the fixture were corrected. A subsequent lint
check caught formatting, which was corrected before the passing package and affected gates.
No timeout flakes occurred. No dependencies were added, so no dependency policy check was
needed; manifests, lockfile, coverage thresholds and timeout settings are unchanged. All
credential tests use temporary stores, injected fake transports and fake op executables.

Both requested fixes and their regressions are complete. The full-workspace gate remains
blocked by the unchanged federation-codegen failures. Roborev is unavailable (`command -v
roborev` found no executable); no review tool was installed. No live credential, provider,
real op, tracker or network remote was accessed. Only the credential package and this lane
status changed, with no generated build artifacts committed. Integration review and bead
closure remain with the integration owner. Open questions: none.

## Fix round 4 — review of `3bcdbbf106b0`

This round addresses the single supplied existing-record replacement finding:

- `4d6b07ca` — `fix(credentials): migrate legacy provisioned tokens`:
  validate the replacement, identify existing records with the same provider/account/purpose,
  and write the canonical record using the existing private atomic-write path before removing
  older keys. Retain ownership, permission and symlink checks for reads and deletion. A failed
  validation, write, fsync or rename preserves the previous credential. Cleanup failures report
  failure; retrying removes the remaining older records. Other providers, accounts and purposes
  are preserved.
- Final `docs: record fourth credential fix verification` commit — this verification record,
  committed last.

Regression tests reproduce the historical reference/account/purpose filename algorithm and
cover replacement with the same or a different reference, canonical records coexisting with
multiple legacy records, unrelated tuples, invalid values, injected write/fsync/rename and
cleanup failures, insecure legacy files, and records disappearing after enumeration. Token
lookups succeed after migration. Both historical-filename regressions were also run against
the previous provisioning call and failed because the old files remained; the fixed call was
restored before the passing affected gate.

Verification for this round:

| Command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks including root lint. 9 files, 143 tests; 100% statements (1386), branches (1043), functions (209), lines (1255), with per-file thresholds unchanged. |
| `pnpm run lint:root` (invoked by the package and affected gates) | PASS; all root guards passed. |
| `TURBO_SCM_BASE=0d45e1083ce2a9396e1b42a9931ac6bb5002e382 pnpm run gate` | PASS; 6/6 tasks, including 686 root tests, in 11.943s. Uses this lane's supplied base SHA. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/federation-codegen#test`: the same two `test/generator.test.ts` namespace fixture failures recorded in earlier rounds (`https://w3id.org/jeswr/...` versus `https://jeswr.org/ns/...`). 236 successful tasks out of 315 scheduled before stopping; 1m16.377s. |
| `git diff --exit-code 3bcdbbf106b0508636d643eddeab3512510e83ec -- tools/federation-codegen packages/solid-federation-vocab` | PASS; failing paths unchanged from this round's starting commit. |
| `git diff --check` and `git show --check --oneline 4d6b07ca` | PASS. |

No dependencies were added, so no dependency policy check was needed. Manifests, lockfile,
coverage thresholds and timeout settings are unchanged. No timeout flakes occurred. Tests
use temporary stores, synthetic values and fake op executables; no real credential store,
provider or op was accessed. Generated application callback/client-id assets from the full
build were removed; no generated artifacts are committed.

The requested fix and regression tests are complete. The full-workspace gate remains blocked
by the unchanged federation-codegen failures. Roborev remains unavailable (`command -v roborev`
found no executable); no tool was installed. Integration review and bead closure remain with
the integration owner. No tracker, remote or other checkout was modified. Open questions: none.

### Resumed round 4 verification

The resumed checkout already contained the requested implementation and regressions in
`4d6b07ca`, followed by verification commit `f1d146cc`. Re-read the complete supplied review
and earlier briefs and checked the existing migration against the single finding. No further
implementation changes were necessary. This final `docs: record resumed credential verification`
commit changes only STATUS.md.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks, including uncached root lint; 3 tasks cached. |
| `pnpm --filter @jeswr/agent-credentials run test` | PASS, fresh run; 9 files, 143 tests; 100% statements (1386), branches (1043), functions (209), lines (1255). |
| `TURBO_SCM_BASE=0d45e1083ce2a9396e1b42a9931ac6bb5002e382 pnpm run gate` | PASS; 6/6 tasks, including root lint and 686 root tests; 4 tasks cached; 11.384s. |
| `pnpm run gate:full` | FAIL in `@jeswr/federation-codegen#test`: the same two namespace fixture failures recorded above; 143 successful tasks out of 197 scheduled before stopping; 3.015s. |
| `git diff --exit-code 3bcdbbf106b0508636d643eddeab3512510e83ec -- tools/federation-codegen packages/solid-federation-vocab` | PASS; failing paths remain unchanged. |
| `git diff --check` | PASS. |

The existing regression tests cover replacement of historical reference-keyed filenames with
the same or a new reference and preservation on validation/write failure. No dependencies were
added, so no dependency policy check was needed. Roborev is still unavailable. No live provider,
real credential store, real op, network remote, tracker or other checkout was accessed or
modified. The unrelated full-workspace failures and integration review remain outstanding;
no requested implementation work or open questions remain.


## Fix round 5 — review of `5377ddba8a1e`

This round addresses exactly the two supplied findings and the prescribed prerequisite merge:

- `67ec2636` — `chore: merge prescribed integration prerequisites`: fetched only the local
  source repository's `agent/integration` branch and merged `93217230`. The merge was clean;
  no conflict resolutions or changes to another checkout were needed.
- `cc9570ed` — `fix(credentials): require Google email authority`: account selection requires
  a verified email and either the Gmail/Googlemail suffix or a signed `hd` matching its domain.
  First-consent regressions reject absent, malformed and mismatched `hd`; signed synthetic
  provider-domain identities remain accepted. The existing stored `sub` remains the binding:
  a changed subject with the same authoritative email is refused without replacing the grant.
- `b66b9cd5` — `fix(credentials): preserve lock ownership`: lock records contain a random
  owner token, PID and hostname. Recover only owners on this host whose PID probe reports
  ESRCH; live, foreign-host, unverifiable and malformed owners retain their locks until the
  existing typed timeout. Release compares the token before deletion. Tests cover old live
  owners, token uniqueness, replacement during release/recovery, a real exited child PID,
  permission refusals, failed writes and locks disappearing during recovery. The existing
  `staleMs` option remains accepted for compatibility but never revokes a lock.
- Final `docs: record fifth credential fix verification` commit — this record, committed last.

Verification for this round:

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS; refreshed dependency links for the prescribed merge without changing the lockfile or running lifecycle scripts. Warnings concerned workspace CLI bins not yet built. |
| `pnpm exec turbo run lint build typecheck test --filter=@jeswr/agent-credentials --concurrency=4` | PASS; 5/5 tasks, all uncached, including root lint. 9 files, 152 tests; 100% statements (1400), branches (1057), functions (211), lines (1268), with per-file thresholds unchanged. |
| `pnpm run lint:root` (invoked by package, affected and full gates) | PASS; all root guards passed. |
| `TURBO_SCM_BASE=origin/agent/integration pnpm run gate` | PASS; 6/6 tasks, including 745 root tests; 4 tasks cached; 14.426s. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/federation-trust#test`: `test/characterization.test.ts:196` expects a different JSON key order in the serialized Ed25519 delegate key (`crv,x,kty` versus `kty,crv,x`). 281 successful tasks out of 345 scheduled before stopping; 1m58.089s. The previously blocked federation-codegen tests now PASS (26 tests). |
| `pnpm --filter @jeswr/federation-trust run test` | FAIL independently with the same snapshot mismatch; 53 passed, 1 failed. No snapshot was updated. |
| `git diff --exit-code 93217230 -- packages/federation-trust packages/solid-federation-vocab` | PASS; these paths match merged main. |
| `git diff --check` and `git show --check --oneline` for both fix commits | PASS. |

The three key authority/live-owner/replacement regressions were also run against the pre-fix
source using coverage-disabled targeted Vitest selection; all three failed as expected. Fixed
source was restored before committing and running the affected/full gates. Initial verification
caught two new test-fixture assertion mistakes and one uncovered disappearing-lock branch;
these were corrected before the passing package gate. No timeout flakes occurred.

Both requested fixes and regression coverage are complete. The conservative authority check
applies on every consent, preserving the existing expected-email check alongside subject pinning.
No dependencies were added, so no dependency policy check was needed. No manifest, lockfile,
coverage threshold or timeout setting changed beyond the prescribed merge. Build-generated,
untracked callback/client-id assets were removed; no generated artifacts are committed.
Tests use temporary stores and injected fake providers; no live credential, provider or real
op was accessed. No network remote was fetched, pushed or modified, and no PR was opened.

The full-workspace snapshot failure needs integration follow-up outside this brief. Roborev
remains unavailable (`command -v roborev` found no executable), so automated per-commit review
could not run; no tool was installed. Integration review, any follow-up bead for that unrelated
failure, and tracker updates remain with the integration owner: this lane does not modify the
external tracker or initialize a tracker in this worktree. Open questions: none.
