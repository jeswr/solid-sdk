---
name: create-solid-demo
description: Use when bootstrapping a new multistakeholder pod-data walkthrough with npx create-solid-demo — choosing flags, editing the generated walkthrough.json, seeding the demo persona, wiring the banned-marks insignia roster, resolving the @jeswr framework deps before their npm publish, or deploying the generated monorepo to Vercel.
---
<!-- AUTHORED-BY Claude Fable 5 -->

# Bootstrap a walkthrough with `create-solid-demo`

The scaffolder is domain-generic: your flags carry the ONLY domain content, and
they all land in `apps/tour/content/walkthrough.json` — the single edit surface.

## 1. Scaffold

```sh
npx create-solid-demo my-demo \
  --use-case <slug> --convener "<org>" \
  --negation "<full-sentence offer negation>" \
  --app <slug>:"<Name>":"<role>" [--app …] \
  --modelled-on <slug>="<Organisation>"
```

- The FIRST `--app` is the data subject's own custodian seat (ecosystem centre).
- App slugs become paths, package names, and zone env vars — pick role-derived,
  neutral slugs, never organisation marks (R4).
- `--no-install` skips `pnpm install`; `--seed` runs the persona seed after
  install (needs the seed target env vars).
- **Until the @jeswr framework packages are on npm**, `pnpm install` needs
  `pnpm.overrides` `file:`/git pins for them — the generated
  `docs/deploy.md § Framework dependency status` shows the exact shape.

## 2. Edit walkthrough.json

Everything renders from the document: site copy, anchors, registry (apps,
themes, honesty, launcher, zone envs), chapters, optional compliance lens.
After every edit run the gates — `pnpm test` (the tour's walkthrough test runs
`parseWalkthrough` + `editorialFindings`). Rules that bite:

- Chapter scenes contiguous from 1; every `tryLive.app` a registry key; word
  budgets 40 (lead) / 65 (step); ≥2 steps per chapter.
- `persona.descriptor` must self-identify as fictional/simulated.
- `branding.bannedMarks` starts EMPTY — add your domain's never-render marks
  (`{"pattern": "\\bMARK\\b", "reason": "…"}`); `pnpm check:insignia` then
  scans the whole tree. The framework ships no roster.
- Anchors need public, dereferenceable source URLs — `pnpm lint:iris`
  HEAD-checks them (7-day cache). Add none you cannot cite.

## 3. Seed

`seeds/persona.ts` must stay in sync with `walkthrough.persona`. Configure
`<PREFIX>_SEED_POD_URL` + `<PREFIX>_SEED_WEBID` (an existing dev-server
account), then `pnpm run seed` — deterministic, `ensure`-mode, safe to re-run.
Extend `seeds/seed.config.ts` + `packages/data-model/shapes/` as the walkthrough
grows; keep shape identities in real namespaces or `urn:example:`.

## 4. Deploy

Read the generated `docs/deploy.md` FIRST. Non-negotiables: one Vercel project
per app with `rootDirectory=apps/<slug>` and CLEARED project-level build
overrides; zone-URL vars on the shell project (build-time);
`<PREFIX>_TRUST_FORWARDED_HEADERS=1` plus the issuer/origin allowlists on every
pod-route app (the rail fails closed while unset); preview-SSO **or** the
interstitial, never neither; neutral slugs.

## Working on the scaffolder itself

`template/` is the source of truth for generated files; per-app files live under
`template/apps/__app__` with `__CSD_*__` tokens. Dotfiles ship as rename shims
(`npmrc`, `gitignore`, `env.example`, `github/`) — never add a literal dotfile
to the template (npm pack strips it; `scripts/build.mjs` fails the build).
The bin ships COMPILED (`dist/bin.mjs`, esbuild) via the EXPLICIT `build`
script — never move it into a `prepack` hook (`ignore-scripts=true` would drop
`dist/` from the tarball). Keep the domain-generic grep gate green: no use-case
term anywhere, fixtures stay fictional. Slow verify: `RUN_SLOW=1 pnpm test`.
