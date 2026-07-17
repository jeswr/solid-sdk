---
name: solid-showcase
description: Use when building or modifying a JSON-driven walkthrough site with @jeswr/solid-showcase — authoring or validating walkthrough documents, rendering the four showcase pages, the walkthrough UI components (stepper, try-live, launcher, ecosystem map, persona card), the walkthrough.v1.json schema artifact, or the deploy helpers under ./next (zone rewrites, env matrix, vercel.json, health routes, metadata).
---
<!-- AUTHORED-BY Claude Fable 5 -->

# Work with `@jeswr/solid-showcase`

One validated walkthrough document drives the whole site. Author the document, validate it
with `parseWalkthrough`, render it with the four page components, and wire deploys with the
`./next` helpers. Never fork document content into components — the single registry is the
point.

## The invariants `parseWalkthrough` enforces

All are hard errors, all reported AT ONCE, each with a stable `code` and a message naming
the chapter/step/role/check:

| code | rule |
|---|---|
| `registry-key-mismatch` | every `registry.apps` record key equals its entry's `slug` |
| `unknown-try-live-app` / `unknown-role-app` / `unknown-launcher-app` | every reference resolves in `registry.apps` |
| `duplicate-launcher-app` | `launcherOrder` has no duplicates |
| `duplicate-role-slug` / `center-role` | role slugs unique; exactly one `center: true` role matching `registry.center` |
| `unknown-role-scene` | `roles[].scene` names an existing chapter scene |
| `chapter-scene-order` / `duplicate-chapter-slug` | scenes contiguous 1..N in array order; slugs unique |
| `lead-budget` / `step-budget` / `min-steps` | editorial word/step budgets (defaults 40/65/2) |
| `underneath-required` / `underneath-length` | `underneathRequired` ⇒ non-empty points, each ≥ `minUnderneathChars` (default 20) |
| `unknown-compliance-chapter` / `compliance-scene-mismatch` | checks resolve to chapters with matching scenes |
| `editorial-floor` | overrides only TIGHTEN the schema floors (`minSteps` ≥ 2, `minUnderneathChars` ≥ 20) |
| `persona-honesty` | `persona.descriptor` must contain "fictional" or "simulated" |

`editorialFindings(doc)` returns the budget findings without throwing (CI gate:
`expect(editorialFindings(doc)).toEqual([])`). `walkthroughWarnings(doc)` carries the
non-fatal role-first naming advisory (`modelledOn` must not appear inside `appName`).

## Schema rules

- Schema-first: plain `z.object`s, types inferred. `branding` and `theme` are COMPOSED
  from `@jeswr/solid-showcase-kit` (`brandingConfigSchema`, `themeSpecSchema`) — never
  redeclare them here; kit owns those contracts, and kit never imports from showcase
  (acyclic edge).
- The artifact `schema/walkthrough.v1.json` is GENERATED: after any schema change run
  `pnpm run build && pnpm run generate:schema` and commit the artifact —
  `test/schema-sync.test.ts` fails on drift.
- `registry.apps[].podRoutes` (optional, additive) declares an app's authenticated pod
  API routes; it exists so `envMatrix` can require the forwarded-headers trust var on
  exactly those projects.

## Rendering rules

- `ShowcaseLayout` is client-side ("use client"): it builds the disclaimer pack via
  `documentDisclaimerPack(doc)` (cookie prefix defaults to `{deploy.slug}-demo-consent-`),
  resolves the shell theme from the registry entry at path "/" (neutral fallback
  otherwise), and renders kit AppShell variant "own" + Launcher + ConsentInterstitial.
- Landing/chapter/compliance renderers are server-safe; they pass only serializable
  document data into the client building blocks.
- Chapter routes live at `/chapters/{slug}`, the lens at `/compliance`. Guard unknown
  slugs with `chapterBySlug(doc, slug)` before rendering `ShowcaseChapterPage` — it
  throws on unknown slugs. `ShowcaseCompliancePage` throws when `doc.compliance` is
  absent; only route to it when configured.
- Honest degradation is a contract, not a style: try-live and launcher entries for
  undeployed zones stay VISIBLE as href-less placeholder links with `aria-disabled` and
  an explanation. Never hide them, never leave a navigable href to a dead zone.

## Deploy helpers (`./next`)

- `zoneRewrites(doc, { env?, fallbackSuffix? })` — two rules per zone app (`prefix`,
  `prefix/:path+`); unset env vars fall back to `https://{slug}.invalid` so they can never
  route anywhere real. Zone URLs are read at BUILD time — changing one needs a shell
  redeploy, and the build env allowlist must include the zone vars.
- `envMatrix(doc)` — zone-URL vars target the shell project; the
  `{envPrefix}_TRUST_FORWARDED_HEADERS=1` spec targets exactly the `podRoutes` apps.
- `appVercelJson(app, doc)` — pair with a project-level `rootDirectory` of `apps/{slug}`
  and CLEARED project-level build overrides (they silently win over `vercel.json`).
- `healthRoute(service)` → `export const { GET } = healthRoute("{slug}")`; the payload is
  honestly `simulated: true`. `showcaseMetadata(doc)` is always noindex/nofollow.

## Domain-generic gate (the whole point)

This package is a GENERIC multistakeholder walkthrough framework. No use-case or domain
string may enter `src/`, tests, docs, or shipped artifacts — `test/domain-generic.test.ts`
greps the whole package for a banned-term roster and must stay empty. Real walkthrough
documents (and their golden tests) live in consumer repositories; the fixture here is a
fictional trail-expedition flow. Never "improve" the fixture with real-world content.

Verify API usage against the published dist, run the workspace gate after changes, and
never weaken the malformed-document suite or the grep gate.
