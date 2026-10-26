<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-5ax.1 lane status

Implementation is committed on `lane/sst-5ax.1`. This lane is **not ready for merge**:
three unchanged tests conflict with the required stricter scope behavior, workspace
gates encounter sandbox restrictions, and the required independent review is unavailable.
No push, PR, merge, or publication was performed. Jesse must review and merge this
security-critical change; it must never be auto-merged.

| Commit | Change |
| --- | --- |
| `1a6fdfa0` — `test: pin legacy scope and redirect boundaries` | Freeze both old predicates in test-only differential oracles, add adversarial scope and redirect cases before implementation, add the two workspace dependencies and lockfile links, record conservative interpretations. |
| `4c67a1b9` — `fix: delegate pod scope and redirect guards` | Replace both production scope implementations with deprecated delegates, replace unstorage's redirect wrappers and error class with the shared wrapper and deprecated alias, preserve error constructor identity in the built bundle, document behavior and refresh API reports. |
| This final documentation commit — `docs: report sst-5ax.1 validation and blockers` | Record final validation, security properties, Matrix investigation, and unresolved requirements. |

## Security properties and evidence

Both packages now delegate origin, segment boundary, traversal, scheme, credentials,
and encoded-delimiter checks to `assertWithinPodScope`. The compatibility delegates
retain absolute-target requirements and refuse slashless root aliases, including
`/alice/` for `/alice//`. Memory CRUD still refuses the container root by default;
its existing listing opt-in remains supported. Legacy error wording is preserved
for existing callers and tests without duplicating the scope algorithm.

The boundary tightens: encoded `%2f`/`%5c` path delimiters are rejected in both
packages; unstorage also rejects embedded credentials and ambiguous bases. The
new tests retain stricter behavior even where existing key-mapping tests depend
on accepting encoded separators. No RDF parsing or serialization was changed;
all new tests use pure URL inputs and injected transport fixtures.

Unstorage's data and watch fetches now use `refuseRedirects`; watch discovery still
permits same-origin paths outside the driver base. To avoid loosening the legacy
wrapper, the shared refusal predicate now covers the union of standard moved
statuses/opaque redirects and every other non-304 3xx carrying `Location` (including
an empty header). 304 and non-moved 3xx without `Location` still pass through. This
also strengthens other users of the shared refusing wrapper; follow-capable guards
are unchanged. The original Request body and policy fields survive, caller redirect
settings cannot override manual handling, and mutable URL objects are snapshotted
before an authenticated fetch can await.

`SolidRedirectError` is a deprecated alias of `RedirectRefusedError`. The unstorage
bundle keeps guarded-fetch external so errors retain one constructor identity. A
built-package smoke check proved both constructor equality and `instanceof` for an
error thrown by a driver using an injected redirect response. As explicitly allowed
by the brief, the alias exposes the shared constructor and error name.

Before switching implementations, tests failed for the intended new refusals:
four encoded-delimiter cases in memory, five delimiter/userinfo cases in unstorage,
and ten nonstandard/empty-Location cases in the shared wrapper. Request preservation
and shared error identity tests also failed against the old wrapper. The differential
corpus then found the repeated-slash root-alias mismatch, which the delegates now
refuse. All new tests pass: 1,796 memory scope cases plus 13 CRUD integration cases,
609 unstorage scope cases plus 940 redirect/integration cases, and 16 shared legacy
redirect cases. The corpus includes raw/encoded dot segments, `%2f`/`%5c`, backslashes,
userinfo, ports, IPv6/IDN equivalents, prefix siblings, query/fragment, relative
references, malformed input, invalid bases, and root options. Every legacy scope
rejection remains a rejection. Redirect tests exhaust statuses 299–400 with absent,
empty, and external Location for the primitive and both unstorage fetch paths.

The author's adversarial review checked these boundaries and the built error identity.
`roborev` is not installed and there is no configured post-commit hook in this checkout,
so independent per-commit review could not run. Do not treat this as a review verdict.
Beads were not mutated: the lane is a worktree, and the local beads skill prohibits
worktree tracker writes. The bead remains for the lead to manage through merge.

## Matrix investigation

`packages/matrix-chat-to-pod/src/safe-iri.ts:isWithinBase` is used as an HTTP write
scope boundary: `import.ts:assertWritableUrl` checks resolver-produced targets before
writes. It also bounds RDF edit-subject IRIs in the same owned container. The function
already delegates to `isWithinPodScope(safeBase, safeResource, { allowRoot: false })`.
`safeHttpIri` separately protects lexical RDF identity and injection safety. Thus
fetch-scope consolidation is already present; no Matrix source change is needed.
No Matrix files were changed.

## Validation

All commands used Node `v24.22.1` (`PATH=/opt/node24/bin:$PATH`) and pnpm `10.4.1`.
The required package commands were run exactly as these chains:

```sh
pnpm --filter @jeswr/solid-memory run lint && pnpm --filter @jeswr/solid-memory run build && pnpm --filter @jeswr/solid-memory run typecheck && pnpm --filter @jeswr/solid-memory run test
pnpm --filter @jeswr/unstorage-solid run lint && pnpm --filter @jeswr/unstorage-solid run build && pnpm --filter @jeswr/unstorage-solid run typecheck && pnpm --filter @jeswr/unstorage-solid run test
pnpm --filter @jeswr/guarded-fetch run lint && pnpm --filter @jeswr/guarded-fetch run build && pnpm --filter @jeswr/guarded-fetch run typecheck && pnpm --filter @jeswr/guarded-fetch run test
```

