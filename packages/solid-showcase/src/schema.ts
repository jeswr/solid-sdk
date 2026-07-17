// AUTHORED-BY Claude Fable 5
/**
 * The walkthrough document schema — the single JSON document that drives a whole
 * walkthrough site (landing, chapters, ecosystem map, launcher, compliance lens, deploy
 * helpers).
 *
 * Schema-first: every schema is a plain `z.object` with NO type annotation and the
 * TypeScript contracts are INFERRED from them. The shipped JSON-Schema artifact
 * (`schema/walkthrough.v1.json`) is generated from {@link walkthroughDocumentSchema} via
 * {@link walkthroughJsonSchema}, so neither the types nor the artifact can drift from the
 * runtime validator.
 *
 * Branding and theming contracts are COMPOSED from `@jeswr/solid-showcase-kit` — the kit
 * owns them (`branding: brandingConfigSchema`, `theme: themeSpecSchema`); this package
 * owns only the document-shaped types. The dependency edge is acyclic: showcase depends
 * on kit, never the reverse.
 *
 * This package is domain-generic by design: nothing in the schema (or anywhere in this
 * package) names a use case — domain knowledge enters only through the values of the
 * document a consumer supplies.
 */
import { brandingConfigSchema, themeSpecSchema } from "@jeswr/solid-showcase-kit";
import { z } from "zod";

const LOWER_SLUG = /^[a-z0-9-]+$/;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const ABSOLUTE_PATH = /^\//;

/** Site-wide identity + hero copy for the walkthrough shell. */
export const siteIdentitySchema = z.object({
  /** e.g. "Open Trails Walkthrough" */
  appName: z.string().min(1),
  /** Publishing organisation (the convener) — drives the "own" disclaimer variant. */
  organization: z.string().min(1),
  heroTitle: z.string(),
  /** Two-sided value headline. */
  heroLead: z.string(),
  heroParagraph: z.string(),
  startCtaLabel: z.string().optional(),
  exploreCtaLabel: z.string().optional(),
});

export const personaFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** Renders a copy-to-clipboard action; defaults to true. */
  copyable: z.boolean().optional(),
  note: z.string().optional(),
});

/** Copy-ready demo identity; the descriptor MUST self-identify as fictional/simulated. */
export const demoPersonaCardSchema = z.object({
  name: z.string(),
  descriptor: z.string(),
  fields: z.array(personaFieldSchema).min(1),
  /** Rendered under the card, e.g. the scripted thresholds the values are pinned to. */
  footnote: z.string().optional(),
});

/** Landing stat-row anchor; the source URL must be public and dereferenceable. */
export const quantifiedAnchorSchema = z.object({
  id: z.string(),
  value: z.string(),
  label: z.string(),
  detail: z.string(),
  source: z.object({
    name: z.string(),
    url: z.url().startsWith("https://"),
  }),
});

/** A registered demo surface. Zone apps resolve through the shell's multi-zone rewrites. */
export const registeredAppSchema = z.object({
  slug: z.string().regex(LOWER_SLUG),
  appName: z.string(),
  /** Role-first honest branding: "modelled on X". Never "by X". */
  modelledOn: z.string(),
  /** In-shell path (zone rewrite prefix, or a shell-local route). */
  path: z.string().regex(ABSOLUTE_PATH),
  /** Env var the shell rewrite reads; absent = shell-local surface. */
  zoneEnv: z.string().regex(ENV_VAR_NAME).optional(),
  healthPath: z.string().regex(ABSOLUTE_PATH),
  /** Palette-inspired theme, never brand-guideline values. */
  theme: themeSpecSchema.optional(),
  /** HonestyPanel content — single-sourced here so apps and the shell agree. */
  honesty: z
    .object({
      real: z.array(z.string()),
      simulated: z.array(z.string()),
    })
    .optional(),
  /**
   * Authenticated pod API routes this app serves (app-relative paths). Declaring any
   * makes the deploy env matrix require `{envPrefix}_TRUST_FORWARDED_HEADERS` on the
   * app's project — behind a proxy the proof's bound URL must be computed from the
   * public host, or every authenticated call fails.
   */
  podRoutes: z.array(z.string().regex(ABSOLUTE_PATH)).optional(),
});

/** A seat in the ecosystem map. Empty `apps` = mapped seat with no app (shown honestly). */
export const ecosystemRoleSchema = z.object({
  slug: z.string(),
  /** Value-chain number; absent for the centre node. */
  roleNumber: z.int().min(1).optional(),
  role: z.string(),
  modelledOn: z.string(),
  /** Honest recruitment framing, e.g. "External approach". */
  membership: z.string(),
  summary: z.string(),
  scene: z.int().min(1).optional(),
  /** Keys of registry.apps. */
  apps: z.array(z.string()),
  center: z.boolean().optional(),
});

/** The ONE source for map/launcher/try-live/zones. */
export const serviceRegistrySchema = z.object({
  /** Keyed by slug. The shell itself registers too (zoneEnv absent). */
  apps: z.record(z.string(), registeredAppSchema),
  /** Launcher dock order; every entry must be a key of `apps`. */
  launcherOrder: z.array(z.string()),
  roles: z.array(ecosystemRoleSchema),
  /** Slug of the centre role (the data-subject's own vault/pod). */
  center: z.string(),
});

