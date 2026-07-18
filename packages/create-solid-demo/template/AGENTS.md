# AGENTS.md — __CSD_TITLE__ walkthrough

> A README for coding agents. `CLAUDE.md` is a symlink to this file. This repo was
> scaffolded by `create-solid-demo` from the @jeswr Solid showcase framework.

## What this is

A multistakeholder pod-data walkthrough: a pnpm + Turborepo monorepo whose tour
shell (`apps/tour`) renders ENTIRELY from one JSON document, plus one skeleton
app per ecosystem seat. Every branded surface is a concept demonstration — all
data simulated, no real PII, `noindex` everywhere.

## Non-negotiable conventions

1. **Single edit surface**: `apps/tour/content/walkthrough.json` drives the whole
   tour — copy, registry, themes, honesty panels, launcher, zone rewrites. Edit
   the document, not the components. `parseWalkthrough` + `editorialFindings`
   (from `@jeswr/solid-showcase`) gate it in `apps/tour/test/walkthrough.test.ts`.
2. **Trust surfaces are non-removable**: the concept-demo banner, footer legal
   line, and consent interstitial come from `@jeswr/solid-showcase-kit`; the fixed
   safety copy cannot be configured away. Never bypass `AppShell`.
3. **Pod routes fail closed**: every authenticated pod route goes through
   `@jeswr/solid-pod-guard` (`createPodRouteGuard`) — 401 before validation,
   pod/webid overrides rejected, 503 while unconfigured. Never hand-roll auth.
4. **RDF discipline**: typed accessors over `@solid/object` + `@rdfjs/wrapper`,
   fetch+parse via `@jeswr/fetch-rdf`, serialize with `n3.Writer`. Never
   hand-built triples, never string-concatenated `.acl`.
5. **No minted IRIs**: only real, dereferenceable namespaces (schema.org, W3C, …)
   or `urn:example:` for local shape identities; `pnpm lint:iris` HEAD-checks
   document IRIs.
6. **Honest branding**: apps are "modelled on" organisations, never "by" them;
   hostnames and slugs derive from ROLES, never from modelled-on org names.
   `branding.bannedMarks` in the walkthrough document is YOUR domain's
   never-render roster (the framework ships none) — `pnpm check:insignia`
   enforces it.
7. **Supply chain**: `.npmrc` sets `ignore-scripts=true`; CI installs with
   `--frozen-lockfile`.

## Gates

`pnpm lint && pnpm typecheck && pnpm test` must stay green; `pnpm build` builds
every app; `pnpm lint:iris` and `pnpm check:insignia` gate CI. E2e disclaimers +
axe: `pnpm e2e` (needs Playwright browsers: `pnpm exec playwright install`).