| Check | Result |
| --- | --- |
| solid-memory lint / build / typecheck / test | PASS; 8 files, 1,923 tests. |
| unstorage-solid lint / build / typecheck | PASS. |
| unstorage-solid test | FAIL; 1,680 passed, 3 failed. Only the three unchanged encoded-separator round-trip expectations fail; all 1,549 new cases pass. |
| guarded-fetch lint / build / typecheck | PASS. |
| guarded-fetch default test | Blocked by existing Node listener fixtures: sandbox denies `listen(127.0.0.1)` with `EPERM`. The default run was interrupted (exit 130) after confirming the restriction, rather than waiting through every 30-second hook timeout. |
| guarded-fetch tests without listener fixtures | PASS; 6 files, 311 tests. Exact command below. |
| guarded-fetch Node diagnostic | FAIL with `EPERM` on loopback listeners; shortened-hook diagnostic below produced 38 failures, 2 skipped, 39 unhandled listener errors. No test source/config was changed for this diagnostic. |
| `pnpm run check:sdk-layers` | PASS; 99 manifests scanned. |
| `pnpm run lint:root` | PASS; also rerun by the workspace gates. |
| API Extractor for both packages | PASS; reports updated. Memory reported existing TSDoc warnings in `src/iri.ts`. |
| Built-package redirect/error identity smoke check | PASS with mocked 302; no network request. |
| `git diff --check` | PASS. |

```sh
pnpm --filter @jeswr/guarded-fetch exec vitest run test/addresses.test.ts test/guard.test.ts test/podScope.test.ts test/refuseRedirects.test.ts test/refuseRedirects-legacy.test.ts test/dns-fallback.test.ts
pnpm --filter @jeswr/guarded-fetch exec vitest run test/node.test.ts --hookTimeout=100
packages/unstorage-solid/node_modules/.bin/api-extractor run --local --config packages/solid-memory/api-extractor.json
packages/unstorage-solid/node_modules/.bin/api-extractor run --local --config packages/unstorage-solid/api-extractor.json
```

Workspace gates were run before this final commit:

```sh
TURBO_SCM_BASE=bfa358b8df92b3de80266f8340e1ba3e4db35e36 pnpm run gate
pnpm run gate:full
```

| Final gate | Result |
| --- | --- |
| Affected gate at the prescribed base | FAIL (exit 1), `@jeswr/app-issues#build`: Next.js could not fetch Geist and Geist Mono from Google Fonts. 36 tasks completed successfully before cancellation. |
| Full workspace gate | FAIL (exit 1), `//#test:root`: 161 failures / 739 passes across 900 root tests; 92 Turbo tasks completed successfully before cancellation. |

Both initial runs also failed in the unrelated `//#test:root` task (164 and 162
failures respectively). A direct
`spawnSync(process.execPath, ["scripts/check-sdk-layers.mjs", "--root", "."],
{ encoding: "utf8" })` diagnostic returned `error.code === "EPERM"` with empty
captured output, while invoking the layer CLI directly passes. The affected root
fixtures depend on captured child-process output. No root guardrail code/tests were
changed to accommodate the sandbox. Final gate invocations disable Git transports
with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never`.

## Dependency checks and installation

`pnpm run check:packages @jeswr/guarded-fetch --mode policy` passed before adding
this existing internal workspace dependency. No third-party dependency was added;
registry existence/age checks do not apply to a `workspace:*` link.

Initial `pnpm install --offline` failed because pnpm tried to write to the read-only
shared store. The lockfile-only offline retry with a writable temporary store tried
to resolve an unrelated existing Git dependency and failed before SSH could start.
Although offline was requested, pnpm attempted an internal Git fetch; that path was
stopped. Only the two known workspace-link importer entries were then updated.
This exact installation succeeded, skipped resolution, downloaded nothing, and kept
lifecycle scripts disabled:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts --filter @jeswr/solid-memory... --filter @jeswr/unstorage-solid...
```

## Unfinished requirements and questions

See [QUESTIONS.md](QUESTIONS.md) for options and conservative choices.

- Question 3 blocks green unstorage tests. The three unchanged failures in
  `packages/unstorage-solid/test/keys.test.ts` are the pre-encoded `%2F` round-trip,
  mixed encoded `:` / `/` / `\` round-trip, and nested encoded-separator round-trip.
  The shared guard must reject those URLs under the stricter behavior requirement.
  A clarification was requested while work continued; absent an answer the existing
  tests remain unchanged.
- Question 5 remains open under the broad acceptance wording. Task 2 explicitly
  enumerates unstorage's wrappers, so memory's private `MemoryStore.request` was
  conservatively left unchanged. It refuses all 3xx, including 304 and non-moved
  responses without Location; replacing it with the specified primitive verbatim
  would loosen that behavior.
- Workspace gates also require the existing Issues app font download to succeed.
  Root tests and guarded-fetch's listener tests need an environment that permits
  their existing child-process capture and loopback fixtures. Full green validation
  and independent roborev review remain outstanding.
- The prescribed `packages/guarded-fetch/SKILL.md` is absent at the base. Its source,
  README, and existing tests were read instead; no replacement skill was invented.
