<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.30 — T-004, fix round 2

Date: 2026-10-25. Branch: `lane/sst-8xm.30`. Resumed from `4e2214b1`.

Both review findings are fixed. The touched-package gate and root lint pass; all
48 consumers converted to `workspace:*` pass typecheck. The broader affected repo
gate remains red on the previously recorded federation-trust characterization
snapshot mismatch. This report does not claim a green broader gate.

## Commits this round

- `ed1855dd fix: parse supported JSON-LD contexts offline` — bundle full W3C
  credentials v1/v2, Data Integrity v2, and ActivityStreams JSON context documents
  in their owning packages. `parseCredentialRdf`, the credential digest parser,
  and the shared AS2/LongChat parser explicitly use offline loaders. Exact URL
  allowlists refuse unknown and nested contexts without network fallback.
- `ea63924f fix: narrow pod money RDF reader contract` — require only the consumed
  `DatasetCore`, `etag`, and `url` result fields from injected readers. Existing
  fixtures remain unchanged and typecheck against this minimal contract.
- Final report commit: `docs: report second fetch-rdf fix validation` — resolve
  the previous API question in QUESTIONS.md and update this STATUS.md last.

The original import and fix-round-1 commits remain intact. No dependencies,
public fetch-rdf types, default context policy, or workspace manifests changed.
The generic parser still refuses remote JSON-LD contexts by default.

## Context support and tests

The supported URLs are exactly:

- solid-vc: `https://www.w3.org/2018/credentials/v1`,
  `https://www.w3.org/ns/credentials/v2`, and the package's already-emitted
  `https://w3id.org/security/data-integrity/v2`.
- solid-chat-interop: `https://www.w3.org/ns/activitystreams`.

The owning `src/contexts/README.md` files record the source URLs and retrieval
date. Contexts are imported into the builds, never fetched at runtime. The chat
TypeScript build copies its imported JSON into dist; solid-vc bundles its JSON.
Loaders return isolated copies and have no transport or URL fallback.

Original JSON-LD round-trip tests are retained and passing. New tests cover v1/v2
credential expansion, the generated credential graph's digest round-trip, Data
Integrity expansion, AS2 JSON-LD → canonical model → Turtle → canonical model,
and refusal of unknown, nested, and URL-variant contexts. These tests replace
global fetch with a failing spy and assert that it is never called.

## Required package and root checks

PASS (exit 0):

```sh
pnpm exec turbo run lint build typecheck test \
  --filter=@jeswr/fetch-rdf --filter=@jeswr/solid-vc \
  --filter=@jeswr/solid-chat-interop --filter=@jeswr/app-pod-money \
  --concurrency=4 --continue=always
pnpm run lint:root
pnpm run test:root
pnpm --filter @jeswr/solid-vc run test:coverage
git diff --check
```

Scoped Turbo gate: **20/20 tasks successful**.

| Package | lint | build | typecheck | tests |
| --- | --- | --- | --- | --- |
| `@jeswr/fetch-rdf` (unchanged regression check) | PASS | PASS | PASS | 47 PASS |
| `@jeswr/solid-vc` | PASS | PASS | PASS | 340 PASS |
| `@jeswr/solid-chat-interop` | PASS | PASS | PASS | 91 PASS |
| `@jeswr/app-pod-money` | PASS | PASS | PASS | 141 PASS |

Root tests: 2 files / 26 tests pass. Solid-vc coverage command passes; the new
context loader has 100% statements, branches, functions, and lines. Overall
solid-vc coverage remains 94.28% statements/lines, 88.38% branches, 94.3% functions;
no unrelated coverage policy or source changes were made.

Built-package smoke checks import both dist entry points and parse their bundled
contexts with global fetch disabled: PASS. This verifies JSON artifact packaging
as well as source-level tests. Initial typechecks before dependency builds failed
because workspace dist was absent; all final checks run after dependency builds.

## Workspace consumers

Consumer membership was derived from package manifests changed by `99061d3a`
whose fetch-rdf dependency is now `workspace:*`: **48 consumers**.

Dependency-first builds for those 48 consumers via Turbo: **54/54 tasks PASS**.
Then each consumer was checked explicitly with:

```sh
pnpm --filter <consumer-name> run typecheck
```

**48/48 PASS (exit 0), including both Pod Money packages.**

