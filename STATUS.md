<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-09 lane report — sst-099

Branch: `lane/sst-099`. Base: `b8fd73597ff9223eed0c6834e86e5fe62caac721`.

Implemented PeoplePicker, RoleSelect, DurationChips, ConsentSheet and PermissionRow in
`packages/suite-ui`, with public prop types, token-backed styles and package documentation.
All data/selection/permission values are controlled; network and permission writes remain with
the consuming app. Consent cancellation and permission revocation require local confirmation.
Cancel and Share share an outline variant and equal-width columns.

Fixtures: `/dev/components/people-picker`, `/role-select`, `/duration-chips`, `/consent-sheet`,
and `/permission-row` under the existing dev-only layout, linked from `/dev/components`.
These expose selections, disabled reasons, custom duration, profile loading, expansion,
consequences, empty/filter/loading states, six typed errors and both offline variants.

## Commits

- `46937189` — `feat: add sharing and consent UI components`: components, styles, props, validation,
  unit tests, required dependencies, documentation and conservative questions.
- `16a4f6c3` — `fix: align role menu and fractional spacing`: Radix Select and formatter-safe
  calculations for the normative 2px/6px spacing values; open-menu accessibility test.
- `77cffce4` — `test: add sharing fixtures and browser matrix`: five routes, interactive states,
  browser checks and computed-button-style snapshot.
- `c758c7bf` — `fix: load browser style snapshot as JSON`: Node ESM import attribute.
- `427665ff` — `chore: scope dependency lock changes to suite UI`: preserve unrelated resolutions.
- Final status commit — `docs: record DS-09 lane validation`.

## Commands and results

Workspace scripts for packages without local tool dependencies required the checkout's root
tool binaries in PATH. Before workspace gates, used:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
```

Dependency builds: `pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4`
passed after this PATH setup. An earlier attempt failed because suite-vocab could not find `tsc`;
no source or manifest change was required.

Required project checks all passed:

```sh
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=b8fd73597ff9223eed0c6834e86e5fe62caac721 pnpm run gate
```

- suite-ui: 40 tests, 2 files, including validation, independent role disabling, group duration
  disabling, controlled callbacks, confirmation paths, equal computed button styling and axe.
  jsdom axe reports zero serious/critical issues for every implemented async state and the open
  role menu. Color contrast is excluded in jsdom and remains enabled in the browser specs.
- suite app: 5,993 tests, 114 files; existing coverage requirements pass at 100% statements,
  branches, functions and lines. Lint passes with 54 pre-existing warnings in unrelated code.
- Root lint: passed, including token, contrast, workspace, transport and layering guards.
- Final affected gate: passed, 14/14 tasks, scoped to root, suite-ui and suite.
- `pnpm run gate:full`: failed after 311 successful tasks (359 scheduled), in unchanged
  `packages/federation-trust/test/characterization.test.ts:196`, test “delegation credential
  structure is stable”. The serialized public JWK property order differs: expected `crv,x,kty`,
  received `kty,crv,x`. No federation-trust source, manifest or dependency resolution changed in
  this lane. Other uncompleted full-gate tasks were cancelled by Turbo. This unrelated snapshot
  remains a full-workspace gate blocker; it was not updated outside this lane's scope.
- Isolated confirmation: `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts`
  reproduced the same failure (19 passed, 1 failed); no snapshot update was made.
- `git diff --check`: passed. Removed only the 16 untracked callback/client-ID files generated
  by other apps' full-gate builds; no generated assets or dist output are committed.

## Dependencies

Policy checks ran before manifest edits:

```sh
pnpm run check:packages react react-dom @types/react @types/react-dom radix-ui lucide-react @testing-library/react @testing-library/user-event jsdom axe-core
pnpm run check:packages @testing-library/dom
```

Both passed (10 packages and 1 package respectively). `@testing-library/user-event` was checked
but not added. Added only the requested UI stack and test infrastructure to suite-ui, using
versions already present in the lockfile. React/React DOM are peers plus local development
dependencies. No other project's dependency resolutions changed in the final lockfile.

`pnpm install --ignore-scripts` and `pnpm install --frozen-lockfile --offline --ignore-scripts`
both passed. Lifecycle scripts stayed disabled. Existing peer/bin warnings concerned unrelated
workspace packages.

## Browser handoff and unfinished checks

`pnpm --filter @jeswr/app-suite exec playwright test --list ds-09-sharing.spec.ts` passed:
198 cases across 375/768/1280 × light/dark. No browser was launched, as explicitly required.
The specs check serious/critical axe findings, keyboard paths, disabled reasons, 320px reflow,
confirmation dialogs, focus return, and a committed computed-style snapshot plus exact
Cancel/Share dimension/style equality. They write full-page screenshots for all fixture routes,
open role menus, every consent variant (including scrolled actions), picker validation and
confirmation/revoked states to repo-root `artifacts/screens/DS-09/`.

Screenshots taken in this lane: none. PNGs committed: none. Dispatcher must run:

```sh
SUITE_E2E_PORT=<port> pnpm --filter @jeswr/app-suite test:e2e
```

Visual comparison with the three supplied mockups, browser axe/keyboard/reflow results and
browser computed-style assertions await that run. The mockup HTML/CSS was read as the visual
reference; browser viewing was deferred under the lane's explicit prohibition.

`roborev` is not installed in this environment (`command -v roborev` found no executable).
Automated per-commit verdicts could not be read or queued here; dispatcher review remains pending.
No remotes were fetched, no branch was switched, and nothing was pushed or published.

## Conservative assumptions / open questions

See `QUESTIONS.md`: inject `useProfile` because no SDK façade exists in the base; use equal
outline buttons; use a native controlled ISO date field for Custom duration. The base contains
tokens but no DS-02 shared primitives, so these components use local Radix wrappers. These
assumptions do not block the pure UI implementation. No other implementation work is unfinished.

## Fix round 4 — review of `1bba5cf91b2a`

Addressed exactly the two supplied correctness findings:

- `8d0e8e41` — `fix: disable pending revocation offline`: propagate the current disabled state
  to the confirmation action and guard its callback. Two regression cases cover going offline
  with an open confirmation, with and without cached data, and confirming after reconnecting.
- `e06351aa` — `fix: search resolved contact profile names`: resolve contact profiles independently
  of query filtering and share the resolved data between suggestion labels and search. Preserve
  contact-name, WebID and email matching. Three regression cases cover absent/stale contact
  names, case-insensitive profile-name search, keyboard selection, delayed profile resolution,
  profile changes while filtered out, and contact removal with a stateful profile hook.
- Final documentation commit — `docs: record review fix validation`.

Both regressions failed before their fixes and passed afterwards. Validation used the installed
Node 24 runtime to match the workspace's supported engine:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=1bba5cf91b2a82a2539cf089425bd3d67051330c pnpm run gate
pnpm run gate:full
git diff --check
```

