<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-j2y — A-036 lane report

Current validation and fixes are recorded in [Fix round 13](#fix-round-13).
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

## Fix round 4

Addressed exactly the two findings against `c7be4e7b9d97` on `lane/sst-j2y`:

- `0c7715f3` — `fix(agent-registry): filter private metadata identities`: share
  independent identifier detection between metadata sanitization and credential
  reference checks. Unlisted email/social/Matrix handles, HTTP identity URLs,
  mailto/tel/DID identifiers and international phone numbers are redacted from
  exported metadata, including policy text and direct settings-builder inputs.
  Regression tests cover placeholder-only inventories, safe policy preservation,
  every metadata field and persisted organisation RDF.
- `d896a1ed` — `fix(agent-registry): preserve to_ account identities`: reserve
  only blank identifiers and the explicit `to_confirm` marker after trimming.
  Valid `to_` email addresses and usernames retain handle hashes, matching
  historical evidence, provider conflicts and note conflicts. Tests prove the
  conflicts reach RDF as hashes, and actual placeholders remain omitted and
  invalid as evidence.
- Final report commit — `docs(agent-registry): record fix round 4 validation`
  (this file).

Conservative choice: retain the existing reference validator's recognizable
identity syntax for metadata filtering, and recognize only the placeholder marker
already present in the synthetic schema rather than inventing more reserved names.
No dependencies, manifests, lockfiles or test configuration changed;
`check:packages` was not needed. Fixtures and storage remain synthetic and offline.

All checks used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
The final package gate passed **149 tests in 3 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as its existing local baseline:

```sh
TURBO_SCM_BASE=c7be4e7b9d9752abbbb561c23d2a241f8f5da69f pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
`test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace while
the source ontology uses `jeswr.org/ns`; the generated-output comparison at line
126 also detects the corresponding committed ontology drift. These are the same
baseline namespace failures recorded in the original validation above. That package
reported **2 failed and 23 passed tests**. Turbo completed **286 of 348 tasks**
successfully (4 cached) before stopping after 10m23.55s.

The full run passed **686 root tests in 7 files** and all **149 registry tests**;
there were no registry failures or test timeout changes. No unrelated source,
fixtures or expectations were changed. The 16 untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files generated by web
builds were removed before handoff.

No in-scope work remains unfinished and there are no open questions. A green full
workspace gate remains blocked by the unchanged federation-codegen failures.
`roborev` is unavailable in this checkout, so automated per-commit review could
not run; no review tooling or model endpoint was installed or invoked. All three
commits use the required two co-author trailers. No branch switch, fetch, merge,
push, PR or modifications to another checkout were performed. This report is
committed after validation, and the checkout is left clean.

## Fix round 5

Addressed exactly the IPv6 Matrix conflict-preservation finding against
`d30b3a7eaa7a` on `lane/sst-j2y`:

- `8559d208` — `fix(agent-registry): preserve IPv6 Matrix conflicts`: preserve
  bracketed IPv6 hosts within complete note identifiers and discover notes-only
  IPv6 MXIDs, including optional ports, for both `matrix` and `matrix_bot`.
  Added 24 regression cases covering hosts with and without ports, IPv4-embedded
  IPv6, notes-only alternatives, exact port/case matching, error binding state,
  exact conflict hash sets and raw-identity exclusion from settings and RDF.
- Final report commit — `docs(agent-registry): record fix round 5 validation`
  (this file).

Conservative choice: retain the existing case-preserving Matrix normalization and
HMAC hashing; extend only note tokenization and explicit identity discovery.
No dependencies, manifests, lockfiles or test configuration changed;
`check:packages` was not needed. Fixtures and storage remain synthetic and offline.

All checks used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
All 24 added regression cases failed before the implementation change.
The final package gate passed **173 tests in 3 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as the existing local baseline:

```sh
TURBO_SCM_BASE=d30b3a7eaa7aad3bd4607cc6c5bdd3708ccc9166 pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
`test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace while
the source ontology uses `jeswr.org/ns`; the generated-output comparison at line
126 also detects the corresponding committed ontology drift. These are the same
baseline namespace failures recorded in earlier rounds. The package reported
**2 failed and 23 passed tests**. Turbo completed **272 of 346 tasks** successfully
(4 cached) before stopping after 5m26.021s.

The full run passed **686 root tests in 7 files** and all **173 registry tests**.
The log also reported `Worker exited unexpectedly` for `@jeswr/pod-access:test`
after the federation-codegen failures; no cause was established and Turbo names
federation-codegen as its failed task. No unrelated source, fixtures, expectations
or timeout configuration changed. The 16 untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files generated by web
builds were removed before handoff.

No in-scope work remains unfinished and there are no open questions. A green full
workspace gate remains blocked by the unchanged federation-codegen failures.
`roborev` is unavailable and no post-commit hook is installed in this checkout,
so automated per-commit review could not run; no review tooling or model endpoint
was installed or invoked. Both commits use the required two co-author trailers.
No branch switch, fetch, merge, push, PR or modifications to another checkout were
performed. This report is committed after validation, and the checkout is left clean.

## Fix round 6

Addressed exactly the three findings against `e7db22467209` on `lane/sst-j2y`:

- `60e175fa` — `fix(agent-registry): separate sentence punctuation`: separate
  trailing sentence marks from explicit email, Matrix and international phone
  identities. Preserve valid punctuation inside local parts, opaque handles and
  URIs. Tests cover both accounts, notes-only alternatives, quoting, Matrix IPv6
  hosts/ports, exact conflict hashes and hash-only RDF for sentence-final `!`/`?`.
- `03f9471b` — `fix(agent-registry): precompute conflict note matches`: build
  normalized token sets, channel-specific matched identity sets and conflict hashes
  once per note, then attach them using each account's normalized handles. Metadata
  redaction also normalizes each value once. A deterministic work-budget regression
  exercises the maximum 199 accounts, 20 handles each and 20 notes, with mixed email
  and case-sensitive Matrix bot identities, and verifies exact conflict membership.
- `1fd92969` — `fix(agent-registry): make fake conditional writes atomic`:
  await serialization before checking the current resource and committing without
  another await. Concurrent create/update tests prove exactly one write succeeds,
  the other fails its precondition, and only the winning RDF, ETag and write event
  are persisted.
- Final report commit — `docs(agent-registry): record fix round 6 validation`
  (this file).

Conservative choice: separate trailing punctuation only when the remaining token
is a recognizable explicit identity; retain opaque username/URI punctuation and
the existing channel normalization. The original planning DESIGN.md path is absent
in this environment; these fixes follow the existing package README and skill
without changing the design. No dependencies, manifests, lockfiles or test
configuration changed; `check:packages` was not needed. All added inputs and
transports are synthetic and offline.

The new punctuation/RDF, normalization-budget and concurrent-write regressions
reproduced their corresponding findings before the implementation changes.
All final checks used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
The final package gate passed **185 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as the existing local baseline:

```sh
TURBO_SCM_BASE=e7db2246720961f6a1ced50cd9e4ab98db0922cb pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
`test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace while
the source ontology uses `jeswr.org/ns`; the generated-output comparison at line
126 detects the corresponding committed ontology drift. These are the same two
baseline failures recorded in earlier rounds. That package reported **2 failed and
23 passed tests**. Turbo completed **277 of 349 tasks** successfully (4 cached)
before stopping after **3m17.962s**.

The full run passed all **686 root tests in 7 files** and all **185 registry tests**.
No test timeout changes or timeout flakes occurred. No unrelated source, fixtures
or expectations changed. The 16 untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files generated by web
builds were removed before handoff.

No in-scope implementation remains unfinished and there are no open questions.
A green full-workspace gate remains blocked by the unchanged federation-codegen
failures. `roborev` is unavailable and no post-commit hook is installed in this
checkout, so automated per-commit review could not run; no review tooling or model
endpoint was installed or invoked. All four commits use the required two co-author
trailers. No branch switch, fetch, merge, push, PR or modifications to another
checkout were performed. This report is committed after validation, and the
checkout is left clean.

## Fix round 7

Addressed exactly the terminal URI punctuation finding against `7acb0a8bce78`
on `lane/sst-j2y`:

- `ec4bbf7f` — `fix(agent-registry): preserve terminal URI punctuation`:
  preserve double-, single- and backtick-quoted identifier boundaries; match
  complete known account/evidence identifiers before trimming unquoted prose
  punctuation. Added 12 regression cases covering terminal periods/colons in
  URIs and opaque handles, shorter-account isolation, quotes and outside sentence
  punctuation, evidence-only URIs, hash-only conflict RDF and quote characters
  within complete identifiers.
- Final report commit — `docs(agent-registry): record fix round 7 validation`
  (this file).

Conservative choice: explicit quotes fix the identifier boundary; unquoted prose
punctuation retains the existing fallback after the complete-identifier lookup.
Channel normalization, hashing and once-per-note conflict matching remain intact.
No dependencies, manifests, lockfiles or test configuration changed;
`check:packages` was not needed. All inputs and transports are synthetic and offline.

The ten terminal-punctuation, evidence and RDF regression tests failed before the
implementation change. The two additional cases protect complete identifiers
containing quote characters. Final checks used Node `v24.22.1` via
`export PATH=/opt/node24/bin:$PATH`. The package gate passed **197 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as the existing local baseline:

```sh
TURBO_SCM_BASE=7acb0a8bce78c868495ac680099cc9625b26a9ce pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
`test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace while
the source ontology uses `jeswr.org/ns`; the generated-output comparison at line
126 detects the corresponding committed ontology drift. These are the same two
baseline failures recorded in prior rounds. That package reported **2 failed and
23 passed tests**. Turbo completed **273 of 346 tasks** successfully (4 cached)
before stopping after **3m13.128s**.

The full run passed all **686 root tests in 7 files** and all **197 registry tests**.
No test timeouts or timeout configuration changes occurred. No unrelated source,
fixtures or expectations changed. The 16 untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files generated by web
builds were removed before handoff.

No in-scope implementation remains unfinished and there are no open questions.
A green full-workspace gate remains blocked by the unchanged federation-codegen
failures. `roborev` is unavailable and no post-commit hook is installed in this
checkout, so automated per-commit review could not run; no review tooling or model
endpoint was installed or invoked. Both commits use the required two co-author
trailers. No branch switch, fetch, merge, push, PR or modifications to another
checkout were performed. This report is committed after validation, and the
checkout is left clean.

## Fix round 8

Addressed exactly the three conflict-handling findings against `4b68b802b08e`
on `lane/sst-j2y`:

- `b0e2788a` — `fix(agent-registry): preserve explicit identity conflicts`:
  preserve complete quoted spans, including URI semicolons, commas and parentheses;
  compare whole identities without matching shorter accounts inside them; recognize
  notes-only HTTP(S), DID, mailto and tel URI alternatives and retain their salted
  hashes in settings and RDF. Replace keyword-triggered conflicts with a documented
  affirmative two-identity note format, so negated, resolved and comparison prose
  cannot create active conflicts. Added 27 regression cases covering account
  isolation, three quote styles, missing alternatives, negated/resolved notes,
  hash-only RDF and binding states. The existing normalization-budget test now uses
  the explicit note format with padding to preserve its maximum 500-character size.
- Final report commit — `docs(agent-registry): record fix round 8 validation`
  (this file).

Conservative choice: only `Identity conflict: <identity> versus <identity>` (or the
existing fixture's `Main Gmail identity conflict:` prefix) asserts an active,
unresolved conflict. An explicit `. Unresolved.` suffix is accepted; additional
prose is inactive. Quoted spans remain whole even when unknown to the inventory.
No schema, dependency, manifest, lockfile or test configuration changes were needed;
`check:packages` was not applicable. All added inputs and transports are synthetic
and offline.

All 27 new regression cases reproduced the findings before the implementation fix.
Final validation used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
The package gate passed **224 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as the existing local baseline:

```sh
TURBO_SCM_BASE=4b68b802b08e6c4bf83f1b3e16fb1f0796164d11 pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
`test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace while
the source ontology uses `jeswr.org/ns`; the generated-output comparison also
detects the corresponding committed ontology drift. These are the same two
baseline failures recorded in prior rounds. That package reported **2 failed and
23 passed tests**. Turbo completed **288 of 349 tasks** successfully (4 cached)
before stopping after **3m11.968s**.

The full run passed all **686 root tests in 7 files** and all **224 registry tests**.
No test timeouts or timeout configuration changes occurred. No unrelated source,
fixtures or expectations changed. The 16 untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files generated by web
builds were removed before handoff.

No in-scope implementation remains unfinished and there are no open questions.
A green full-workspace gate remains blocked by the unchanged federation-codegen
failures. `roborev` is unavailable and no post-commit hook is installed in this
checkout, so automated per-commit review could not run; no review tooling or model
endpoint was installed or invoked. Both commits use the required two co-author
trailers. No branch switch, fetch, merge, push, PR or modifications to another
checkout were performed. This report is committed after validation, and the
checkout is left clean.

## Fix round 9

Addressed exactly the three findings against `b766cf2153a9` on `lane/sst-j2y`:

- `5e9427ee` — `fix(agent-registry): preserve private identity operands`:
  include opaque conflict operands in metadata redaction and credential-reference
  validation independently of channel inference; preserve case-sensitive URI
  components in hashes, historical evidence and conflicts; parse complete
  angle-bracketed identities before bare-token matching. Added or expanded
  settings and RDF regressions covering notes-only opaque identifiers, all metadata
  fields, decoded references, Unicode/case variants, distinct URI paths/query
  values/fragments, unmatched evidence, URI punctuation and shorter-account isolation.
- Final report commit — `docs(agent-registry): record fix round 9 validation`
  (this file).

Conservative choice: normalize only a URI's scheme to lowercase, preserving all
following components without additional canonicalization. Matrix normalization
and non-URI alias behavior remain as documented. Privacy checks separately fold
case so case-sensitive identity matching cannot weaken redaction or reference
validation. Quotes and angle brackets retain complete operands, including their
internal punctuation. No dependencies, manifests, lockfiles or test configuration
changed; `check:packages` was not applicable. All inputs and transports are
synthetic and offline.

The initial regression run reproduced the findings with **23 failures** before
the source fixes. Final checks used Node `v24.22.1` via
`export PATH=/opt/node24/bin:$PATH`. The package gate passed **247 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`,
using the supplied review head as the existing local baseline:

```sh
TURBO_SCM_BASE=b766cf2153a9350fb340aab2cc6d8b1a1b6372d3 pnpm run gate
```

`pnpm run gate:full` failed in two unchanged root tests: the disallowed-path case
at `test/agent-layers.test.mjs:509` exceeded the default 5-second timeout, and
`test/check-sdk-layers.test.mjs:328` took **57.11 ms** against its **50 ms** limit.
Root tests reported **684 passed and 2 failed**. Turbo completed **48 of 211
tasks** successfully (3 cached) before stopping after **1m35.831s**. The full gate
remains failed; no unrelated source, assertions or timeout configuration changed.

The separate root-suite retry passed **686 tests in 7 files** with the CLI timeout
override permitted by the brief:

```sh
pnpm run test:root --testTimeout=30000 --hookTimeout=30000
```

This retry does not replace the failed full-workspace gate. No in-scope
implementation remains unfinished and there are no open questions. A green
full-workspace gate remains blocked by the two root-test timing failures above.
`roborev` is unavailable and no post-commit hook is installed in this checkout,
so automated per-commit review could not run. No review tooling or model endpoint
was installed or invoked. Both commits use the required two co-author trailers.
All work remained in this checkout on `lane/sst-j2y`; no branch switch, fetch,
merge, push, PR or modifications to another checkout were performed. No generated
untracked files remain. This report is committed after validation, and the
checkout is left clean.

## Fix round 10

Addressed exactly the two findings against `a3233c56f714` on `lane/sst-j2y`:

- `e919d2a6` — `fix(agent-registry): screen references and parse full operands`:
  screen both original and decoded credential references before settings export or
  storage; parse the complete affirmative conflict-note grammar before matching
  identities, preserving bare URI semicolons, commas and parentheses. Keep shorter
  accounts isolated and retain complete notes-only alternatives as salted hashes
  in settings and RDF. Preserve privacy screening for inactive notes and sentence
  punctuation handling for email, Matrix and phone operands. Added or expanded
  regressions covering all reference components, identifiers supplied by accounts,
  evidence, active and resolved notes, both conflict operands, binding states,
  complete URI boundaries and resolved or extra-prose rejection.
- Final report commit — `docs(agent-registry): record fix round 10 validation`
  (this file).

Conservative choice: bare URI operands retain terminal punctuation. Quotes or
angle brackets separate an identity from following sentence punctuation. The
existing affirmative prefixes and optional `. Unresolved.` suffix remain the
supported conflict grammar. No dependencies, manifests, lockfiles or test
configuration changed; `check:packages` was not applicable. All added test inputs
use synthetic identifiers and in-memory transports.

The initial diagnostic run reproduced all 21 newly added failing cases; its
export suite also required fresh dist output, supplied by the normal build.
Final validation used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`.
The package gate passed **277 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

After removing generated web files, the final affected repository gate passed
**5/5 tasks**, including `pnpm run lint:root` (3 cached). The local
`agent/integration` ref is unavailable, so the supplied review head was used as
the existing local baseline:

```sh
TURBO_SCM_BASE=a3233c56f7145921723e95fcccd75449f8ee5fa3 pnpm run gate
```

An intermediate affected run also passed **42/42 tasks** while generated web
files broadened its scope. The 16 generated
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files were removed before
the final affected gate and handoff.

`pnpm run gate:full` remains failed. Its three attempts stopped in unchanged
projects:

- Initial attempt: `@jeswr/app-suite#build` failed in Next.js's Google font loader
  while processing `packages/suite-ui/dist/fonts.js`, with
  `TypeError: Cannot read properties of null (reading '1')`.
  Turbo reported **83/222 successful tasks**, 4 cached, after **41.594s**.
- Retry: `@jeswr/federation-codegen#test` reported **2 failed and 23 passed tests**.
  `test/generator.test.ts:81` expects the legacy `w3id.org` bookmarks namespace
  while the ontology uses `jeswr.org/ns`; the generated-output comparison also
  detects the corresponding ontology drift. These failures were recorded in
  earlier rounds. Turbo reported **265/344 successful tasks**, 58 cached, after
  **4m9.373s**. Both earlier attempts passed all **686 root tests in 7 files**.
- Final attempt against `e919d2a6`: `@jeswr/rdf-engine#test` reported **1 failed
  and 108 passed tests**. `src/contract.real.test.ts:252`, the LocalIndex
  SELECT/ASK/CONSTRUCT test over 1,000 resource graphs, exceeded its default
  **5,000ms** timeout. Turbo reported **165/197 successful tasks**, 159 cached,
  after **51.785s**. This attempt replayed all **277 passing registry tests**.

No unrelated source, assertions or timeout configuration changed. No in-scope
implementation remains unfinished and there are no open questions. A green
full-workspace gate remains blocked by the unrelated failures above. `roborev`
is unavailable and no post-commit hook is installed in this checkout, so automated
per-commit review could not run; no review tooling or model endpoint was installed
or invoked. Both commits use the required two co-author trailers. All work
remained in this checkout on `lane/sst-j2y`; no branch switch, fetch, merge, push,
PR or modifications to another checkout were performed. This report is committed
after validation, and the checkout is left clean.

## Fix round 11

Addressed exactly the inactive-note privacy finding against `aabbc981c5ce`
on `lane/sst-j2y`:

- `850a830d` — `fix(agent-registry): retain inactive note identities`: retain
  private note candidates independently of conflict activation and the position
  of `versus`. The shared privacy set screens both metadata and original/decoded
  credential references. Expanded settings and offline importer regressions for
  resolved and negated prefixes, comparison prose, extra prose and single-identity
  notes, including both operand positions. Tests verify settings and RDF redaction,
  unchanged inactive conflict state, and reference rejection before storage writes.
- Final report commit — `docs(agent-registry): record fix round 11 validation`
  (this file).

Conservative choice: every identifier candidate in inactive prose remains private,
including opaque candidates whose channel cannot be inferred. This may redact
matching metadata prose as well. The affirmative conflict grammar is unchanged.
No dependencies, manifests, lockfiles or test configuration changed;
`check:packages` was not applicable. All added test inputs are synthetic and all
importer transports are in memory.

The diagnostic run reproduced **21 failing cases** before the fix. All **35**
targeted cases passed after it. Validation used Node `v24.22.1` via
`export PATH=/opt/node24/bin:$PATH`. The package gate passed **309 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including root lint and all
309 package tests, in **10.428s**. The local `agent/integration` ref is unavailable,
so the supplied review head was used as the existing local baseline:

```sh
TURBO_SCM_BASE=aabbc981c5cee6c56fef07f0495f1f309614870a pnpm run gate
```

`pnpm run gate:full` failed in the unchanged `@jeswr/federation-codegen#test`:
**2 failed and 23 passed tests**. `test/generator.test.ts:81` expects the legacy
`w3id.org` bookmarks namespace while the ontology uses `jeswr.org/ns`; the
generated-output comparison at line 126 also detects the corresponding ontology
drift. Both failures were recorded in earlier rounds. Turbo reported
**212/291 successful tasks**, 4 cached, after **5m23.798s**. All **686 root tests
in 7 files** passed, and the run replayed all **309 passing registry tests**.
The full gate used telemetry disabled and loopback proxies to keep external
network requests offline:

```sh
export NEXT_TELEMETRY_DISABLED=1
export HTTP_PROXY=http://127.0.0.1:9
export HTTPS_PROXY=http://127.0.0.1:9
export ALL_PROXY=http://127.0.0.1:9
export NODE_USE_ENV_PROXY=1
pnpm run gate:full
```

No unrelated source, assertions or timeout configuration changed. No in-scope
implementation remains unfinished and there are no open questions. A green
full-workspace gate remains blocked by the unrelated failures above. `roborev`
is unavailable and no post-commit hook is installed in this checkout, so automated
per-commit review could not run; no review tooling or model endpoint was installed
or invoked. Both commits use the required two co-author trailers. All work
remained in this checkout on `lane/sst-j2y`; no branch switch, fetch, merge, push,
PR or modifications to another checkout were performed. No generated untracked
files remain. This report is committed after validation, and the checkout is
left clean.

## Fix round 12

Addressed exactly the ordinary-note false-positive finding against `da27bbc18c88`
on `lane/sst-j2y`:

- `85215f58` — `fix(agent-registry): exclude prose from private identities`:
  extract known, recognizable or explicitly delimited identities from inactive
  notes instead of adding every prose word to the privacy set. Preserve opaque
  handles in quotes, backticks, angle brackets and parentheses. Add 19 regressions
  covering unchanged settings and original/encoded/profile references, offline
  RDF imports and idempotence, metadata redaction, known account/evidence handles,
  and continued rejection of private references before storage writes.
- Final report commit — `docs(agent-registry): record fix round 12 validation`
  (this file).

Conservative choice: opaque mentions in inactive prose remain private when known
or explicitly delimited; ordinary bare words are not inferred to be handles.
Recognizable identity formats and all parsed active-conflict operands remain
private. Conflict activation is unchanged. No dependencies, manifests, lockfiles
or test configuration changed; `check:packages` was not applicable. All new
fixtures are synthetic and all importer transports are in memory.

The new ordinary-prose regressions reproduced both reference rejection and
metadata over-redaction before the fix. Final validation used Node `v24.22.1`
via `export PATH=/opt/node24/bin:$PATH`. The package gate passed **328 tests in
4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`
and all 328 registry tests, in **15.712s** (0 cached). The local `agent/integration`
ref is unavailable, so the supplied review head was used as the existing local
baseline:

```sh
TURBO_SCM_BASE=da27bbc18c882616cc63c41f4f813e074d7b9bcd pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
**2 failed and 23 passed tests**. `test/generator.test.ts:81` expects the legacy
`w3id.org` bookmarks namespace while the ontology uses `jeswr.org/ns`; line 126
also detects the corresponding generated ontology drift. These failures were
recorded in earlier rounds. Turbo reported **288/350 successful tasks**, 4 cached,
after **5m23.256s**. All **686 root tests in 7 files** passed, and the run replayed
all **328 passing registry tests**. Repository gates used the following environment
to disable telemetry and keep external requests offline:

```sh
export NEXT_TELEMETRY_DISABLED=1
export HTTP_PROXY=http://127.0.0.1:9
export HTTPS_PROXY=http://127.0.0.1:9
export ALL_PROXY=http://127.0.0.1:9
export NODE_USE_ENV_PROXY=1
pnpm run gate:full
```

Removed the 16 generated `apps/pod-*/web/public/{callback.html,clientid.jsonld}`
files after the full gate. No unrelated source, assertions or timeout configuration
changed. No in-scope implementation remains unfinished and there are no open
questions. A green full-workspace gate remains blocked by the unrelated failures
above. `roborev` is unavailable and no post-commit hook is installed, so automated
per-commit review could not run; no review tooling or model endpoint was installed
or invoked. Both commits use the required two co-author trailers. All work remained
in this checkout on `lane/sst-j2y`; no branch switch, fetch, merge, push, PR or
modifications to another checkout were performed. This report is committed after
validation, and the checkout is left clean.

## Fix round 13

Addressed exactly the two findings against `1c89f4006976` on `lane/sst-j2y`:

- `6b66ef63` — `fix(agent-registry): bound operands and retain IDNA emails`:
  stop parenthesized operands at their balanced outer boundary and refuse spans
  containing extra prose or additional operands. Collect private note mentions
  independently of conflict activation, including nested mentions in active
  operands. Recognize email alternatives with IDNA ASCII TLD labels. Add 16
  regressions covering separate and unbalanced parenthesized spans, reference
  rejection before storage writes, metadata redaction, nested URI parentheses,
  notes-only IDN alternatives in settings and RDF, and idempotence.
- Final report commit — `docs(agent-registry): record fix round 13 validation`
  (this file).

Conservative choice: malformed or compound parenthesized operands do not activate
a conflict, while their independently recognized private mentions remain screened.
Balanced nested parentheses preserve the complete operand. Ordinary prose is
still excluded from the privacy set. No dependencies, manifests, lockfiles or test
configuration changed; `check:packages` was not applicable. All new inputs are
synthetic and importer transports remain in memory.

The targeted diagnostic reproduced **10 failing cases** before the fix. Final
validation used Node `v24.22.1` via `export PATH=/opt/node24/bin:$PATH`. The package
gate passed **344 tests in 4 files**:

```sh
pnpm --filter @jeswr/agent-registry run lint
pnpm --filter @jeswr/agent-registry run build
pnpm --filter @jeswr/agent-registry run typecheck
pnpm --filter @jeswr/agent-registry run test
```

The affected repository gate passed **5/5 tasks**, including `pnpm run lint:root`
and all 344 registry tests, in **12.489s** (0 cached). The local
`agent/integration` ref is unavailable, so the supplied review head was used as
the existing local baseline:

```sh
TURBO_SCM_BASE=1c89f4006976cc58d0a45cc93794532e21256054 pnpm run gate
```

`pnpm run gate:full` failed in unchanged `@jeswr/federation-codegen#test`:
**2 failed and 23 passed tests**. `test/generator.test.ts:81` expects the legacy
`w3id.org` bookmarks namespace while the ontology uses `jeswr.org/ns`; line 126
also detects the corresponding generated ontology drift. These failures were
recorded in earlier rounds. Turbo reported **220/291 successful tasks**, 4 cached,
after **3m31.768s**. All **686 root tests in 7 files** passed, and the run replayed
all **344 passing registry tests**. Repository gates used this environment to
disable telemetry and keep external requests offline:

```sh
export NEXT_TELEMETRY_DISABLED=1
export HTTP_PROXY=http://127.0.0.1:9
export HTTPS_PROXY=http://127.0.0.1:9
export ALL_PROXY=http://127.0.0.1:9
export NODE_USE_ENV_PROXY=1
pnpm run gate:full
```

No unrelated source or assertions changed, and no generated untracked files
remain. No in-scope implementation remains unfinished and there are no open
questions. A green full-workspace gate remains blocked by the unrelated failures
above. `roborev` is unavailable and no post-commit hook is installed, so automated
per-commit review could not run; no review tooling or model endpoint was installed
or invoked. Both commits use the required two co-author trailers. All work
remained in this checkout on `lane/sst-j2y`; no branch switch, fetch, merge, push,
PR or modifications to another checkout were performed. This report is committed
after validation, and the checkout is left clean.
