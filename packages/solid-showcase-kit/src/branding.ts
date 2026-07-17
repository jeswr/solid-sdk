// AUTHORED-BY Claude Fable 5
/**
 * Branding/theming contracts OWNED by this kit — the single runtime source of truth that
 * downstream document schemas (e.g. a walkthrough document's `branding`/`theme` fields)
 * compose from. Schema-first: each schema is a plain `z.object` with NO type annotation,
 * and the TypeScript contract is INFERRED from it — never the other way around.
 *
 * The kit is the base of the dependency edge: it never imports from any showcase/renderer
 * package. It is also domain-generic by design: nothing in these contracts (or anywhere
 * in the kit) is specific to any industry — domain knowledge enters only through the
 * values a consumer supplies.
 */
import { z } from "zod";

/**
 * A mark that must never render on a demo surface (regulatory insignia, third-party
 * product marks, certification badges — whatever the consumer's domain forbids).
 *
 * `pattern` is a JavaScript regular-expression SOURCE string. It compiles
 * case-insensitively unless it contains an uppercase character, in which case it compiles
 * case-SENSITIVELY (so a standalone-token rule like `\bXYZ\b` does not match prose
 * lowercase "xyz").
 */
export const bannedMarkSchema = z.object({
  pattern: z.string(),
  reason: z.string(),
});

/**
 * A per-organisation palette spec: a neutral hue anchor plus primary/accent colours.
 * Palette-INSPIRED, adjacent-but-distinct by policy — original colour values only, never
 * brand-guideline colours.
 */
export const themeSpecSchema = z.object({
  hue: z.number(),
  primary: z.string(),
  accent: z.string(),
  primaryForeground: z.string().optional(),
  accentForeground: z.string().optional(),
  role: z.string(),
});

/**
 * Everything a use case may configure about the trust/disclaimer surfaces.
 *
 * - `convener`: display name substituted through every disclaimer string ("A research
 *   prototype by the {convener}", "built by the {convener}", …). Trimmed; must be
 *   non-blank.
 * - `domainNegations`: full-sentence offer negations appended to the FIXED safety copy.
 *   The first entry is the primary negation (banner + footer; compact surfaces derive a
 *   "Not …" form from a leading "Nothing here is …"). Entries after the first replace the
 *   primary inside the consent interstitial's simulation paragraph, joined in order —
 *   when only one entry is given it serves both surfaces.
 * - `description`: purpose clause completing "This site is a research prototype built by
 *   the {convener} to {description}." (no trailing period). Trimmed; must be non-blank.
 * - `bannedMarks`: the consumer's own never-render roster for the `./testing` insignia
 *   scanner. The kit ships NO built-in list — domain rosters live with consumers.
 * - The fixed safety copy ("All data simulated", "Do not enter real personal
 *   information", …) is NOT configurable and always renders.
 */
export const brandingConfigSchema = z.object({
  convener: z.string().trim().min(1),
  domainNegations: z.array(z.string()),
  description: z.string().trim().min(1),
  aboutHref: z.string().optional(),
  consentCookiePrefix: z
    .string()
    .regex(/^[a-z0-9-]+-$/)
    .optional(),
  illustrativeTag: z.string().optional(),
  bannedMarks: z.array(bannedMarkSchema).optional(),
});

export type BannedMark = z.infer<typeof bannedMarkSchema>;
export type ThemeSpec = z.infer<typeof themeSpecSchema>;
export type BrandingConfig = z.infer<typeof brandingConfigSchema>;
