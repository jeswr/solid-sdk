<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-j2y — A-036 lane report

Current validation and fixes are recorded in [Fix round 3](#fix-round-3).
The original implementation report below is historical.

Implemented `@jeswr/agent-registry` on `lane/sst-j2y`. Only the package, the workspace
lockfile, and this report changed. No remotes, providers, real registry, credentials,
1Password items, daemon stores, or real pods were accessed. Nothing was pushed.

## Commits

- `01dd90cb` — `feat(agent-registry): import private account inventory as RDF`:
  bounded YAML import; injected reader/salt/storage ports; salted HMAC handle and
  resource ids; typed RDF and N3 Writer; owner-only ACL-before-content writes;
  conditional/idempotent replacement; synthetic 28-account fixture plus Telegram;
  ODI correction and hash-only identity conflicts; adversarial importer tests.
- `a33b7bdc` — `feat(agent-registry): port privacy-safe settings assessments`:
  browser-safe `./settings`; pilot account/settings inventory and capability layers;
  historical evidence matched by channel and exact normalised handle; unmatched
  evidence retained as hashes; default-deny assessments; README and local skill.
- `0b0368ef` — `fix(agent-registry): validate direct settings references`:
  apply credential-reference validation to direct public settings-builder calls too.
- Final report commit — `docs(agent-registry): record lane validation` (this file).

All commits use the requested unsigned invocation, git identity, and co-author trailer.

## Validation

Final package checks all passed:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

63 tests in 3 files passed. Acceptance checks assert 29 RDF Account resources,
ODI email correction without changing Teams, an explicit RDF identityConflict,
no fixture handles in RDF/settings/ACLs/reports/resource URLs, retained op references,
all four restrictions false, ACL persistence before each content write, stable resource
URLs, no additional writes on repeated import, and conditional updates. Failure tests
cover malformed/oversized/tagged/aliased/duplicate YAML, unsafe ids, credential values,
short/unavailable salt, private identifiers in references, invalid timestamps, stale
observations, ACL/read/write failures, missing ETags, concurrent modification, and
bounded local-file reads including symlink and invalid UTF-8 rejection.

The package has `securityCritical: false`; no coverage threshold is configured.
No test timeout changes or timeout flakes were needed.

`pnpm run lint:root` passed, including the SDK/agent layer guards, workspace guards,
lockfile transport guard, fetch guard, tokens and all 74 contrast pairs.

`TURBO_SCM_BASE=agent/integration pnpm run gate` failed after successful root lint:
the named local `agent/integration` ref does not exist in this checkout. No branch was
created, switched, fetched or merged to work around it.

The fallback command used the supplied checkout base:

```sh
TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate
```

Its final run failed in unchanged `@jeswr/federation-codegen#test`: two assertions in
`tools/federation-codegen/test/generator.test.ts` expect old `w3id.org` namespaces,
while the source ontology uses `jeswr.org/ns`; committed generated ontology output
also differs. That run completed 142 tasks (134 cached) before stopping. An earlier
fallback attempt overlapped the frozen install check and failed with `tsc: not found`;
the sequential rerun replaced that transient result with the namespace failure above.

`pnpm run gate:full` was also run. The first run completed 224 of 294 tasks before
stopping at the same two unchanged federation-codegen assertions. Final rerun result:
failed at the same federation-codegen test task, with 144 tasks successful (138 cached)
before stopping; no registry failure was reported.

No federation-codegen source, fixtures or expectations were changed. The package's
own checks pass independently. Generated app `web/public/{callback.html,clientid.jsonld}`
files from workspace builds are removed before handoff; they are outside lane scope.

## Dependency checks

Before adding the YAML parser required for the YAML input and the prescribed RDF stack:

```sh
pnpm run check:packages @rdfjs/wrapper n3 @types/n3 yaml
```

PASS: all four packages cleared policy, existence and age checks in full npm mode.
Dependencies are `@rdfjs/wrapper`, `n3`, `yaml`, with development types `@types/n3`.
`pnpm install --ignore-scripts --prefer-offline` succeeded. Lifecycle scripts remained
disabled. pnpm also rewrote Vite/Vitest optional-peer snapshots for the YAML dependency.
Existing workspace peer/deprecation warnings were reported; no policy override was used.

`pnpm install --frozen-lockfile --offline --ignore-scripts` passed: lockfile up to date,
resolution skipped, dependencies already up to date.

## Conservative interpretations and limits

- The base has scaffold-only agent-model/agent-registry and no imported personal-agent.
  The allowed read-only pilot source supplied the inventory schema. The canonical
  agent namespace is local to the RDF module; no unrelated package was changed.
- Only the pilot's account/settings inventory and assessment surfaces were ported.
  Scheduling, server/UI, and TypeSafe hosted triage remain outside this package.
- The inferred v1 YAML schema is strict, with explicit account/connector `credential_ref`
  extensions. Unknown input fields fail closed. Daemon profile references require an
  explicit `profile:name` prefix; ambiguous opaque strings are refused.
- Inventory `connected` is historical setup evidence and maps to `setup-required`.
  It never establishes a verified current connection or authorises an operation.
- Stable resource ids hash registry ids separately from handles. The injected salt
  must remain stable in the production daemon store; no fallback salt is generated.
- Only explicit handle-matching conflict notes/evidence attach to an account. Raw
  notes, labels, source paths and unknown identifiers are not published. Conflicting
  alternatives are retained as hashes rather than silently merged.
- Telegram addition is a disabled-by-default bot control account with no invented
  handle or credential. Personal Telegram/MTProto remains deferred (J8).
- Re-import does not delete removed accounts. A changed resource resets restrictions
  to false; partial storage failures abort and can be safely retried. Signed control,
  live health and mandate enforcement belong to the other agent packages.
- The local StorageClient seam is intentional per the dispatcher. Its production ACL
  adapter must persist replacement owner-only grants before account content exists.

## Unfinished / blocked / open questions

No in-scope implementation remains unfinished. A green workspace-wide gate is blocked
by the unchanged federation-codegen namespace assertions. The requested integration-base
gate additionally needs its missing local ref. `roborev` is not installed and there is
no active post-commit hook in this checkout, so automated per-commit review was unavailable;
no review tooling or model endpoint was installed or invoked.

No implementation questions remain. The dispatcher should resolve workspace baseline
validation/review tooling outside this implementation lane. No PR or merge was attempted,
and the bead is left for the dispatcher to close on merge.

## Fix round 2

Addressed the three findings against `08b592db2f67` on `lane/sst-j2y`:

- `fc67af5f` — `fix(agent-registry): reject unlisted private references`: reject
  recognizable email, Matrix/social handle, identity URI and international phone
  syntax in literal or decoded references independently of account/evidence/note
  completeness. Tests cover every reference component with no known handles and
  placeholder-only imports, asserting rejection before any storage operation.
- `0f95b82f` — `fix(agent-registry): preserve Matrix bot identity case`: use the
  existing Matrix case-preserving normalization for `matrix_bot`; exercise distinct
  hashes, evidence matching, provider conflicts, unmatched evidence and note matching
  for both Matrix channels.
- `51e332e2` — `fix(agent-registry): match complete conflict identities`: extract
  whole identifiers from conflict notes and compare with each channel's normalization.
  Tests cover email prefixes/suffixes/aliases/apostrophes, Matrix domain suffixes,
  bare handles, Unicode and quoted mentions, exact conflict hash sets, and RDF output
  that leaves Alice unaffected by a conflict mentioning only Malice.
- Report commit — `docs(agent-registry): record fix round 2 validation` (this file).

Conservative choice: retain the existing reference format and fail closed on
recognizable identifying syntax even when the inventory contains only placeholders.
Valid references remain verbatim. No dependencies, manifests or lockfiles changed;
`check:packages` was not needed. All fixtures and transports remain synthetic/offline.

All checks below used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`;
the default shell Node 22 was refused by pnpm's engine guard before any test ran.

The final package gate passed, with **109 tests in 3 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

`pnpm run lint:root` passed. The affected gate also passed (5/5 tasks), using
the supplied review head as its local baseline:

```sh
TURBO_SCM_BASE=08b592db2f67c3e38c1675cd35af5f9ff46aba0a pnpm run gate
```

`pnpm run gate:full` failed in unchanged root test
`test/check-sdk-layers.test.mjs:328`: the pathological-spec timing assertion took
57.6024 ms against its 50 ms ceiling. Turbo completed 44 tasks before stopping.
No registry failure was reported. The first standalone `pnpm run test:root`
rerun passed that assertion but failed a different unchanged test in
`test/agent-layers.test.mjs:509` at the default 5-second timeout (685/686 tests
passed). No test configuration or unrelated source was changed.

The CLI-timeout retry permitted by the brief passed **686 tests in 7 files**:

```sh
pnpm run test:root --testTimeout=30000 --hookTimeout=30000
```

The full-workspace gate remains recorded as failed; the successful standalone run
does not replace it. Its timing failure and the standalone default-timeout failure
are outside this fix's package scope. The package gate required no timeout changes.

`roborev` remains unavailable in this checkout, so automated per-commit review could
not run. No tooling or model endpoint was installed or invoked. No in-scope fixes
remain unfinished and there are no implementation questions. No branch switch,
fetch, merge, push, PR or changes to another checkout were performed. The final
report is committed after validation, and the checkout is left clean.

## Fix round 3

Addressed the two conflict-preservation findings against `ea00a9305534` on
`lane/sst-j2y`:

- `eca20ef0` — `fix(agent-registry): preserve formatted phone conflicts`: keep
  international phone mentions whole, including spaces, parentheses and dots.
  Preserve adjacent identifier suffixes so longer identifiers cannot match an
  account's prefix. Tests cover quoted mentions, exact conflict hashes, longer
  identifiers, and number fragments that must not acquire conflicts.
- `4c3da190` — `fix(agent-registry): retain notes-only conflict alternatives`:
  discover explicit Matrix MXIDs and international phone identities alongside
  email alternatives. Apply channel normalization before hashing, preserving
  Matrix/Matrix bot case. Settings and offline RDF tests prove alternatives absent
  from accounts and evidence survive as hashes, binding state becomes `error`,
  and neither raw identity appears in output.
- Report commit — `docs(agent-registry): record fix round 3 validation` (this file).

Conservative choice: retain existing normalization and telephone formatting in
hashes; discover only explicit email, MXID and international phone syntax from
notes, without inferring identities from ambiguous prose or bare usernames.
No dependencies, manifests, lockfiles or test configuration changed.
`check:packages` was not needed. All added fixtures and transports are synthetic
and offline.

All validation used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
The final package gate passed, with **124 tests in 3 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected gate passed **5/5 tasks**, including `pnpm run lint:root`, using the
supplied review head as the local baseline:

```sh
TURBO_SCM_BASE=ea00a93055346b4fe78cbb97c90bd942a5607450 pnpm run gate
```

`pnpm run gate:full` failed at unchanged root tests in
`test/agent-layers.test.mjs:509`: four disallowed-path cases exceeded Vitest's
default 5-second timeout. Root tests reported 682 passed and 4 timed out;
Turbo completed 74 of 238 tasks before stopping. No registry failure was reported.

The standalone retry with CLI timeouts permitted by the brief passed **686 tests
in 7 files**:

```sh
pnpm run test:root --testTimeout=30000 --hookTimeout=30000
```

The full-workspace gate remains recorded as failed; the standalone retry does not
replace it. No unrelated source or timeout configuration was changed.

No in-scope implementation remains unfinished and there are no open questions.
A green full-workspace gate remains blocked by the root-test timeout failures.
`roborev` is still unavailable and no post-commit hook is installed in this
checkout, so automated per-commit review could not run. No tooling or model
endpoint was installed or invoked. No branch switch, fetch, merge, push, PR or
changes to another checkout were performed. The final report is committed after
validation, and the checkout is left clean.
