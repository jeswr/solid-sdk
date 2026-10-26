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
