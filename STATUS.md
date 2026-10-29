<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-4s8h — MCP-12 lane status

Implemented on `lane/sst-4s8h`, originally based on
`917d3be9c7967622829adc43c1aaabb0964ec993`. Round 5 integrates local `origin/main`
at `73879200bba1baa53b1634101a0e33e113b6d55c`.
No push, PR, publish, branch switch, network remote fetch/merge, or dependency lifecycle scripts.

## Codex fix round 4 — compressed profile responses

Review: `solid-sdk-lane-sst-4s8h-37ecac1d8f12.md`, read in full. Its one
finding is addressed on `lane/sst-4s8h`, based on
`37ecac1d8f12a900eb788314c9862e5b092e47a7`.

- `fd96cf79` — `fix: decode compressed WebID profile responses`: stream-decode
  gzip (including x-gzip), deflate and Brotli responses from the existing
  DNS-pinned anonymous profile dispatcher. Decode supported encoding chains in
  reverse order, with at most five layers. Preserve response headers, status and
  URL; leave redirect bodies available for the existing cancellation path.
- Final commit — `docs: record compressed profile fix validation`: this status
  update, committed last.

Only the CLI transport and its existing discovery regression test file changed,
plus this status update. Twenty-one additional regression cases cover compressed
Type Index discovery through both fetch and PodPort, case-insensitive encodings,
stacked encodings, chunked bodies, preserved metadata, malformed data,
unsupported chains, and compressed redirect cancellation. The initial regression
run reproduced eight compressed-profile discovery failures before the fix. The
final discovery file passes all 80 tests. Existing bodyless-response cases also
exercise Content-Encoding headers. DNS and transport I/O use fixtures/mocks.

Validation on Node `v24.22.1`, pnpm `10.4.1`. Git transport was disabled for
builds and gates; no dependency installation or addition was needed
(`check:packages` is not applicable).

```sh
PATH=/opt/node24/bin:$PATH GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm exec turbo run build --filter='@jeswr/solid-mcp^...' --concurrency=4
```

PASS: four workspace dependency builds.

```sh
PATH=/opt/node24/bin:$PATH GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never bash -c 'pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test'
```

PASS: lint, build, typecheck and all **385 tests / 10 files**.

```sh
PATH=/opt/node24/bin:$PATH GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never TURBO_SCM_BASE=37ecac1d8f12a900eb788314c9862e5b092e47a7 pnpm run gate
```

PASS: root lint and guards; **18/18 tasks**, four cached. Includes solid-mcp
and its personal-agent dependent (**537 tests / 56 files**).

```sh
PATH=/opt/node24/bin:$PATH GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm run gate:full
```

FAIL outside this fix: **306 successful / 360 tasks**, 14 cached, stopping at
`@jeswr/federation-trust#test`, `test/characterization.test.ts:196`,
“delegation credential structure is stable”. The existing snapshot expects
serialized JWK keys in `crv,x,kty` order; this runtime emits `kty,crv,x`.
`git diff 37ecac1d8f12a900eb788314c9862e5b092e47a7 -- packages/federation-trust`
is empty. The full run passed all **745 root tests / 9 files** and the
**385 solid-mcp tests / 10 files**. No unrelated source or snapshot changed.

Generated app `web/public/{callback.html,clientid.jsonld}` files were removed
after validation. `git diff --check` passes. No implementation work or open
questions remain for this finding; full-workspace validation retains the
inherited snapshot failure. `roborev` is unavailable (`command -v roborev`
finds no executable), so automated per-commit verdicts could not be obtained.
Reviewer configuration is unchanged.

## Fix round 5 — integrate main

- `65887325` — `chore: integrate main into stdio lane`: fetch from the prescribed
  local origin (`/home/runner/work/solid-sdk`) and merge `origin/main`. Main remains
  authoritative outside the existing lane changes. Resolve the README conflict
  with main's Node requirement and preserve the stdio configuration documentation.
- Final commit — `docs: record main integration validation`: this status update,
  written and committed last.

`packages/solid-mcp/src/pod.ts` is byte-for-byte identical to main. Its PodPort,
tool registry, canonical tools, aliases and HTTP entry point are retained. The
fetch adapter recognizes the CLI's existing guarded anonymous transport through
an internal WeakSet, so configured external WebID discovery still follows bounded,
validated, credential-free same-origin redirects. Ordinary injected fetch functions
retain main's manual redirect policy. In-pod profiles retain the adapter's scoped
redirect loop and fresh DPoP proofs. No public API or dependency was added.

