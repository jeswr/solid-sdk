<!-- AUTHORED-BY Claude Fable 5 -->

# @jeswr/solid-showcase-kit

De-branded disclaimer/branding/trust pack for Solid concept demonstrations. One validated
branding config drives every trust surface a showcase renders: the unremovable
concept-demo banner, the consent interstitial, the footer legal line, demo metadata
(noindex), illustrative-figure tags, demo-locked form fields, and honesty panels — plus
per-organisation theming and, under `./testing`, an insignia scanner and e2e assertion
helpers.

The kit's opinion is that a demo must never be mistakable for the real organisations it
is modelled on. The safety copy is therefore **non-removable by construction**: no prop or
configuration path can hide the banner, drop the "all data simulated" / "do not enter real
personal information" copy, or break the interstitial's four-paragraph structure. The
branding config only substitutes the convener, the domain-specific offer negations, and
the purpose clause.

## Usage

```tsx
import {
  AppShell,
  createDisclaimerPack,
  ShowcaseTrustProvider,
  themeFromSpec,
} from "@jeswr/solid-showcase-kit";

const pack = createDisclaimerPack({
  convener: "Open Data Institute",
  description: "show how a vehicle-hire journey could work on Solid personal data stores",
  domainNegations: ["Nothing here is an offer of hire or insurance."],
});
const theme = themeFromSpec(
  { hue: 210, primary: "oklch(0.42 0.08 210)", accent: "oklch(0.7 0.11 85)", role: "hire desk" },
  "Acme Hire",
);

export default function Layout({ children }) {
  return (
    <ShowcaseTrustProvider pack={pack} theme={theme}>
      <AppShell appName="Hire Desk">{children}</AppShell>
    </ShowcaseTrustProvider>
  );
}
```

Components: `AppShell`, `ConceptDemoBanner`, `ConsentInterstitial`, `HonestyPanel`,
`IllustrativeFigure`, `DemoLockedField`, `CredentialCard`, `ReceiptCard`, `StatCard`.

Contracts (zod, schema-first): `brandingConfigSchema`, `themeSpecSchema`,
`bannedMarkSchema` with inferred types `BrandingConfig`, `ThemeSpec`, `BannedMark`.

## `@jeswr/solid-showcase-kit/testing`

Node-only helpers for repo gates and e2e suites: `insigniaFindings` /
`insigniaPathFindings` / `scanInsigniaTree` (a bright-line never-render scanner — content,
file-name, and directory-name checks with no allowlist and no inline suppression), and
`disclaimerAssertions` (runner-agnostic selectors and expected copy for
banner/footer/interstitial assertions).

The scanner is a MECHANISM only: the kit ships no banned-marks roster. Each consumer
supplies its own `bannedMarks` (regulatory insignia, third-party product marks,
certification badges — whatever its domain forbids), typically from its
`BrandingConfig`.

The package root is browser-safe (no node builtins); only `./testing` touches the
filesystem.

See `SKILL.md` for the full knob surface and the list of what is deliberately not
configurable.

## License

MIT © Jesse Wright
