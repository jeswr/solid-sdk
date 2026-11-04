<!-- AUTHORED-BY Claude Opus 5.5 -->
# DS-13 visual baselines

Baselines for the two corner projects, `375-light` and `1280-dark`, written by
`e2e/visual/components.visual.spec.ts` through `playwright.visual.config.ts`. The other four
width and theme projects run the same pages for the axe check only (all six would be ~48 MB).

These PNGs are **Linux-container renders** (headless Chromium from the Playwright 1.61
build, the suite's self-hosted fonts, `en-GB`, UTC, a fixed clock). Font rasterisation differs
on macOS and Windows, so they only match on the same Linux image. That is why this suite is
excluded from the default `playwright test` run (`testIgnore` in `playwright.config.ts`) and
from CI.

- Check: `pnpm test:visual` (from `apps/suite`; fails on a diff above 0.1% of pixels or any
  axe serious/critical violation).
- Refresh after an intended visual change: `pnpm test:visual:update`, then review the changed
  PNGs before committing them.
