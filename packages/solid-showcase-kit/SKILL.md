---
name: solid-showcase-kit
description: Use when building or modifying the trust/disclaimer surfaces of a Solid concept demo with @jeswr/solid-showcase-kit — branding configs, disclaimer packs, the concept-demo banner/interstitial/app shell, org theming, or the insignia scanner and e2e assertions under ./testing.
---
<!-- AUTHORED-BY Claude Fable 5 -->

# Work with `@jeswr/solid-showcase-kit`

The de-branded disclaimer/branding/trust pack every showcase surface renders from. One
validated `BrandingConfig` drives ALL trust copy; components refuse to render without it.
The kit is the BASE of the dependency edge: it never imports from any showcase/renderer
package, and document schemas downstream compose from the zod schemas exported here.

## The one wiring pattern

```tsx
import {
  AppShell, brandingConfigSchema, createDisclaimerPack,
  ShowcaseTrustProvider, themeFromSpec,
} from "@jeswr/solid-showcase-kit";

const branding = brandingConfigSchema.parse(walkthrough.branding); // or a literal
const pack = createDisclaimerPack(branding);                       // frozen copy factories
const theme = themeFromSpec(spec, "Modelled Org");                 // spec is registry data

// Root layout, once per app:
<ShowcaseTrustProvider pack={pack} theme={theme}>
  <AppShell appName="Data Vault">{children}</AppShell>
</ShowcaseTrustProvider>;

// Layout metadata (server side, no provider needed):
export const metadata = pack.demoMetadata({ appName, organization });
```

- Schemas are the runtime source of truth: `bannedMarkSchema`, `themeSpecSchema`,
  `brandingConfigSchema`; the types (`BannedMark`, `ThemeSpec`, `BrandingConfig`) are
  `z.infer` of them. Compose downstream document schemas from the schemas, never redeclare.
- Components resolve the pack from an explicit `pack` prop, else the nearest
  `ShowcaseTrustProvider`; with neither they THROW (fail closed — a trust surface must
  never render bare). `IllustrativeFigure` alone falls back to the default tag so the
  qualifier always renders.
- Palette DATA lives with consumers (registry/walkthrough documents); the kit ships only
  the factories (`paletteTokens`, `themeFromSpec`, `themeCssProperties`). Original colour
  values only — never brand-guideline colours.

## The knob surface (the R1–R8 trust rules, generalised)

| Rule | Knob in `BrandingConfig` | What stays fixed in code |
|---|---|---|
| R1 banner copy | `convener`; `domainNegations[0]` (primary negation); `aboutHref` | Lead structure ("Concept demo — this is not {Org}."), "All data is simulated.", the About link, rendering itself |
| R2/R3 insignia + product-mark bans | `bannedMarks` — the consumer's own never-render roster (`pattern` casing: uppercase source ⇒ case-sensitive) | The scanner mechanism; no allowlist, no inline suppression. The kit ships NO built-in roster — what is banned is domain knowledge and lives with the consumer |
| R4 neutral hostnames | none — an operator/scaffolder rule, not kit code | — |
| R5 illustrative tag | `illustrativeTag` text (non-blank; blank falls back) | The tag always renders inside the same element as the figure |
| R6 metadata | derived from `convener` only | "— Concept Demo (not {Org})" title suffix; noindex/nofollow |
| R7 demo-locked fields | supplemental `hint` prop only | `DEMO_FIELD_HINT` always renders; read-only default |
| R8 interstitial | `consentCookiePrefix`; `description` (purpose clause); negations | Four-paragraph structure, heading/labels, affirmative-continue, Escape never dismisses |

`domainNegations` semantics: full sentences. `[0]` is the primary negation — banner
(verbatim) + compact/footer (a leading "Nothing here is …" becomes "Not …"). Entries
after the first replace the primary inside the interstitial's simulation paragraph,
joined in order; a single entry serves both. `description` completes "…built by the
{convener} to {description}." — no trailing period.

## Deliberately NOT configurable

- The banner cannot be hidden: no prop suppresses it, and `AppShell` renders it directly
  below the header (four-Ps adjacency) unconditionally, plus the footer legal line.
- The fixed safety copy always renders: "All data is simulated." / "Simulated data." /
  "All data simulated" / "Do not enter real personal information" / "Everything here is
  simulated." / "Do not enter real personal or financial information. Use the demo
  personas provided." — `domainNegations` only EXTENDS it (empty array ⇒ safety copy
  still renders).
- The interstitial's four-paragraph structure and its "own"-variant collective negation.
- `demoMetadata` is always `noindex, nofollow`.
- The pack object is frozen; copy cannot be patched out after creation.

Do not fork copy into consumers: unit and e2e suites must assert against the SAME pack
the components render from (that is the whole point of the pack).

## `@jeswr/solid-showcase-kit/testing` (node-only subpath)

- `insigniaFindings(text, { bannedMarks })` — content scan of a text blob (per-line plus
  a whitespace-normalised cross-line pass, so marks split across line breaks are caught);
  `insigniaPathFindings(path, …)` — file-path check (catches a revealing asset name or
  directory even when the binary content cannot be grepped); `scanInsigniaTree(dirs,
  { rootDir, … })` — full walker (path + content, skipping
  `node_modules`/`dist`/`.next`/`.turbo`; symlinks in a scanned tree are REJECTED, never
  silently skipped). A repo's `check-insignia` script is a thin wrapper: scan
  rendered-source dirs with the repo's own `bannedMarks`, exit 1 on findings.
- `disclaimerAssertions` — runner-agnostic selectors + expected copy derived from a pack
  (`expectedBannerText`, `expectedFooterText`, `expectedNegationParagraph`).
- The package ROOT is browser-safe by contract (no node builtins) — never re-export
  testing modules from it; a unit test enforces this.

## Golden-test split (kit vs consumer)

The kit's own golden suite (`test/disclaimers.test.ts`) pins the strings a fully
FICTIONAL branding fixture produces — it proves the PARAMETERISATION mechanism, not any
real project's copy. Each real consumer must additionally keep its own golden vectors in
its own repository: pass its real `BrandingConfig` to `createDisclaimerPack` and assert
its exact rendered strings literally (its adoption step / copy-drift gate). Never move a
real project's branding or copy into this package's tests or docs.

Verify API usage against the published dist, run the workspace gate after changes, and
never weaken the golden copy tests or the safety-invariant suite.
