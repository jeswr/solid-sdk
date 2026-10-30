<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-05 / sst-18d lane report

Branch: `lane/sst-18d`. Base: `17987b36fa6b894101bb00d577a90c9af084215e`.
Implementation complete; affected and full-workspace gates pass. Dispatcher browser/review checks remain pending.

## Commits

- `c4b968b1 feat: add shared async surface states`: EmptyState's five variants;
  all eleven classified error categories with §9 copy/recovery actions, capability-gated
  access requests and Retry-After; list/grid/document/detail/table skeletons; renderAsync
  shared by collection and content/upload feedback; Sonner 5s/8s Undo/persistent-error policy;
  unit, keyboard, timer and axe coverage; API documentation and conservative spec readings.
- `8b09fb69 test: add async state fixtures and browser coverage`: five guarded dev fixture
  routes, component-index links, all states and both densities; dispatcher Playwright
  screenshots, axe, keyboard and 320px reflow checks; existing Retry browser-copy update.
- The final `docs: record DS-05 validation results` commit contains this report.

## Validation

All commands run from this checkout with `export PATH=/opt/node24/bin:$PATH`.
The shell initially selected Node 22; the repository requires Node >=24. No engine check
was disabled. No lifecycle scripts were enabled.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run lint` | PASS; two existing navigation.css specificity warnings. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS. |
| `pnpm --filter @jeswr/suite-ui run typecheck` | PASS. |
| `pnpm --filter @jeswr/suite-ui run test` | PASS: 20 files, 579 tests. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS; 70 existing warnings. |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build workspace dependencies before Next resolves their dist exports. |
| `NEXT_PUBLIC_DEV_FIXTURES=1 pnpm --filter @jeswr/app-suite run build` | PASS; all five new routes prerendered. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 172 files, 9,145 tests; reported coverage 100% statements/branches/functions/lines. |
| `pnpm run lint:root` | PASS; token contrast: 74 pairs, zero failures. |
| `TURBO_SCM_BASE=17987b36fa6b894101bb00d577a90c9af084215e pnpm run gate` | PASS on retry: 16/16 tasks successful, 12 cached, 25.648s. First run stopped at 12/14 because an unchanged AppLauncher tooltip test timed out at 5s under concurrent builds. All 579 UI tests subsequently passed in the full gate. |
| `pnpm run gate:full` | PASS on cache retry: 405/405 tasks successful, 297 cached, 3m37.699s. First run stopped after 400 successes because the unchanged create-solid-demo packing test could not write `/root/.npm` (EROFS). |
| `git diff --check` | PASS. |

The focused DS-05 tests cover exact copy and action sets for every category, all five
empty variants and skeleton presets, keyboard actions, status/alert roles, Retry-After
including long delays, toast lifetimes/dismissal and promise failures, and axe with no
serious/critical violations. jsdom cannot measure layout/contrast; the root token contrast
check and dispatcher browser specs cover those. An initial full UI test run passed all
579 assertions but caught a virtualizer timer after jsdom teardown in the existing upload
scale test; the complete rerun passed without that error. Existing canvas-not-implemented
messages are non-failing jsdom diagnostics.

The full-gate cache retry uses `export PATH=/tmp/sst-18d-bin:/opt/node24/bin:$PATH`.
The temporary `npm` wrapper executes `/opt/node24/bin/npm --cache /tmp/sst-18d-npm-cache "$@"`;
this confines npm cache writes to a writable directory without changing repository config,
Turbo's environment filtering, dependency manifests or lifecycle-script policy.

## Dependencies and source references

No dependencies or manifests changed. `check:packages`: not applicable; none added.
The supplied `/home/runner/Documents/GitHub/jeswr/solid-suite-planning` paths do not exist
here. Read the equivalent files in `/home/user/solid-suite-planning`: the complete design
system, app conventions and RECONCILE; SDK assumptions §4/§10; and the three mockup sources.
No network fetch/merge, push, PR, branch switch, mirror publication or other-checkout edits.

## Browser verification and review

No Chromium launch or screenshots taken, as the lane brief requires dispatcher execution.
`apps/suite/e2e/ds-05-async-states.spec.ts` uses the existing 375/768/1280 × light/dark matrix,
adds 320px checks, and writes full-page captures to repo-root `artifacts/screens/DS-05/`.
It covers the full error/empty/preset galleries, each async-list state, success/Undo/error
toasts, capability gating, keyboard recovery, visible focus and measured density heights.
No PNGs committed. Browser axe, visual comparison and browser keyboard/layout results remain
pending with the dispatcher.

`roborev status` failed with `roborev: command not found` (exit 127); this checkout also has
no installed post-commit review hook. Automated per-commit verdicts require dispatcher review.
No reviewer was installed or spawned in this lane.

## Open questions / conservative readings

See [QUESTIONS.md](QUESTIONS.md): specialised session/conflict flows stay caller-owned;
underspecified skeleton geometry uses existing tokens and mockup anatomy; the SDK façade
owns exception classification. ErrorState accepts classified categories and retry metadata,
never raw exceptions. Request access requires the capability; recovery controls render only
when their host supplies a handler or destination. No blocking implementation question.

## Fix round 2 — review of c51043e00272

Scope: the two supplied review findings only, based on
`c51043e002728ea6858f658be0b464be0972f75a` on `lane/sst-18d`.

- `5c66e03b fix: preserve undo timing and surface recovery`: honour the existing
  `duration: toastDurations.undo` option for React-node/localised Undo actions on all
  wrapped toast methods and promise results. Literal `"Undo"` still selects eight
  seconds automatically; ordinary durations remain five seconds and errors persist.
  Preserve upload/preview `onAction` callbacks as Sign in for reauth and Retry for
  other categories, matching the existing content adapter's legacy fallback.
  Update API documentation and regression tests for both findings.
- The final `docs: record sst-18d round two validation` commit records this round.

Conservative reading: use Sonner's existing duration option to identify Undo with an
arbitrary React-node label, rather than inspect component output or extend the API.
Keep the legacy recovery callback rather than add category-specific adapter props.

Validation uses `export PATH=/opt/node24/bin:$PATH` unless noted.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui exec vitest run test/toasts.test.tsx test/components.test.tsx` | PASS: 2 files, 124 tests. Before the fixes, the regression run failed 33 tests; all now pass. |
| `pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test` | PASS: 20 test files, 613 tests; two existing navigation.css warnings. Initial lint found test formatting differences, corrected with Biome. |
| `pnpm run lint:root` | PASS: 74 contrast pairs, zero failures. |
| `TURBO_SCM_BASE=c51043e002728ea6858f658be0b464be0972f75a pnpm run gate` | PASS: 15/15 tasks, 3m32.437s; 613 UI tests and 9,145 suite app tests. |
| `pnpm exec turbo run test:root --filter=//` | Initial isolated retry: 984/985 tests passed; one unchanged agent-layer case still hit its five-second timeout. |
| `taskset -c 0 pnpm exec turbo run test:root --filter=//` | PASS: 14 files, 985 tests; original test limits unchanged. CPU affinity reduces Vitest worker contention. |
| `taskset -c 0 pnpm exec turbo run test --filter=@jeswr/solid-app-store-web` | PASS: 21 files, 222 tests; 7/7 Turbo tasks, 6 cached. |
| `pnpm exec turbo run test --filter=@jeswr/pod-connectors` | PASS: 89 files, 1,555 tests; 7/7 Turbo tasks, 6 cached. |
| `pnpm run gate:full` | PASS on cache retry: 405/405 tasks, 385 cached, 6m16.634s. Uses `export PATH=/tmp/sst-18d-bin:/opt/node24/bin:$PATH`; the existing temporary npm wrapper uses the writable cache described above. |
| `git diff --check` | PASS. |

