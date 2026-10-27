<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-93m.1 lane report

Branch: `lane/sst-93m.1`.
Base: `e4aa7f60a40706703e8d304922c75e3e2d26a664`.

## Commits

- `27ffc10d` — `feat(solid-components): request extension access after denial`:
  add capability detection, validated consent forwarding, typed unavailable
  error, core/React exports, and adversarial tests.
- `20c0f607` — `docs(solid-components): explain request-access consent`:
  add app-owned button examples, package skill, and conservative contract
  interpretations in `QUESTIONS.md`.
- This final report is committed last as `docs: record sst-93m.1 lane status`.

## Security property and evidence

The new helper permits an extension consent call only after an actual
`AccessDeniedError` and explicit non-empty class/mode arrays. Every class must be
an absolute HTTP(S) IRI; every mode must be a recognized Read/Append/Write form.
Invalid mixed scopes and sparse arrays are rejected rather than silently
dropped. There is no inferred scope, login, read retry, or fallback transport.
The exact caller request and method receiver are preserved.

The new test suites contain 100 passing cases. Negative tests reject other error
classes and status-shaped impostors, missing/malformed capabilities, malformed
and mixed scopes, sparse arrays, invalid URL characters/escapes, unsupported
modes, malformed replies, empty grants, and failed replies with grants. Positive
tests cover every supported mode, HTTP(S)/Unicode class IRIs, frozen request
identity, optional-field omission, and partial approval semantics. Fake
DataController 401/403 responses prove the read happens exactly once; login and
extension fetch spies remain unused. Built core/React entry tests prove both
entries share the helpers and typed errors. All new tests use mocks/fixtures;
no real accounts, credentials, or production API calls are used.

`granted` is true only for `ok === true` with a non-empty grants array. It is a
consent outcome, not proof that a subsequent read will succeed. Extension-side
scope enforcement is unchanged. Jesse must review and merge this
security-critical change; it must never be auto-merged.

## Validation

All commands ran in this checkout with `PATH=/opt/node24/bin:$PATH`
(Node `v24.22.1`, pnpm `10.4.1`). Lifecycle scripts remain disabled.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/solid-components^...'` | PASS; build existing workspace dependencies on the cold checkout. |
| `pnpm --filter @jeswr/solid-components run lint && pnpm --filter @jeswr/solid-components run build && pnpm --filter @jeswr/solid-components run typecheck && pnpm --filter @jeswr/solid-components run test` | FAIL at test; lint, build, and typecheck PASS. Tests: 300 PASS, 4 blocked by the existing packaged-dist suite's setup. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=e4aa7f60a40706703e8d304922c75e3e2d26a664 pnpm run gate` | FAIL at `@jeswr/solid-components#test`: the same packaged-dist subprocess error. |
| `pnpm run gate:full` | FAIL at unchanged `//#test:root`: 161 failures, 739 passes across 12 files; fixture CLI checks receive empty output. Turbo stops with 54 successful tasks out of 232 scheduled, so full-workspace validation is incomplete. |
| `pnpm --filter @jeswr/solid-components exec node scripts/dist-imports.mjs` | PASS; reports only the allowed `@jeswr/guarded-fetch` external. |
| `pnpm --filter @jeswr/solid-components exec vitest run test/packaged-dist.smoke.test.ts --maxWorkers=1` | FAIL with the same subprocess error in isolation. |
| `pnpm --filter @jeswr/solid-components exec vitest run test/packaged-dist.smoke.test.ts --pool=threads --maxWorkers=1` | FAIL with the same subprocess error using the threads pool. |

The unchanged `test/packaged-dist.smoke.test.ts:102` fails in its existing
`execFileSync(process.execPath, ["scripts/dist-imports.mjs"], ...)` setup with
`spawnSync /opt/node24/bin/node EPERM`; its four tests cannot start. Running the
script directly succeeds. The newly added packaged request-access suite runs
independently and passes. No test is skipped or weakened by this lane.

Logs: `/tmp/sst-93m.1-package-gate-final.log`,
`/tmp/sst-93m.1-lint-root.log`, `/tmp/sst-93m.1-affected-gate.log`, and
`/tmp/sst-93m.1-full-gate.log`.

No dependencies or manifests changed, so `check:packages` is not applicable and
no install/lockfile change was necessary. This package has no API report to
update. Generated `dist/` artifacts are ignored and uncommitted.

## Unfinished checks and open questions

- Green package/affected gates remain blocked by the packaged-dist subprocess
  error. The full gate also stops in unchanged root guard tests
  (`agent-layers-reachability`, `agent-layers`, `check-packages-guard`, and
  `check-sdk-layers`) whose fixture CLI invocations return empty output. Those
  failures were not changed or bypassed; a complete green gate remains required.
- `roborev` is unavailable on PATH and no review hook is installed in this lane's
  git directory. Automated per-commit/adversarial review verdicts could not be
  obtained; no review pass is claimed. No tooling was installed or configured.
- `QUESTIONS.md` records the conservative choices: boolean approval, exact
  request forwarding, optional duration, and only the three supported modes.
  The current extension accepts short modes but rejects full ACL mode IRIs;
  the helper accepts the specified IRIs without rewriting them. Examples use
  short modes and a positive ISO-8601 duration for compatibility. Extension
  changes are outside this lane.

Implementation is complete. No push, PR, branch switch, remote fetch/merge, or
publication was performed. Work and commits are confined to this checkout.