Preserve all lane regressions; extend the redirected discovery test to exercise
both legacy fetch configuration and PodPort. Real stdio subprocess tests now call
the canonical tools and all compatibility aliases, including both write names'
read-only enforcement. The earlier absence of MCP-01's data seam is resolved by
the main integration; earlier rounds below describe their original baselines.

Seed the lockfile from main and regenerate it with pnpm, rather than merge its
text. The successful command was:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm --filter @jeswr/solid-mcp install --lockfile-only --offline --ignore-scripts --config.dedupe-peer-dependents=false
```

The generated diff from main adds the lane's existing workspace `solid-dpop`
edge and adjusts one shared Vitest coverage peer resolution. Initial unfiltered
and default-deduplication attempts tried to resolve inherited Git branch pins;
disabled Git transport prevented network access. The filtered command above
succeeded without Git resolution. The subsequent frozen offline installation
passed with zero downloads and lifecycle scripts disabled. Main now provides
fetch-rdf as a workspace package, built locally before the package checks.

Validation on Node `v24.22.1`, pnpm `10.4.1` (Git transport disabled for builds,
tests and gates):

- PASS: dependency-first build of all four solid-mcp workspace dependencies.
- PASS: lint, build, typecheck and test for both touched packages:
  solid-mcp **355 tests / 10 files**, solid-dpop **82 tests / 6 files**.
  Existing solid-dpop lint warnings remain non-fatal.
- PASS: `pnpm run lint:root`, including every workspace guard.
- PASS: `pnpm run test:root`, **745 tests / 9 files**.
- FAIL outside the lane: `pnpm run gate`, using
  `TURBO_SCM_BASE=73879200bba1baa53b1634101a0e33e113b6d55c`:
  **329 successful / 374 tasks**, 4 cached. Stops at
  `@jeswr/federation-trust#test`, `test/characterization.test.ts:196`,
  “delegation credential structure is stable”. The snapshot expects serialized
  JWK keys in `crv,x,kty` order; the runtime emits `kty,crv,x`.
- FAIL outside the lane: final `pnpm run gate:full` attempt:
  **335 successful / 372 tasks**, 208 cached, with the same federation-trust
  snapshot failure. All 745 root tests passed in this attempt. The first full
  attempt stopped on a 5000 ms timeout at `test/agent-layers.test.mjs:509`;
  its 13 affected cases passed separately, and the full-gate retry passed the
  entire root suite. Neither failing file nor federation-trust differs from main.

Generated app `web/public/{callback.html,clientid.jsonld}` files were removed
after validation. `git diff --check origin/main` passes for the lane changes.
No unrelated source, snapshot or configuration was changed during resolution.
No implementation work or open questions remain for this fix round; a green
workspace gate is blocked by the inherited snapshot mismatch. `roborev` is still
unavailable (`command -v roborev` finds no executable), so automated per-commit
verdicts could not be obtained; reviewer configuration is unchanged.

## Fix round 4 — anonymous redirect destination safety

Review: `solid-sdk-lane-sst-4s8h-b7e9674fe4b7.md`, read in full with the original
and earlier fix briefs. Its one high-severity finding is addressed.

- `ddd8533f` — `fix: guard anonymous profile redirect destinations`: validate each
  anonymous redirect target with `@jeswr/guarded-fetch`'s `assertSafeUrl`, including
  scheme, userinfo, hostname, literal-address and every-resolved-address checks.
  Redirects must remain on the original profile origin, matching the requested
  same-origin policy; scheme-relative locations are refused as in the existing
  authenticated pod guard. HTTP/loopback development remains allowed only when
  that exact origin is explicitly configured by `podRoot` or `webId`. Credentials
  remain stripped on every anonymous hop, with the existing five-hop bound.
- Final commit — `docs: record anonymous redirect validation`: this status update,
  written and committed last.

Only the CLI transport and its existing discovery regression test file changed,
plus this status update. The tests now cover private IPv4/IPv6 and alternate IP
encodings, metadata hosts, same-origin DNS changes, mixed public/private answers,
empty/failed DNS resolution, unsafe schemes/userinfo, origin/port escapes, and
configured loopback allowances (including refusal of private DNS answers).
DNS and fetch are mocked; no live service or DNS requests are needed. The initial
regression run failed 27 tests before the transport change; the final discovery
file passes 49 tests, including 29 additions and the existing discovery cases.

Validation on Node `v24.22.1`, pnpm `10.4.1`:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm exec turbo run build --filter='@jeswr/solid-mcp^...' --concurrency=4
```

PASS: build the three workspace dependencies, 3/3 tasks successful.

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never bash -c 'pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test'
```

