<!-- AUTHORED-BY Claude Fable 5 -->

# @jeswr/solid-showcase

The JSON-driven walkthrough site: a generic framework for taking people through a
multistakeholder interaction flow for data held in Solid pods. One validated **walkthrough
document** drives the whole site — landing page, guided chapters, ecosystem map, launcher
dock, compliance lens, and the deploy wiring — so a new use case is authored as data, not
as code.

The package is deliberately **domain-generic**: nothing in it names any industry or use
case (a unit test enforces this). Domain knowledge — organisations, rules, personas,
copy — enters only through the document a consumer supplies at runtime.

## The document

```ts
import { parseWalkthrough, editorialFindings } from "@jeswr/solid-showcase";
import walkthroughJson from "./content/walkthrough.json";

const walkthrough = parseWalkthrough(walkthroughJson); // throws with EVERY issue, named
console.assert(editorialFindings(walkthrough).length === 0);
```

`parseWalkthrough` validates shape (zod) plus the cross-reference rules JSON-Schema cannot
express: every try-live/launcher/role app resolves in the single service registry, registry
keys equal their entry slugs, exactly one centre role matches `registry.center`, chapter
scenes are contiguous 1..N, editorial budgets hold (lead/step word counts, minimum steps,
required "underneath" panels), compliance checks resolve to their chapters with matching
scenes, and the demo persona self-identifies as fictional/simulated.

The zod schemas are the single source of truth: the TypeScript types are inferred from
them, and the JSON-Schema artifact at `@jeswr/solid-showcase/schema/walkthrough.v1.json`
is generated from the same schemas (`pnpm run generate:schema`), with a test pinning the
artifact in sync. Branding and theme contracts are composed from
`@jeswr/solid-showcase-kit` (`branding: brandingConfigSchema`, `theme: themeSpecSchema`) —
the kit owns those; this package owns the document shapes. The edge is acyclic: showcase
depends on kit, never the reverse.

## The four page renderers

```tsx
import {
  ShowcaseLayout, ShowcaseLanding, ShowcaseChapterPage, ShowcaseCompliancePage,
} from "@jeswr/solid-showcase";

// app/layout.tsx        → <ShowcaseLayout document={walkthrough}>{children}</ShowcaseLayout>
// app/page.tsx          → <ShowcaseLanding document={walkthrough} />
// app/chapters/[slug]/  → <ShowcaseChapterPage document={walkthrough} slug={slug} />
// app/compliance/       → <ShowcaseCompliancePage document={walkthrough} />
```

Building blocks are exported too: `ChapterPlayer` (keyboard-navigable stepper),
`TryLiveButton` and `Launcher` (honest degradation — an undeployed zone stays visible as a
disabled placeholder link, never hidden and never navigable), `EcosystemMap`,
`DemoIdentityCard` (copy-to-clipboard persona card), `StatusDot`, and
`useServiceStatuses` (same-origin health probes with timeouts and periodic refresh).

## Deploy helpers — `@jeswr/solid-showcase/next`

```ts
import {
  zoneRewrites, envMatrix, appVercelJson, healthRoute, showcaseMetadata,
} from "@jeswr/solid-showcase/next";

// next.config.ts (shell): multi-zone rewrites from every registry app with a zoneEnv
const nextConfig = { rewrites: () => zoneRewrites(walkthrough) };

// app/api/health/route.ts (each app)
export const { GET } = healthRoute("vault");

// Shell layout metadata: concept-demo title suffix + noindex/nofollow
export const metadata = showcaseMetadata(walkthrough);
```

`envMatrix(doc)` returns the full per-project env-var matrix: one zone-URL var per zone
app (set on the shell project; read at build time), and
`{envPrefix}_TRUST_FORWARDED_HEADERS=1` on every app that declares `podRoutes` — behind a
proxy, authenticated pod routes must compute their bound request URL from the public host.
`appVercelJson(app, doc)` emits the per-app `vercel.json` (framework pin, workspace turbo
build, turbo-ignore).

## Install

```sh
npm install @jeswr/solid-showcase react
```

MIT © the @jeswr Solid suite. See `SKILL.md` for agent-facing guidance.