- Package gate: passed, 45 tests across 2 files, including five added regression cases.
- Root lint: passed, including all workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 312 successful tasks (359 scheduled), at the previously recorded
  `packages/federation-trust/test/characterization.test.ts` test “delegation credential structure
  is stable”. The snapshot expects public JWK field order `crv,x,kty` and receives `kty,crv,x`.
  This round has no changes under `packages/federation-trust`; the unrelated snapshot remains
  a full-workspace gate blocker. Turbo cancelled the remaining tasks.
- Diff whitespace check: passed. Removed only the 16 untracked callback/client-ID files
  generated by the full gate's application builds.

No dependencies were added or changed. No browser was launched, as required by the lane brief.
`roborev` remains unavailable, so automated per-commit review is pending dispatcher handoff.
No requested fixes remain unfinished, and this round introduces no open questions or new design
assumptions. Nothing was fetched, pushed, published or opened as a PR.

## Fix round 5 — review of `a1ac353bb2b0`

- `736dc2d4` — `fix: select last contact on initial ArrowUp`: handle inactive keyboard
  selection explicitly so the first ArrowUp highlights the last suggestion. Add regression
  cases for one and three contacts, checking the active descendant, selected option and the
  contact added by Enter.
- Final documentation commit — `docs: record ArrowUp fix validation`.

The three-contact regression failed before the fix (Bob highlighted instead of Chris); both
new cases pass after the fix. Validation used Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'selects the last contact with initial ArrowUp'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=a1ac353bb2b0ab4b77eba4f682438fd23593ff24 pnpm run gate
pnpm run gate:full
git diff --check
```

- Focused pre-fix run: one failed, one passed, 42 skipped; failure reproduced the finding.
- Package gate: passed, 47 tests across 2 files. An initial lint run flagged formatting in
  the edited handler; formatting was corrected before rerunning the complete package gate.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 306 successful tasks (357 scheduled), at the previously recorded
  `packages/federation-trust/test/characterization.test.ts:196` test “delegation credential
  structure is stable”. Expected public JWK field order is `crv,x,kty`; received order is
  `kty,crv,x`. This round has no changes in that package. Remaining tasks were cancelled by
  Turbo; the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace check: passed. Removed only the 16 untracked callback/client-ID files
  generated by full-gate application builds.

No dependencies were added or changed. No browser was launched and no screenshots were taken,
as required by the lane brief. `roborev` remains unavailable, so automated per-commit review
is pending dispatcher handoff. The requested fix is complete, with no new design assumptions
or open questions. Nothing was fetched, pushed, published or opened as a PR.

## Fix round 6 — review of `c8bbd4066658`

- `09c42945` — `fix: preserve sharing keyboard focus`: handle the picker's Escape at window
  capture, scoped to its own input while suggestions are open, before the host Radix dialog's
  document-capture dismissal. The first Escape closes suggestions and clears the active option;
  the second closes the host. Give the revoke confirmation a row-header focus fallback when its
  trigger becomes disabled after revocation. Read the trigger's current DOM state at close time
  so a simultaneous permission update is respected. Add six Radix integration regression cases.
- Final documentation commit — `docs: record keyboard fix validation`.

Both Escape regressions failed before the picker fix; both expanded/collapsed revoke regressions
failed before the focus fix, reproducing focus on `document.body`. The four regressions pass
after the fixes, along with two cases preserving trigger focus after Cancel and Escape.

Validation used Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'dismisses only suggestions'
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'focuses the row header|returns focus to Revoke'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=c8bbd40666588034b30e5fa4ce004c840821ab71 pnpm run gate
pnpm run gate:full
git diff --check
```