The isolated Turbo checks also use the temporary npm wrapper's PATH. Earlier full-gate
attempts stopped on unchanged timing-sensitive tests under concurrent workspace load:
ten root timeouts (nine agent-layer path-character cases and one Vercel fixture), then
one App Store restoration timeout, then three connector timeouts and a connector
performance assertion (2.46 seconds against a two-second limit). The affected gate
passed on its first run. All failing full-gate checks passed in the isolated commands
above and the final full gate reused those successful results. No test threshold,
repository configuration, unrelated source or dependency changed to obtain the passes.

The added coverage checks the eight-second policy for React-node labels on regular,
success/info/warning/message/custom toasts, shared and result-specific promise options,
clicking Undo after five seconds, and error persistence taking precedence. Every error
category on UploadDock, DropZoneOverlay and PreviewPane retains exactly one working
recovery action when a callback exists; SurfaceFeedback omits controls without one.
The existing gallery axe assertions also exercise the restored controls.

No dependencies, manifests, browser specs or fixtures changed. `check:packages` is not
applicable. No Chromium launch or screenshots, per the lane brief; browser verification
remains dispatcher-owned. `roborev status` still fails with command not found (exit 127),
and no post-commit review hook is installed; dispatcher review is required.
No network fetch/merge, push, PR, branch switch or edits to another checkout.
No unfinished implementation or open questions for this fix round.