| Consumer | Typecheck |
| --- | --- |
| `@jeswr/app-access-manager` | PASS (0) |
| `@jeswr/solid-app-store-web` | PASS (0) |
| `@jeswr/app-coeliac` | PASS (0) |
| `@jeswr/app-issues` | PASS (0) |
| `@jeswr/app-pod-chat` | PASS (0) |
| `@jeswr/pod-chat-web` | PASS (0) |
| `@jeswr/app-pod-docs` | PASS (0) |
| `@jeswr/pod-docs-web` | PASS (0) |
| `@jeswr/app-pod-drive` | PASS (0) |
| `@jeswr/pod-drive-web` | PASS (0) |
| `@jeswr/app-pod-health` | PASS (0) |
| `@jeswr/pod-health-web` | PASS (0) |
| `@jeswr/app-pod-mail` | PASS (0) |
| `@jeswr/pod-mail-web` | PASS (0) |
| `@jeswr/app-pod-manager` | PASS (0) |
| `@jeswr/app-pod-money` | PASS (0) |
| `@jeswr/pod-money-web` | PASS (0) |
| `@jeswr/app-pod-music` | PASS (0) |
| `@jeswr/pod-music-web` | PASS (0) |
| `@jeswr/app-pod-photos` | PASS (0) |
| `@jeswr/pod-photos-web` | PASS (0) |
| `@jeswr/federation-client` | PASS (0) |
| `@jeswr/federation-registry` | PASS (0) |
| `@jeswr/federation-trust` | PASS (0) |
| `@jeswr/matrix-chat-to-pod` | PASS (0) |
| `n8n-nodes-solid` | PASS (0) |
| `@jeswr/rxdb-solid` | PASS (0) |
| `@jeswr/solid-a2a` | PASS (0) |
| `@jeswr/solid-agent-card` | PASS (0) |
| `solid-agent-notify` | PASS (0) |
| `@jeswr/solid-api-auth` | PASS (0) |
| `@jeswr/solid-auth-core` | PASS (0) |
| `@jeswr/solid-bookmark` | PASS (0) |
| `@jeswr/solid-chat-interop` | PASS (0) |
| `@jeswr/solid-components` | PASS (0) |
| `@jeswr/solid-dav-bridge` | PASS (0) |
| `@jeswr/solid-drawing` | PASS (0) |
| `@jeswr/solid-elements` | PASS (0) |
| `@jeswr/solid-granary` | PASS (0) |
| `@jeswr/solid-health-diary` | PASS (0) |
| `@jeswr/solid-mcp` | PASS (0) |
| `@jeswr/solid-memory` | PASS (0) |
| `@jeswr/solid-odrl` | PASS (0) |
| `@jeswr/solid-pod-guard` | PASS (0) |
| `@jeswr/solid-task-model` | PASS (0) |
| `@jeswr/solid-vc` | PASS (0) |
| `@jeswr/unstorage-solid` | PASS (0) |
| `@jeswr/y-solid` | PASS (0) |

## Broader repo gate and remaining limitations

The default `pnpm run gate` could not infer a base branch in this dedicated
checkout and fell back to every package. That fallback run was interrupted (130).
The gate was then run against the lane's supplied base, without fetching refs:

```sh
TURBO_SCM_BASE=219cdd5a1579a95a6408f272fe6344e72e2e8664 pnpm run gate
```

FAIL (exit 1): 172 successful / 218 scheduled tasks, 115 cached. It stops on
`@jeswr/federation-trust#test`: 53 tests pass, one characterization snapshot fails
at `test/characterization.test.ts:196`. The serialized `delegateKey` JWK property
order is `kty, crv, x`; the snapshot expects `crv, x, kty`. This exact failure was
already recorded at the prior lane head. No snapshot or federation-trust source
was changed. Unfinished tasks in this fail-fast gate are not claimed to pass.
Previous wider-gate issues outside this fix brief were not repaired or reclassified.

The requested scoped fixes have no remaining implementation work or open design
questions. The conservative context scope is the exact supported URLs above;
unknown contexts remain refused. The referenced `briefs/sst-8xm.30.md` and
`.fix1.md` were absent from this checkout; the supplied brief and prior lane report
provided the working context.

Roborev remains unavailable on PATH, so no automated per-commit verdict was
obtained. Manual review checked exact URL matching, nested-context rejection,
absence of network fallback, immutable bundled documents, build artifacts, and
Pod Money's consumed result fields. No push, PR, branch switch, dependency addition,
remote fetch/merge, or changes outside this checkout were made. Generated untracked
web build outputs were removed. STATUS.md was the last file edited this round.