- Package gate: passed, 53 tests across 2 files. An initial lint run flagged formatting in the
  new parameterized revoke test; formatting was corrected before rerunning the package gate.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 310 successful tasks (358 scheduled), at the previously recorded
  `packages/federation-trust/test/characterization.test.ts:196` test “delegation credential
  structure is stable”. Expected public JWK field order is `crv,x,kty`; received order is
  `kty,crv,x`. This round has no changes in that package. Remaining tasks were cancelled by
  Turbo; the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace check: passed. Removed only the 16 untracked callback/client-ID files
  generated by full-gate application builds.

No dependencies were added or changed. No browser was launched and no screenshots were taken,
as required by the lane brief. `roborev` remains unavailable, so automated per-commit review
is pending dispatcher handoff. Both requested fixes are complete, with no new design assumptions
or open questions. Nothing was fetched, pushed, published or opened as a PR.

## Fix round 7 — review of `068948a05148`

- `c7456435` — `fix: validate account IDs before email lookup`: validate HTTP(S) Account IDs
  before email resolution. Add three validation cases with email syntax in URL paths, queries
  and fragments, checking both raw IDs and known-contact metadata, plus a raw-entry picker test.
- `20762700` — `fix: require custom dates for disabled durations`: require the custom date
  regardless of duration editing availability. Two regression cases cover missing and malformed
  dates, blocked Share callbacks, and successful sharing after a valid date is supplied, with
  editing both enabled and disabled.
- Final documentation commit — `docs: record validation fix results`.

All four Account ID regressions failed before the fix. The disabled-duration case also failed
before its fix, while the enabled-duration case passed. All six new cases now pass.

Validation used Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'account ID containing an email'
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'account ID containing an email|resolves email|invalid or unsafe account ID'
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'requires a custom date'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=068948a0514808e788aaf414b52907e775ca7d57 pnpm run gate
pnpm run gate:full
git diff --check
```

- Package gate: passed, 59 tests across 2 files.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 292 successful tasks (347 scheduled), at the previously recorded
  `packages/federation-trust/test/characterization.test.ts:196` test “delegation credential
  structure is stable”. Expected public JWK field order is `crv,x,kty`; received order is
  `kty,crv,x`. This round has no changes in that package. Turbo cancelled the remaining tasks;
  the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace check: passed. Removed only the 16 untracked callback/client-ID files
  generated by full-gate application builds.

No dependencies were added or changed. No browser was launched and no screenshots were taken,
as required by the lane brief. `roborev` remains unavailable, so automated per-commit review
is pending dispatcher handoff. Both requested fixes are complete, with no new design assumptions
or open questions. Nothing was fetched, pushed, published or opened as a PR.

## Fix round 8 — review of `0ea13fd81539`

- `e36247f3` — `fix: preserve highlighted contact identity`: store the active WebID and derive
  its current result index, keeping the highlighted recipient stable when another contact's
  delayed profile inserts a matching result before it. If the active contact stops matching,
  expose no active option and prevent Enter from selecting another contact at the old index.
  Four regression cases cover immediate Enter, ArrowUp/ArrowDown after insertion, active
  descendant/selected-option consistency, and a highlighted profile that stops matching.
- Final documentation commit — `docs: record profile selection fix validation`.

All four regression cases failed before the fix and pass afterwards. Existing browser coverage
already exercises the picker's keyboard selection path; no browser was launched in this round.
Validation used Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'preserves the highlighted contact|clears the highlight'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=0ea13fd81539cc0ca359172aa585dccb7311b337 pnpm run gate
pnpm run gate:full
git diff --check
git diff --check 0ea13fd81539cc0ca359172aa585dccb7311b337 HEAD
```