PASS: lint, build, typecheck, and all 180 tests in 7 files.

```sh
pnpm run lint:root
```

PASS: Biome and all root guards.

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never TURBO_SCM_BASE=e500fa2444ea4932c37d19c681e88d9cf6208e9a pnpm run gate
```

PASS: 9/9 tasks successful (3 cached).

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm run gate:full
```

FAIL outside this fix: 164 successful / 228 tasks (7 cached), stopping at
`@jeswr/federation-trust#test`, `test/characterization.test.ts:196`,
“delegation credential structure is stable”. As previously recorded, the snapshot
expects serialized JWK keys in `crv,x,kty` order; the runtime emits `kty,crv,x`.
`git diff e500fa2444ea4932c37d19c681e88d9cf6208e9a -- packages/federation-trust`
is empty. No unrelated source or snapshots changed.

As in earlier rounds, the installed Git-pinned `fetch-rdf` artifact lacked `dist`.
Its exact pinned source at `a8359a3764cb6b3c763e09ea211542a5dc7edc33` was read
with `git archive` from the existing local temporary cache into this checkout's
ignored `node_modules/.cache`, compiled with installed dependencies, and copied
only to this checkout's ignored installed artifact. Git transport was disabled
during builds/gates. No remote clone/fetch, dependency addition, installation, or
lifecycle script ran; `check:packages` is not applicable to this fix.

`git diff --check` passes. No implementation work or open questions remain for
this review. Full-workspace validation retains the unrelated failure above.
`roborev` remains unavailable (`command -v roborev` finds no executable), so
automated per-commit verdicts could not be obtained; reviewer configuration is
unchanged.

## Fix round 3 — in-pod WebID profile redirects

Review: `solid-sdk-lane-sst-4s8h-98263b131213.md`, read in full. Exactly its one
finding is addressed; only `packages/solid-mcp/src/pod.ts` and the existing
profile-discovery regression test file changed, plus this status update.

- `07a284d4` — `fix: follow scoped WebID profile redirects`: route in-pod profile
  reads through the existing `scopedFetch` guard. Redirects stay within the pod,
  obey the existing ten-hop limit, and receive a fresh DPoP proof per request.
  Off-pod profile discovery retains its existing anonymous transport.
- Final commit — `docs: record WebID redirect fix validation`: this status update,
  written and committed last.

Eight new regressions cover 301/302/303/307/308 profile redirects, relative
locations, real ES256 signatures and URI/token binding on every hop, unique
proof IDs, foreign-origin and same-origin out-of-pod redirects, the hop limit,
and best-effort fallback scanning. All eight failed before the fix and pass
after it; the discovery test file now passes 20 tests.

Validation on Node `v24.22.1`, pnpm `10.4.1`:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never bash -c 'pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test'
```

PASS: lint, build, typecheck, and all 151 tests in 7 files.

```sh
pnpm run lint:root
```

PASS: Biome and all root guards.

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never TURBO_SCM_BASE=e500fa2444ea4932c37d19c681e88d9cf6208e9a pnpm run gate
```

PASS: 8/8 tasks successful (3 cached).

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm run gate:full
```

FAIL outside this fix: 214 successful / 275 tasks (7 cached), stopping at
`@jeswr/federation-trust#test`, `test/characterization.test.ts:196`,
“delegation credential structure is stable”. The existing snapshot expects
serialized JWK keys in `crv,x,kty` order; the runtime emits `kty,crv,x`.
`packages/federation-trust` has no diff from the supplied lane base `e500fa24`.
The full run also emitted a `solid-offline` test-worker `EPIPE` while stopping;
its reported failed task is federation-trust. The solid-mcp gate tasks passed.
No unrelated source or snapshots were changed. Generated app
`web/public/{callback.html,clientid.jsonld}` files were removed after validation.

As in the original implementation, the installed Git-pinned `fetch-rdf` artifact
lacked `dist`. Its pristine source at the exact pinned commit
`a8359a3764cb6b3c763e09ea211542a5dc7edc33` was read from the existing local
temporary cache, copied into this checkout's ignored `node_modules/.cache`, and
compiled with installed dependencies. Only this checkout's ignored installed
artifact received the built output. Git transport was disabled during gates;
no remote clone/fetch, dependency addition, installation, or lifecycle script ran.

`git diff --check` passes. No implementation work or new questions remain for
this review. Full-workspace validation retains the unrelated failure above.
`roborev` is unavailable (`command -v roborev` finds no executable), so per-commit
automated verdicts could not be obtained; reviewer configuration is unchanged.

## Commits

