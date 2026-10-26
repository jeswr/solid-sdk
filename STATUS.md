<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.30 — fix round 6

Date: 2026-10-26. Branch: `lane/sst-8xm.30`. Starting head: `539f09bd`.

## Commits and scope

- `9af449d5 fix: bundle federation OIDC context offline` — bundle the complete
  Solid OIDC JSON-LD context separately in federation-client and federation-registry;
  use an inline-only documentLoader for client verification, source/member listing,
  and registry/storage body and fetch loading. Add 15 regression cases covering
  successful offline loading and refusal of unknown, additional, scoped, and
  lookalike context URLs. Context provenance and license are recorded beside each copy.
- Final report commit: `docs: report federation context fix validation` — this file,
  edited last after implementation and validation.

Only finding 2 in `solid-sdk-lane-sst-8xm.30-539f09bd1ec7.md` was addressed.
The conservative context allowlist contains exactly
`https://www.w3.org/ns/solid/oidc-context.jsonld`. Every other remote context is
refused, including nested loads. Context documents are cloned before use and
embedded by the existing package builds. No runtime context download or public
loader option was added. No dependencies, manifests, lockfiles, or fetch-rdf
policy were changed; `check:packages` was not needed.

Findings 1 and 3 are the pre-existing VOC-02 issues tracked as VOC-05 and remain
untouched, as directed. The shipped Pod Docs document now parses offline; its
canonical federation namespace still produces the existing `no-app` validation
issue rather than `parse-failed`. The regression explicitly preserves that scope.

## Validation

All required touched-package gates and root lint passed (exit 0):

```sh
pnpm run lint:root
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/federation-client --filter=...@jeswr/federation-registry --concurrency=4
pnpm --filter @jeswr/federation-client run test:coverage
pnpm --filter @jeswr/federation-registry run test:coverage
```

- Turbo: **12/12 tasks successful**, 3 cached. Dependency builds ran first.
  The dependent selectors resolve to the two touched packages; there are no
  additional workspace dependents to test.
- federation-client: **15 files / 220 tests passed**, including 9 new tests.
- federation-registry: **8 files / 107 tests passed**, including 6 new tests.
- Coverage: both commands passed; each new context loader has **100% statements,
  branches, functions, and lines**. Overall statement/line coverage is 99.25% for
  federation-client and 99.05% for federation-registry.
- Root lint passed all guards, token checks, and 74 contrast pairs.

Focused tests also passed independently (exit 0):

```sh
pnpm --filter @jeswr/federation-client exec vitest run test/offline-contexts.test.ts
pnpm --filter @jeswr/federation-registry exec vitest run test/offline-contexts.test.ts
```

Before the implementation, the positive cases failed on both body and fetch
paths, the client source/member listing paths, and the shipped Pod Docs document.
The test setup first built workspace dependencies using
`pnpm exec turbo run build --filter=@jeswr/federation-client --concurrency=4`
(exit 0); direct Vitest cannot resolve fetch-rdf before its dist exists.

Additional checks passed:

- A `node --input-type=module` artifact smoke test imported both built packages,
  exercised client verify/list and registry loading with global fetch disabled,
  confirmed unknown contexts fail, and checked context data is inline in the
  emitted bundles with no JSON imports.
- Both bundled JSON documents match the complete canonical W3C context after
  formatting (deep equality against the downloaded document).
- `git diff --check` and the staged equivalent passed.

Per the lane brief, the whole-workspace gate was not rerun. Its previously
reported federation vocabulary/codegen failures are outside this fix's scope.
Roborev is unavailable on PATH, so no automated per-commit verdict was obtained.
Manual review checked all federation parse/fetch call sites, exact-URL refusal,
cloned context isolation, unchanged APIs, and bundled build output.

## Remaining work and questions

Finding 2 is complete. No open implementation questions or blockers.
Findings 1 and 3 remain with VOC-05. No push, PR, branch switch, remote git fetch,
merge, or other-checkout modification was performed. STATUS.md was edited last.