- Focused regression run: four failed before the fix; four passed afterwards, 56 skipped.
- Package gate: passed, 63 tests across 2 files.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 289 successful tasks (340 scheduled, 12 cached), at the previously
  recorded `packages/federation-trust/test/characterization.test.ts:196` test “delegation
  credential structure is stable”. Expected public JWK field order is `crv,x,kty`; received
  order is `kty,crv,x`. This round has no changes in that package. Turbo cancelled the remaining
  tasks; the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace checks: passed. No generated files or dist output are committed.

No dependencies were added or changed. No screenshots were taken. `roborev` remains unavailable,
so automated per-commit review is pending dispatcher handoff. The requested fix is complete,
with no new design assumptions or open questions. Nothing was fetched, pushed, published or
opened as a PR.

## Fix round 9 — review of `e2ea0703f578`

- `1e7e00a2` — `fix: ignore picker shortcuts during IME composition`: skip input shortcuts
  when the native keyboard event has `isComposing` or the browser fallback `keyCode === 229`.
  Ten regression cases cover ArrowUp/ArrowDown with and without a highlighted contact,
  Enter on a highlighted contact, raw Account ID entry and in-progress name validation,
  including normal Enter behavior after composition ends.
- Final documentation commit — `docs: record IME fix validation`.

All ten new regression cases failed before the guard and pass afterwards. Validation used
Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'IME composition'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=e2ea0703f578dd724d827cd1676617ff82d698b3 pnpm run gate
pnpm run gate:full
git diff --check
git diff --check e2ea0703f578dd724d827cd1676617ff82d698b3 HEAD
```

- Focused regression run: ten failed before the fix; ten passed afterwards, 60 skipped.
- Package gate: passed, 73 tests across 2 files. The initial lint run found formatting in
  the new parameterized test; formatting was corrected before the complete package gate.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 282 successful tasks (345 scheduled, 12 cached), at the previously
  recorded `packages/federation-trust/test/characterization.test.ts:196` test “delegation
  credential structure is stable”. Expected public JWK field order is `crv,x,kty`; received
  order is `kty,crv,x`. This round has no changes in that package. Turbo cancelled the remaining
  tasks; the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace checks: passed. Removed only the 16 untracked callback/client-ID files
  generated by full-gate application builds. No generated files or dist output are committed.

No dependencies were added or changed. No browser was launched and no screenshots were taken,
as required by the lane brief. `roborev` remains unavailable, so automated per-commit review
is pending dispatcher handoff. The requested fix is complete, with no new design assumptions
or open questions. Nothing was fetched, pushed, published or opened as a PR.

## Fix round 10 — review of `a373774ee236`

- `b09b4d74` — `fix: disable consent denial offline`: pass the current offline state to
  `ConfirmAction.disabled`, disabling both Cancel and Deny and guarding the denial callback
  even when connectivity changes with confirmation open. Four regression cases cover initial
  offline rendering and a pending denial, each with and without cached data, plus successful
  denial after reconnecting.
- Final documentation commit — `docs: record consent fix validation`.

All four new regression cases failed before the fix and pass afterwards. Validation used
Node 24 and the checkout's root tool binaries:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-ui exec vitest run test/sharing.test.tsx -t 'consent denial offline'
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
TURBO_SCM_BASE=a373774ee236868890cd90eb2ad08d4adf3967b0 pnpm run gate
pnpm run gate:full
git diff --check
git diff --check a373774ee236868890cd90eb2ad08d4adf3967b0 HEAD
```

- Focused regression run: four failed before the fix; four passed afterwards, 70 skipped.
- Package gate: passed, 77 tests across 2 files.
- Root lint: passed, including workspace, layering, token and contrast guards.
- Affected gate: passed, 13/13 tasks. The consuming suite app passed all 5,993 tests across
  114 files with 100% coverage; its lint reported the same 54 existing warnings.
- Full gate: failed after 294 successful tasks (347 scheduled, 12 cached), at the previously
  recorded `packages/federation-trust/test/characterization.test.ts:196` test “delegation
  credential structure is stable”. Expected public JWK field order is `crv,x,kty`; received
  order is `kty,crv,x`. This round has no changes in that package. Turbo cancelled the remaining
  tasks; the unrelated snapshot remains a full-workspace gate blocker.
- Diff whitespace checks: passed. Removed only the 16 untracked callback/client-ID files
  generated by full-gate application builds. No generated files or dist output are committed.

No dependencies were added or changed. No browser was launched and no screenshots were taken,
as required by the lane brief. `roborev` remains unavailable, so automated per-commit review
is pending dispatcher handoff. The requested fix is complete, with no new design assumptions
or open questions. Nothing was fetched, pushed, published or opened as a PR.
