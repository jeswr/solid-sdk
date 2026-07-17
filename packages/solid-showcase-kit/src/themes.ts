// AUTHORED-BY Claude Fable 5
/**
 * Per-organisation theme factory.
 *
 * Policy the factory encodes: palette-INSPIRED, adjacent-but-distinct — a theme sits in
 * the hue neighbourhood of the modelled organisation's public palette family but
 * deliberately does NOT reproduce any brand-guideline colour value; every token should be
 * an original (e.g. oklch) value. No logos or trade dress anywhere; naming is role-first
 * ("modelled on X", never "by X"). The palette DATA stays with consumers (registry /
 * walkthrough documents) — this module ships only the generic factory.
 *
 * Consumption: the tokens are CSS custom properties matching the common `globals.css`
 * convention (`--background`, `--primary`, …) which each app maps to Tailwind via
 * `@theme inline` (`--color-background: var(--background)`, …). Apply a theme by
 * spreading `themeCssProperties(theme)` onto a wrapper's `style` — `AppShell` does this
 * for you. Apps that use the `accent` tokens must add the
 * `--color-accent`/`--color-accent-foreground` mappings to their `@theme inline` block.
 */
import { type ThemeSpec, themeSpecSchema } from "./branding.js";

export interface OrgThemeTokens {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  muted: string;
  "muted-foreground": string;
  border: string;
  primary: string;
  "primary-foreground": string;
  accent: string;
  "accent-foreground": string;
}

export interface OrgTheme {
  /** Optional stable identifier (consumers may key registries by it). */
  id?: string | undefined;
  /** Display name for the "modelled on {X}" framing. */
  modelledOn: string;
  /** Journey role; reads well in "the {role} role" and in header framing. */
  role: string;
  tokens: OrgThemeTokens;
}

const LIGHT_FOREGROUND = "oklch(0.985 0.003 250)";

export interface PaletteOptions {
  /** Neutral hue anchor for background/foreground/muted/border. */
  hue: number;
  primary: string;
  primaryForeground?: string | undefined;
  accent: string;
  accentForeground?: string | undefined;
}

/** Derive the full token set from a hue anchor + primary/accent colours. */
export function paletteTokens(options: PaletteOptions): OrgThemeTokens {
  const { hue } = options;
  return {
    accent: options.accent,
    "accent-foreground": options.accentForeground ?? LIGHT_FOREGROUND,
    background: `oklch(0.985 0.004 ${hue})`,
    border: `oklch(0.87 0.018 ${hue})`,
    card: "oklch(1 0 0)",
    "card-foreground": `oklch(0.21 0.03 ${hue})`,
    foreground: `oklch(0.21 0.03 ${hue})`,
    muted: `oklch(0.93 0.012 ${hue})`,
    "muted-foreground": `oklch(0.45 0.03 ${hue})`,
    primary: options.primary,
    "primary-foreground": options.primaryForeground ?? LIGHT_FOREGROUND,
  };
}

/**
 * Build an {@link OrgTheme} from a data-driven {@link ThemeSpec} (validated with
 * {@link themeSpecSchema}; throws on violation) and the modelled organisation's display
 * name.
 */
export function themeFromSpec(spec: ThemeSpec, modelledOn: string): OrgTheme {
  const parsed = themeSpecSchema.parse(spec);
  return {
    modelledOn,
    role: parsed.role,
    tokens: paletteTokens({
      accent: parsed.accent,
      accentForeground: parsed.accentForeground,
      hue: parsed.hue,
      primary: parsed.primary,
      primaryForeground: parsed.primaryForeground,
    }),
  };
}

export type ThemeStyleProperties = Record<`--${string}`, string>;

/** CSS custom properties for a theme, ready to spread onto a `style` prop. */
export function themeCssProperties(theme: OrgTheme): ThemeStyleProperties {
  const style: ThemeStyleProperties = {};
  for (const [token, value] of Object.entries(theme.tokens)) {
    style[`--${token}`] = value;
  }
  return style;
}