- `bf306e65` — `feat: load private stdio configuration`: env-over-file configuration,
  exact 0600 regular-file checks, symlink refusal, URL validation, partial-auth rejection,
  tests, and the existing `@jeswr/solid-dpop` workspace dependency/lockfile edge.
- `6378d259` — `feat: authenticate stdio with CSS credentials`: reuse the suite's
  client-credentials/DPoP implementation, memory-only key/token cache, single-flight
  renewal, bounded nonce retries, scoped credentials, sanitized diagnostics, and
  real stdio subprocess tests with mocked CSS discovery/token/pod responses.
- `b806ac04` — `docs: document authenticated stdio clients`: README configuration,
  Claude Desktop/Code and Codex snippets, plus conservative interpretations in `QUESTIONS.md`.
- This final commit — `docs: record stdio lane status`.

## Validation

Node `v24.22.1`; pnpm `10.4.1`. All added tests use fixtures/injected transports;
no real credentials, accounts or production service requests.

```sh
pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test
```

PASS: all four steps, 6 test files / 129 tests. The CLI tests initialize an MCP SDK
client over subprocess stdio, use both env and private-file auth, call all four
registered tools, check read-only behavior, and verify secret-free startup failures.
Protocol tests verify actual ES256 proof signatures, token hashes, method/URI binding,
nonce retry, cache reuse/expiry/concurrency, issuer checks and redirect boundaries.

```sh
pnpm run lint:root
```

PASS: Biome, lockfile transport, app-workspace and raw-fetch guards.

To prevent any pre-existing build helper from cloning network remotes, both workspace
gates used this Git environment (local SCM reads still work):

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
```

PASS: final run 9/9 tasks successful (6 cached), including the current MCP build/typecheck/test and root guards/tests.

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never pnpm run gate:full
```

FAIL outside the lane: 218 successful / 273 tasks; `@jeswr/federation-trust#test`
failed at `test/characterization.test.ts:196`, “delegation credential structure is
stable”. The inline snapshot expects a JSON string with JWK keys in `crv,x,kty`
order; the runtime emits `kty,crv,x`. That package has no diff from the base commit.
The full run's cached solid-mcp tests passed; the final explicit package run above
includes the subsequently added discovery-error regression (129 tests).

```sh
pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts -t 'delegation credential structure is stable'
```

Reproduced the same snapshot mismatch; no unrelated source or snapshot changes.
Generated app `web/public/{callback.html,clientid.jsonld}` files from workspace builds
were removed after validation; no build output is committed.

```sh
pnpm --filter @jeswr/solid-mcp exec vitest run test/cli-config.test.ts test/client-credentials.test.ts --coverage --coverage.include=src/cli-config.ts --coverage.include=src/client-credentials.ts
```

PASS: 43 tests; new config/auth modules 100% statements, branches, functions and lines
(115/115 branches). Existing library code is unchanged.

```sh
pnpm run check:packages @jeswr/solid-dpop --mode policy
pnpm install --offline --ignore-scripts
```

PASS: policy clears the existing workspace package; offline installation downloads
nothing. No new third-party dependency. Only the solid-mcp importer changes in the
lockfile; unrelated peer-resolution churn was excluded.

The installed Git-pinned `@jeswr/fetch-rdf` artifact lacked `dist`. Its exact pinned
source (`a8359a3764cb6b3c763e09ea211542a5dc7edc33`) was available in an existing local
temporary dependency cache. Its source/config matched that commit, were copied into
this checkout's ignored `node_modules/.cache`, and compiled there using cached types.
Only this checkout's installed dependency received the resulting ignored `dist`;
the source cache was not modified and no network clone/fetch was performed.

`git diff --check` passes. The final tree contains only committed lane changes.

## Limits and open questions

- The supplied base lacks MCP-01's PodPort/new tool registry despite the brief's
  dependency statement. The CLI authenticates every tool in the available server
  (`solid_list`, `solid_read`, `solid_search`, `solid_write`). It does not recreate
  MCP-01 or add other lanes' tools. See `QUESTIONS.md` §1 (DESIGN §2–4).
- DESIGN §5 leaves file schema/precedence and anonymous behavior unspecified.
  `QUESTIONS.md` §2–3 records the conservative choices: env overrides flat JSON;
  existing config permissions are always checked; anonymous support remains only
  with no auth settings; partial/failed auth never falls back anonymously.
- Full-workspace validation remains blocked by the unrelated snapshot mismatch above.
- `roborev` is not installed (`command -v roborev` found no executable), so automated
  per-commit verdicts could not be obtained. No reviewer configuration was changed.
