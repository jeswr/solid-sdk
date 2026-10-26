<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-4s8h — MCP-12 lane status

Implemented on `lane/sst-4s8h`, based on `917d3be9c7967622829adc43c1aaabb0964ec993`.
No push, PR, publish, branch switch, remote fetch/merge, or dependency lifecycle scripts.

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
