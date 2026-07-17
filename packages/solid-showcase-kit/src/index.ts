// AUTHORED-BY Claude Fable 5
/**
 * @jeswr/solid-showcase-kit — de-branded disclaimer/branding/trust pack for Solid concept
 * demos. Browser-safe: this root export must never import node builtins (the insignia
 * scanner and e2e helpers live under `@jeswr/solid-showcase-kit/testing`).
 */

export { AppShell, type AppShellProps } from "./app-shell.js";
export {
  type BannedMark,
  type BrandingConfig,
  bannedMarkSchema,
  brandingConfigSchema,
  type ThemeSpec,
  themeSpecSchema,
} from "./branding.js";
export { ConceptDemoBanner, type ConceptDemoBannerProps } from "./concept-demo-banner.js";
export { ConsentInterstitial, type ConsentInterstitialProps } from "./consent-interstitial.js";
export {
  CredentialCard,
  type CredentialCardProps,
  type CredentialStatus,
} from "./credential-card.js";
export { DemoLockedField, type DemoLockedFieldProps } from "./demo-locked-field.js";
export {
  type BannerCopy,
  type BannerCopyOptions,
  type CopySegment,
  copyText,
  createDisclaimerPack,
  DEFAULT_CONSENT_COOKIE_PREFIX,
  DEMO_FIELD_HINT,
  type DemoMetadata,
  type DemoMetadataOptions,
  type DisclaimerPack,
  type DisclaimerVariant,
  type FooterCopyOptions,
  ILLUSTRATIVE_FIGURE_TAG,
  INTERSTITIAL_CONTINUE_LABEL,
  INTERSTITIAL_HEADING,
  INTERSTITIAL_LEARN_MORE_LABEL,
} from "./disclaimers.js";
export { HonestyPanel, type HonestyPanelProps } from "./honesty-panel.js";
export { IllustrativeFigure, type IllustrativeFigureProps } from "./illustrative-figure.js";
export { type ReceiptAction, ReceiptCard, type ReceiptCardProps } from "./receipt-card.js";
export { StatCard, type StatCardProps } from "./stat-card.js";
export {
  type OrgTheme,
  type OrgThemeTokens,
  type PaletteOptions,
  paletteTokens,
  type ThemeStyleProperties,
  themeCssProperties,
  themeFromSpec,
} from "./themes.js";
export {
  ShowcaseTrustProvider,
  type ShowcaseTrustProviderProps,
  type ShowcaseTrustValue,
  useDisclaimerPack,
  useShowcaseTrust,
} from "./trust-context.js";
