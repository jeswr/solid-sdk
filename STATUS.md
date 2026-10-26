<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-02 lane report — sst-93m.3

Branch: `lane/sst-93m.3`. Base: `87e46ebd2ce33de295357a9610b64d358021b460`.

## Changes by commit

- `e07d1677 feat: add suite primitives and icon atoms`: all §5 shadcn primitives, suite CSS adapters, IconButton, six atoms, source notices and conservative interpretations.
- `cdb37cc4 feat: add primitive and atom fixture catalogs`: dev-only aggregate and individual routes; both densities; screenshot/axe/keyboard/reflow specs.
- `448cca88 test: cover atom mappings and accessible controls`: mapping and jsdom axe tests, AST icon-button lint, keyboard context menus, progress semantics, larger targets, focus and disabled controls; usage documentation.
- `2d66f0dc chore: reuse locked form and test dependencies`: reuse existing resolver and Testing Library versions; preserve unrelated lockfile importers and snapshots. Only six new reachable dependency snapshots remain (Calendar, Resizable, and Calendar's dependencies). Offline frozen installation validates the lockfile.
- Final documentation commit: this report.

Every commit carries the required Co-Authored-By trailer; generated files carry the requested author marker. The lane branch stayed unchanged; no push, PR, publishing, mirror change or other-checkout edit.

## Implementation and fixtures

`packages/suite-ui/src/components/ui/` contains the 35 §5 primitives, plus Label and the required IconButton. `src/components/atoms/` contains AppIcon, FileTypeIcon, ProvenanceBadge, Kbd, StatusDot and CountBadge. All are exported from the package index. Consumers import `styles/components.css` and scan the package with Tailwind v4 `@source`.

Fixtures: `/dev/components/primitives`, `/dev/components/atoms`, and one individual route for each primitive/atom, linked from `/dev/components`. The existing production access guard remains in the parent layout. Fixtures cover both densities; all 15 AppIcons at 32/40/48; all specified file categories; local/missing/failed provenance logos; keyboard labels; five status states; and counts 0/7/99/100. Skeleton, progress, first-use/filtered empties and unreachable error copy appear in the state reference. Error toasts persist with a text Dismiss action; Undo toasts last eight seconds.

## Dependency policy and installation

Command (exit 0, full online policy/existence/age checks; all 21 packages passed, no warnings):

```sh
pnpm run check:packages radix-ui lucide-react class-variance-authority clsx tailwind-merge cmdk sonner next-themes react-day-picker react-resizable-panels react-hook-form zod @hookform/resolvers react react-dom @types/react @types/react-dom @testing-library/react @testing-library/dom jsdom axe-core --strict
```

Each listed package returned `ok`. Runtime packages reuse the lockfile's versions wherever available; Calendar 9.14.0 and Resizable 4.15.0 were not previously present. Testing Library 16.3.2 / DOM 10.4.1 and resolvers 5.4.0 reuse existing versions.

Installation commands:

```sh
CI=true npm_config_cache=/tmp/ds02-npm-cache pnpm install --no-frozen-lockfile --ignore-scripts --store-dir /tmp/ds02-pnpm-store
CI=true npm_config_cache=/tmp/ds02-npm-cache pnpm install --frozen-lockfile --ignore-scripts --offline --store-dir /tmp/ds02-pnpm-store
```

Both final installations passed. `ignore-scripts=true` remains enabled. Existing unrelated peer warnings remain. An initial install attempt used CI's implicit frozen mode against the changed manifest and was corrected with `--no-frozen-lockfile`; intermediate lockfile scoping errors were repaired before the final offline frozen install passed.

## Verification

Final required project commands (all exit 0):

```sh
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=87e46ebd2ce33de295357a9610b64d358021b460 pnpm run gate
pnpm --filter @jeswr/app-suite exec playwright test --list
```

Results: suite-ui lint/build/typecheck pass, 79 tests in four files; app-suite lint/build/typecheck pass, one production-fixture access test. Root lint passes, including workspace/transport/fetch/token guards and all 74 contrast pairs. The final affected Turbo gate scopes only root, suite-ui and app-suite: **10/10 tasks pass**, including 41 root tests. Playwright discovery passes with 582 cases; it launches no browser.

Full-workspace commands (exit 1; outside this lane's changed projects):

```sh
pnpm run gate:full
PATH="/tmp/ds02-git-guard:$PATH" pnpm run gate:full
```

The unguarded full gate stopped in `@jeswr/unstorage-solid#build` because its existing dependency bootstrap invokes npm against the read-only `/home/runner/.npm` cache (EROFS). An earlier affected run, before unrelated lockfile peer churn was removed, hit the same cache failure in `@jeswr/solid-odrl#build`.

**Incidental network operation:** those original repository gate scripts invoked their existing pinned `fetch-rdf` source clone into a temporary directory before hitting the npm cache error. This was unexpected and contrary to the lane's no-network-Git constraint; no lane branch was fetched or merged. Subsequent full-gate execution used a temporary PATH guard that denies network clones/fetch/pull/push, so it stops at the pre-existing `unstorage-solid` bootstrap's clone step without network Git. No bootstrap source or unrelated package was changed. The final full-workspace gate therefore remains blocked; the changed-project gate is green.

`git diff --check` passes. Build output and browser artifacts remain uncommitted.

The suite-ui tests include independently enumerated glyph/badge/app-hue expectations, all atom states with axe, thumbnail/logo failure recovery, local-logo restrictions, count boundaries, disabled icon buttons and keyboard tooltips, dialog focus return, progress values, keyboard context menus, and an AST lint test over suite-ui/apps/suite. jsdom axe disables the layout-dependent color-contrast rule; the token gate checks 74 theme pairs, and dispatcher browser axe checks contrast. jsdom emits one harmless unimplemented canvas warning; tests pass.

## Browser handoff

No Chromium launch and no screenshots were taken, as instructed. No PNGs are committed. Playwright discovery passes: 582 cases across six projects in the two files, comprising 558 DS-02 cases (93 scenarios × 375/768/1280 × light/dark) plus 24 existing DS-01 cases.

`apps/suite/e2e/ds-02-components.spec.ts` captures defaults, disabled controls, hover/focus, overlays, errors, toasts, expanded/selected/toggled states, command filtered-empty, resizing, scrolling and calendar keyboard navigation. Every capture runs axe with zero serious/critical violations required; routes also check 320px reflow. Full-page files target `artifacts/screens/DS-02/<name>-<project>.png`.

Dispatcher command:

```sh
SUITE_E2E_PORT=<port> pnpm --filter @jeswr/app-suite test:e2e
```

Browser axe results, visual comparison against the mockups, and screenshot review remain unverified until that run. The fixtures and E2E specs compile; discovery does not imply browser execution.

## Review and open questions

`roborev` is not installed/on PATH here, so per-commit review verdicts are unavailable. No tracker changes were made in this lane checkout.

[QUESTIONS.md](QUESTIONS.md) records five nonblocking conservative choices: unspecified file badges/hues, the spec's 20px app glyph versus the small mockup glyph, the normative 12px minimum versus smaller mockup badges, unspecified small-atom contracts, and §9's application to async surfaces. These were implemented conservatively; no product decision is blocked.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 1 — review of d18f07436ed1

Only the three requested component-contract findings were changed:

- `c0e234a0 fix: normalize progress fill by maximum`: use Radix's effective maximum for the indicator; cover custom maxima, endpoints, default/fallback maxima and indeterminate values.
- `851ddbd4 fix: preserve invalid control borders`: explicitly restore destructive border precedence over adapter defaults, including checked and indeterminate checkboxes. This conservative fix leaves the existing adapter cascade otherwise intact. A CSS cascade regression test covers inputs, textareas, selects and all checkbox states.
- `9d7bfdee fix: retain density across overlay portals`: capture the existing DOM `data-density` scope at overlay roots using an inert template marker, carry it through React context, and apply it to content and submenu content. Tests cover all nine portal families in both densities, changes/removal while open, triggerless default-open dialogs, nested portals and portalled submenus. Browser specs now assert portalled density, actual dialog/popover control heights, and invalid border colours.
- Final documentation commit: this fix-round validation report.

No dependencies or fixture designs changed. The existing `data-density` consumer API is preserved. No network Git operation, push, PR, branch switch or other-checkout edit was performed in this round.

Validation commands:

```sh
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
PATH="/tmp/ds02-git-guard:$PATH" TURBO_SCM_BASE=d18f07436ed1e8d97ced566e5345897e87e0e28d pnpm run gate
PATH="/tmp/ds02-git-guard:$PATH" pnpm run gate:full
pnpm --filter @jeswr/app-suite exec playwright test --list
git diff --check
```

Package and app lint/build/typecheck/test pass. The final affected gate rebuilds and validates the final source: **9/9 tasks pass**, including root lint/guards, all **111 suite-ui tests** across six files, and the fixture-app test. The harmless jsdom canvas warning remains. The CSS regression test substitutes literal token colours because jsdom cannot resolve CSS custom properties; dispatcher browser assertions use the real compiled styles.

The full-workspace gate exits 1 at the pre-existing `@jeswr/unstorage-solid#build` bootstrap, which attempts `git clone https://github.com/jeswr/fetch-rdf.git`. The temporary PATH guard rejects it before any network Git operation (29 tasks succeeded before the gate stopped). This is the same unrelated blocker documented above; its build scripts were left unchanged.

Playwright discovery passes with **606 cases** across two files and six projects. No browser was launched or screenshots taken, as required by the original brief. Browser execution, actual layout/colour assertions and screenshots remain for the dispatcher. `git diff --check` passes; generated build output is uncommitted. `roborev` remains unavailable on PATH, so per-commit automated verdicts could not be read. All requested fixes are implemented; this fix round adds no open questions.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Fix round 2 — review of a0bd08653bf5

Only the three requested findings were changed, each with regression tests:

- `9012bada fix: preserve slots in form controls`: mark FormControl with `data-form-control` so child slots retain their CSS adapters. Test input and checkbox borders, checkbox minimum dimensions, labels, descriptions and valid state through react-hook-form.
- `fb2befd7 fix: suppress disabled icon button activation`: guard click, double-click, keyboard, pointer and mouse activation while keeping Tab navigation and focus/hover tooltip discovery available. Test disabled and enabled callbacks, real dropdown composition with Enter/Space/ArrowDown/pointer activation, focus tooltips and re-enabling.
- `7a6f0e94 fix: align slider defaults with rendered thumbs`: share the native one-value `[min]` fallback between Radix state and thumb creation. Test actual FormData for default/custom minima, single/range defaults and controlled values, plus keyboard adjustment and focus retention.
- Final documentation commit: this validation report.

Conservative choice: preserve Radix's native single-thumb default. No dependencies, fixture designs or unrelated packages changed. No network Git operation, push, PR, branch switch or other-checkout edit was performed.

Validation commands:

```sh
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
PATH="/tmp/ds02-git-guard:$PATH" TURBO_SCM_BASE=a0bd08653bf5283b8b184ef864680213f0bcae19 pnpm run gate
PATH="/tmp/ds02-git-guard:$PATH" pnpm run gate:full
git diff --check
```

Suite-ui lint/build/typecheck/test pass: **125 tests across six files**. The new regressions reproduced the overwritten slot, disabled dropdown opening and extra empty Slider submission before their fixes. Root lint and guards pass, including all 74 contrast pairs. The affected workspace gate passes **9/9 tasks**, including the dependent suite app's lint/build/typecheck/test. The existing harmless jsdom canvas warning remains.

The full-workspace gate exits 1 at the pre-existing `@jeswr/unstorage-solid#build` dependency bootstrap: it attempts `git clone https://github.com/jeswr/fetch-rdf.git`, which the temporary PATH guard rejects before any network Git operation. **10 tasks succeeded** before the gate stopped. This is the same unrelated blocker documented in earlier rounds; bootstrap scripts were left unchanged. `git diff --check` passes.

No browser was launched or screenshots taken, per the original brief. `roborev` remains unavailable on PATH, so automated per-commit verdicts could not be read. All three requested fixes are complete; no new open questions.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Fix round 3 — review of be60291fbf9e

Only the three findings in `solid-sdk-lane-sst-93m.3-be60291fbf9e.md` were changed, each with regression coverage:

- `d5048592 fix: preserve calendar navigation focus`: hoist Calendar's custom component implementations so controlled month updates retain their identities. Tests navigate twice in each direction, checking the displayed month, the original navigation button and retained focus.
- `93676f7b fix: forward external slider labels to thumbs`: pass `aria-labelledby` to every focusable thumb and omit the direct/fallback label when an external label is supplied. Tests cover single and range sliders, multiple label IDs, precedence over `aria-label`, external labels without `aria-label`, direct labels and the existing numbered fallback labels.
- `78e5d7e6 fix: recognize the canonical pod docs namespace`: correct the mapping to `https://w3id.org/jeswr/pod-docs#Document`, confirmed against the local Pod Docs vocabulary. The corrected mapping regression checks classification, rendered glyph, badge, hue token and axe results.
- Final documentation commit: this validation report, committed last.

Each regression reproduced its reported defect before the corresponding fix. No dependencies, fixture designs or unrelated source files changed. No network Git operation, push, PR, branch switch or other-checkout edit was performed.

Validation commands:

```sh
pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test
pnpm run lint:root
PATH="/tmp/ds02-git-guard:$PATH" TURBO_SCM_BASE=a0bd08653bf5283b8b184ef864680213f0bcae19 pnpm run gate
PATH="/tmp/ds02-git-guard:$PATH" pnpm run gate:full
git diff --check
```

Suite-ui lint/build/typecheck/test pass: **134 tests across six files**. Root lint and guards pass, including all 74 contrast pairs. The affected workspace gate passes **10/10 tasks**, including the dependent suite app's lint/build/typecheck/test and all 41 root tests. The existing harmless jsdom canvas warning remains.

The full-workspace gate exits 1 at the pre-existing `@jeswr/unstorage-solid#build` dependency bootstrap, which attempts `git clone https://github.com/jeswr/fetch-rdf.git`. The existing temporary PATH guard rejects it before any network Git operation. **17 tasks succeeded** before the gate stopped. This is the same unrelated blocker documented in earlier rounds; bootstrap scripts were left unchanged. Gate logs are in `/tmp/sst-93m.3-fix3-gate.log` and `/tmp/sst-93m.3-fix3-gate-full.log`. `git diff --check` passes.

No browser was launched or screenshots taken, per the original brief. `roborev` remains unavailable on PATH, so automated per-commit verdicts could not be read. All three requested fixes are complete; no new open questions.
