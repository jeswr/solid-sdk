<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.18.2 lane status

Branch: `lane/sst-8xm.18.2`. Base: `0d8842080a31b716b2d1350efed53b19eb8c6832`.

## Commits

- `87501d2c` — `test: characterize security IRI guard differences`: freeze the
  historical implementations as test-only differential oracles; add the
  adversarial corpus, compatibility questions, connector workspace dependency,
  and matching lockfile importer.
- `91d9d7f8` — `fix: delegate security IRI guards to rdf-serialize`: replace
  production copies with shared guards, preserve exported names, retain the
  stricter VC/connector pre-checks, and assert stricter behavior through typed
  notification/connector writes.
- Final documentation commit — `docs: record IRI guard lane validation`: this report.

## Security property and evidence

All four targeted production copies now delegate to `@jeswr/rdf-serialize`.
Notifications re-export `escapeIri` and `safeHttpIri` directly. VC `safeHttpIri`
and connector `safeIri` remain thin deprecated compatibility delegates.

- **VC:** accepted values and rejection behavior stay unchanged. Preserve the
  existing strip-divergence pre-check: embedded tab/LF/CR still fail closed even
  where the shared guard would escape and accept them. See QUESTIONS.md Q1.
- **Notifications:** HTTP(S) IRIs must now have a nonempty lexical authority.
  Authority-less and empty-authority actor/object/target values are dropped;
  those activity subjects throw. Escaping and lexical identity stay unchanged.
- **Connectors:** values must now parse as absolute IRIs. Empty, relative, and
  malformed values are dropped, including when replacing an existing typed
  `sourceUrl`. Preserve rejection of raw Turtle-forbidden characters by checking
  whether the shared `escapeIri` changes the input before calling shared
  `safeIri`. See QUESTIONS.md Q2. Existing open-scheme and userinfo policy stays.

The final differential suites pass **1,170 tests**: VC 375, notifications 376,
connectors 419. The corpus includes every C0 byte and space at both edges and in
scheme, authority, path, query, fragment, and URN positions; every forbidden
symbol; non-HTTP schemes and `javascript:`; relative/malformed IRIs; userinfo;
percent-encoding; IDNs/astral characters; default ports, host case, empty paths,
and dot segments that `.href` would canonicalize; and a Turtle breakout payload.
VC results equal the frozen old guard. Notification acceptance is a subset of
its frozen old guard, with identical escape output. Connector results equal the
intersection of old and shared acceptance. No old rejection becomes acceptance.

Before replacement, the new stricter assertions failed in 9 notification tests
and 16 connector tests. After replacement, every differential test passes.
New RDF write assertions use typed wrappers; no hand-built triples or live
service calls were added. Existing injection and VC signing/verification tests
remain in place. No security-critical change is auto-merged: Jesse must review
and merge this lane after the outstanding validation below.

## Dependency checks and installation

Commands used Node 24 (`export PATH=/opt/node24/bin:$PATH`) and pnpm 10.4.1.
Lifecycle scripts remained disabled throughout.

- `pnpm run check:packages @jeswr/rdf-serialize --mode policy` — PASS before
  adding the existing internal workspace package. No third-party dependency
  was added; npm registry existence/age checks do not apply to this workspace edge.
- `pnpm install` — failed: the sandbox cannot create the default store's
  temporary directory while resolving unrelated existing Git dependencies.
- `pnpm install --offline --lockfile-only --ignore-scripts --store-dir /tmp/sst-8xm.18.2-pnpm-store`
  — failed: pnpm still attempted an unrelated pinned Git dependency resolution
  despite offline mode; its fetch failed. No remote source was imported.
- Updated only the connector's workspace importer in `pnpm-lock.yaml`, then ran
  `pnpm install --offline --frozen-lockfile --ignore-scripts --filter @jeswr/pod-connectors`
  — PASS; pnpm confirmed the lockfile was up to date, skipped resolution, and
  installed the workspace link locally.

## Validation

The following exact package command chains were run:

```sh
pnpm --filter @jeswr/solid-vc run lint && pnpm --filter @jeswr/solid-vc run build && pnpm --filter @jeswr/solid-vc run typecheck && pnpm --filter @jeswr/solid-vc run test
pnpm --filter solid-agent-notify run lint && pnpm --filter solid-agent-notify run build && pnpm --filter solid-agent-notify run typecheck && pnpm --filter solid-agent-notify run test
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
```

| Package | Lint / build / typecheck | Full package test result |
| --- | --- | --- |
| `@jeswr/solid-vc` | PASS / PASS / PASS | PASS: 715 tests, 17 files |
| `solid-agent-notify` | PASS / PASS / PASS | BLOCKED: 442 passed, 219 skipped; four suites cannot start their loopback servers (`listen EPERM 127.0.0.1`), causing four hook timeouts/unhandled errors |
| `@jeswr/pod-connectors` | PASS / PASS / PASS | BLOCKED: 1,673 passed, 24 failed across existing `node/loopback`, `node/runtime`, and `node/bin` tests; loopback and child-process sandbox restrictions |

The connector lint emits existing warnings in untouched test files and exits 0.
The connector executable prints its expected help when invoked directly;
`spawnSync(process.execPath, ...)` separately reproduces `error.code === "EPERM"`
and empty child stdout in this sandbox. Loopback-dependent failures occur before
their fixture exchange can begin. No guard-related package tests failed.

Additional exact commands:

- `pnpm --filter @jeswr/rdf-serialize run build` — PASS.
- `pnpm exec turbo run build --filter=@jeswr/solid-vc... --filter=solid-agent-notify... --filter=@jeswr/pod-connectors...`
  — PASS: all seven package/dependency builds.
- `pnpm --filter @jeswr/solid-vc exec vitest run test/iri-differential.test.ts`
  — PASS: 375 tests.
- `pnpm --filter solid-agent-notify exec vitest run src/iri-differential.test.ts`
  — PASS: 376 tests.
- `pnpm --filter @jeswr/pod-connectors exec vitest run src/core/iri-differential.test.ts`
  — PASS: 419 tests.
- `pnpm --filter solid-agent-notify run check:fetch` — PASS: 11 source files.
- `pnpm run check:sdk-layers` — PASS: 99 manifests.
- `pnpm run lint:root` — PASS, including all workspace guards and contrast checks.
- `TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate`
  — FAIL (exit 1): 18 successful tasks, 30 total; Turbo's reported failing task
  is `solid-agent-notify#test`, with the same loopback `EPERM` errors as the
  package run. The dependent Pod Manager build also reports failure to fetch
  `Inter` from Google Fonts (`EAI_AGAIN fonts.googleapis.com`).
- `pnpm run gate:full` — FAIL (exit 1): 78 successful tasks, 260 total; Turbo
  stopped at `//#test:root` (736 tests passed, 164 failed across five root test
  files). Existing subprocess assertions receive empty stdout/stderr, and some
  existing tests time out under the full run. A standalone
  `spawnSync(process.execPath, ["scripts/check-sdk-layers.mjs"], ...)` reproduces
  `error.code === "EPERM"` with empty stdout/stderr, while the direct
  `pnpm run check:sdk-layers` command passes. Root tests/guards were not modified.
- `git diff --check` — PASS.

## Outstanding validation and questions

The green-gate acceptance criterion remains blocked by sandbox restrictions;
run the full package/workspace gates in an environment that permits the
repository's existing loopback and executable fixture tests, and the existing
Pod Manager build's Google Fonts download. Full-workspace root-test subprocess
failures/timeouts also need validation in that environment. Automated review
is also outstanding: `roborev` is absent and no post-commit review hook is
installed in this checkout. No review verdict could be read. No review tools
were installed, and no merge or publication was attempted.

QUESTIONS.md Q1 and Q2 document the two conservative compatibility choices
required by the brief's no-loosening rule; neither requires a decision to finish
the implementation. The requested rdf-serialize, solid-vc, and solid-agent-notify
package SKILL.md files are absent; existing source/tests and the applicable
repository skills supplied guidance. Bead state was left to the parent program:
this dedicated lane has not merged. All work stayed in this checkout.