export const chapterStepSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  /** `app` must be a registry key. */
  tryLive: z.object({
    app: z.string(),
    label: z.string().min(1),
  }),
});

export const walkthroughChapterSchema = z.object({
  slug: z.string().regex(LOWER_SLUG),
  /** 1-based, contiguous, in array order. */
  scene: z.int().min(1),
  title: z.string(),
  /** The regulation/industry anchor the scene dramatizes. */
  anchor: z.string().min(10),
  lead: z.string(),
  steps: z.array(chapterStepSchema).min(2),
  /** Plain-English "what just happened underneath". */
  underneath: z.array(z.string().min(20)).optional(),
  /** Enforce presence of `underneath` (the protocol/proof beats). Default false. */
  underneathRequired: z.boolean().optional(),
});

/**
 * Editorial overrides may only TIGHTEN the schema floors, never loosen them: the
 * generated JSON-Schema pins the absolute minimums (steps minItems 2, underneath
 * minLength 20), and zod rejects minSteps < 2 / minUnderneathChars < 20 — so no valid
 * override can conflict with the schema.
 */
export const editorialLimitsSchema = z.object({
  maxLeadWords: z.int().min(1).optional(),
  maxStepWords: z.int().min(1).optional(),
  minSteps: z.int().min(2).optional(),
  minUnderneathChars: z.int().min(20).optional(),
});

export const complianceCheckSchema = z.object({
  id: z.string(),
  /** The public rule, plain English. */
  rule: z.string(),
  citation: z.string(),
  citationUrl: z.url().startsWith("https://"),
  scene: z.int(),
  /** Must resolve to a chapter whose scene equals `scene`. */
  chapterSlug: z.string(),
  /** What the lens checks in the demo journey. */
  observe: z.string(),
});

/** The regulator/reviewer lens, rendered deliberately unbranded. */
export const complianceLensSchema = z.object({
  title: z.string(),
  /** Mandatory non-affiliation statement rendered in the lens chrome. */
  nonAffiliation: z.string().min(20),
  checks: z.array(complianceCheckSchema),
});

export const deployConfigSchema = z.object({
  /** Use-case slug — drives cookie prefix + generated names. */
  slug: z.string().regex(LOWER_SLUG),
  /** Env-var prefix — drives `{envPrefix}_TRUST_FORWARDED_HEADERS` etc. */
  envPrefix: z.string().regex(ENV_VAR_NAME),
});

/** The whole walkthrough site, as data. Version is a literal — breaking changes bump it. */
export const walkthroughDocumentSchema = z.object({
  version: z.literal(1),
  site: siteIdentitySchema,
  branding: brandingConfigSchema,
  persona: demoPersonaCardSchema,
  /** 0–6; landing stat row. */
  anchors: z.array(quantifiedAnchorSchema).max(6),
  registry: serviceRegistrySchema,
  /** ≥1, scene numbers contiguous from 1. */
  chapters: z.array(walkthroughChapterSchema).min(1),
  /** Defaults applied when absent. */
  editorial: editorialLimitsSchema.optional(),
  compliance: complianceLensSchema.optional(),
  deploy: deployConfigSchema,
});

export type SiteIdentity = z.infer<typeof siteIdentitySchema>;
export type PersonaField = z.infer<typeof personaFieldSchema>;
export type DemoPersonaCard = z.infer<typeof demoPersonaCardSchema>;
export type QuantifiedAnchor = z.infer<typeof quantifiedAnchorSchema>;
export type RegisteredApp = z.infer<typeof registeredAppSchema>;
export type EcosystemRole = z.infer<typeof ecosystemRoleSchema>;
export type ServiceRegistry = z.infer<typeof serviceRegistrySchema>;
export type ChapterStep = z.infer<typeof chapterStepSchema>;
export type WalkthroughChapter = z.infer<typeof walkthroughChapterSchema>;
export type EditorialLimits = z.infer<typeof editorialLimitsSchema>;
export type ComplianceCheck = z.infer<typeof complianceCheckSchema>;
export type ComplianceLens = z.infer<typeof complianceLensSchema>;
export type DeployConfig = z.infer<typeof deployConfigSchema>;
export type WalkthroughDocument = z.infer<typeof walkthroughDocumentSchema>;

/**
 * The generated JSON-Schema artifact, exactly as shipped at
 * `@jeswr/solid-showcase/schema/walkthrough.v1.json`. `scripts/generate-schema.mjs`
 * writes this to disk; a unit test asserts the committed artifact stays byte-identical
 * to this output.
 *
 * `$id` is the bare artifact name: a hosted, dereferenceable IRI is deferred until one
 * actually resolves (no minted IRIs).
 */
export function walkthroughJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(walkthroughDocumentSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  const { $schema, ...rest } = generated;
  return {
    // biome-ignore lint/style/useNamingConvention: fixed JSON-Schema wire field
    $schema,
    // biome-ignore lint/style/useNamingConvention: fixed JSON-Schema wire field
    $id: "walkthrough.v1.json",
    title: "WalkthroughDocument",
    ...rest,
  };
}
