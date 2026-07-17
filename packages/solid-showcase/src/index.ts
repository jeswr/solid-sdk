// AUTHORED-BY Claude Fable 5
/**
 * @jeswr/solid-showcase — the JSON-driven walkthrough site. One validated walkthrough
 * document drives the whole site: schema + validation, four page renderers, and the
 * walkthrough UI building blocks. Browser-safe; the deploy helpers that consume the
 * document live under `@jeswr/solid-showcase/next`.
 */

// Building blocks
export { ChapterPlayer, type ChapterPlayerProps } from "./components/chapter-player.js";
export {
  DemoIdentityCard,
  type DemoIdentityCardProps,
} from "./components/demo-identity-card.js";
export { EcosystemMap, type EcosystemMapProps } from "./components/ecosystem-map.js";
export { Launcher, type LauncherProps } from "./components/launcher.js";
export { StatusDot } from "./components/status-dot.js";
export { TryLiveButton, type TryLiveButtonProps } from "./components/try-live.js";
export {
  PROBE_TIMEOUT_MS,
  REFRESH_INTERVAL_MS,
  type ServiceStatus,
  STATUS_LABELS,
  useServiceStatuses,
} from "./components/use-service-status.js";
// Document read helpers
export {
  centerRole,
  chapterBySlug,
  documentDisclaimerPack,
  launcherApps,
  registeredApp,
  shellApp,
  shellTheme,
  surroundingRoles,
} from "./document.js";
export {
  ShowcaseChapterPage,
  type ShowcaseChapterPageProps,
} from "./pages/showcase-chapter-page.js";
export {
  ShowcaseCompliancePage,
  type ShowcaseCompliancePageProps,
} from "./pages/showcase-compliance-page.js";
export { ShowcaseLanding, type ShowcaseLandingProps } from "./pages/showcase-landing.js";
// Page-level renderers (the whole walkthrough as four components)
export { ShowcaseLayout, type ShowcaseLayoutProps } from "./pages/showcase-layout.js";
// Schema + inferred document types (branding/theme contracts are composed from
// @jeswr/solid-showcase-kit — import those types from the kit).
export {
  type ChapterStep,
  type ComplianceCheck,
  type ComplianceLens,
  chapterStepSchema,
  complianceCheckSchema,
  complianceLensSchema,
  type DemoPersonaCard,
  type DeployConfig,
  demoPersonaCardSchema,
  deployConfigSchema,
  type EcosystemRole,
  type EditorialLimits,
  ecosystemRoleSchema,
  editorialLimitsSchema,
  type PersonaField,
  personaFieldSchema,
  type QuantifiedAnchor,
  quantifiedAnchorSchema,
  type RegisteredApp,
  registeredAppSchema,
  type ServiceRegistry,
  type SiteIdentity,
  serviceRegistrySchema,
  siteIdentitySchema,
  type WalkthroughChapter,
  type WalkthroughDocument,
  walkthroughChapterSchema,
  walkthroughDocumentSchema,
  walkthroughJsonSchema,
} from "./schema.js";
// Validation
export {
  countWords,
  EDITORIAL_DEFAULTS,
  type EditorialFinding,
  editorialFindings,
  parseWalkthrough,
  type ResolvedEditorialLimits,
  resolveEditorial,
  type WalkthroughIssue,
  WalkthroughValidationError,
  walkthroughWarnings,
} from "./validate.js";
