// AUTHORED-BY Claude Fable 5
/**
 * Disclaimer copy pack — the single source of truth for the exact trust wording every
 * showcase surface renders (banner, footer legal line, consent interstitial, metadata,
 * figure tags, demo-field hints).
 *
 * `createDisclaimerPack(branding)` closes over a {@link BrandingConfig} and returns the
 * frozen copy factories. Components in this package render these strings; unit tests and
 * shared e2e suites consume the SAME pack so asserted copy can never drift from rendered
 * copy.
 *
 * Opinionated invariants preserved in code, not config:
 * - the fixed safety copy ("All data is simulated", "Do not enter real personal
 *   information", …) always renders — `domainNegations` only EXTENDS it;
 * - the interstitial keeps its four-paragraph structure with only convener / negation /
 *   description substitutions;
 * - metadata is always noindex/nofollow.
 *
 * `variant`:
 * - "modelled" (default) — branded surfaces modelled on a real organisation; copy negates
 *   source ("this is not {Org}") and offer (the domain negations).
 * - "own" — surfaces published under the convener's own branding (e.g. a tour shell),
 *   where source-negation against the convener would be self-contradictory.
 */
import { type BrandingConfig, brandingConfigSchema } from "./branding.js";

export type DisclaimerVariant = "modelled" | "own";

/** A run of copy; `strong` marks the phrases rendered bold. */
export interface CopySegment {
  text: string;
  strong?: boolean | undefined;
}

/** Flatten copy segments to the plain text an e2e assertion sees. */
export function copyText(segments: CopySegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

export interface BannerCopyOptions {
  organization: string;
  /** Journey role, e.g. "consumer data custodian"; rendered as "modelled on the {role} role". */
  role?: string | undefined;
  variant?: DisclaimerVariant | undefined;
}

export interface BannerCopy {
  /** Leading phrase, rendered bold (the four-Ps "headline corrector"). */
  lead: string;
  /** Remainder of the sentence(s), rendered at the same prominence tier. */
  rest: string;
  /** Visible text of the "About this demo" link. */
  aboutLabel: string;
}

export interface FooterCopyOptions {
  organization: string;
  variant?: DisclaimerVariant | undefined;
}

export interface DemoMetadataOptions {
  appName: string;
  organization: string;
  variant?: DisclaimerVariant | undefined;
}

/** Structurally compatible with Next.js `Metadata` without depending on `next`. */
export interface DemoMetadata {
  title: string;
  description: string;
  openGraph: { title: string; description: string };
  robots: { index: false; follow: false };
}

/** Interstitial heading — fixed copy, not configurable. */
export const INTERSTITIAL_HEADING = "You're entering a concept demonstration";
/** Interstitial affirmative-continue label — fixed copy, not configurable. */
export const INTERSTITIAL_CONTINUE_LABEL = "I understand — enter the demo";
/** Interstitial learn-more label — fixed copy, not configurable. */
export const INTERSTITIAL_LEARN_MORE_LABEL = "Learn more about the project";

/** Default inline tag rendered adjacent to every rate/fee/payment/decision figure. */
export const ILLUSTRATIVE_FIGURE_TAG = "illustrative figure, not an offer";

/** Mandatory hint for demo form fields — fixed by design, only extendable. */
export const DEMO_FIELD_HINT = "Demo field — do not enter real information.";

/** Default consent-cookie prefix when the branding config does not set one. */
export const DEFAULT_CONSENT_COOKIE_PREFIX = "demo-consent-";

/** Simulation paragraph lead — fixed safety copy shared verbatim by both variants. */
const simulatedLead = (): CopySegment => ({
  strong: true,
  text: "Everything here is simulated.",
});

/** Do-not-enter paragraph — fixed safety copy shared verbatim by both variants. */
const doNotEnterParagraph = (): CopySegment[] => [
  { strong: true, text: "Do not enter real personal or financial information." },
  { text: " Use the demo personas provided." },
];

/**
 * Deep-freeze a paragraph set. `interstitialParagraphs` returns FRESH, deep-frozen
 * copies on every call so no caller can mutate a result and drop mandatory safety copy —
 * neither for itself nor for any later caller.
 */
function freezeParagraphs(paragraphs: CopySegment[][]): CopySegment[][] {
  for (const paragraph of paragraphs) {
    for (const segment of paragraph) Object.freeze(segment);
    Object.freeze(paragraph);
  }
  return Object.freeze(paragraphs) as CopySegment[][];
}

/**
 * Compact form of a full-sentence negation for the mobile banner and the footer legal
 * line: a leading "Nothing here/on this site/in this demo is …" becomes "Not …"
 * ("Nothing here is an offer of hire." → "Not an offer of hire."). Sentences that do
 * not match are used verbatim.
 */
function compactNegation(sentence: string): string {
  const match = /^nothing (?:here|on this site|in this demo) is\s+(.+)$/i.exec(sentence);
  const rest = match?.[1];
  return rest === undefined ? sentence : `Not ${rest}`;
}

/**
 * The frozen copy-factory pack every trust component renders from. All copy that is not
 * derived from the branding config is fixed here and cannot be removed or replaced by
 * any prop or configuration path.
 */
export interface DisclaimerPack {
  /** The validated branding config the pack was created from. */
  readonly branding: BrandingConfig;
  readonly convener: string;
  /** Destination of the "About this demo" link (default "/"). */
  readonly aboutHref: string;
  /** Consent-cookie name prefix, always ending in "-". */
  readonly consentCookiePrefix: string;
  /** Inline qualifier for rendered figures; never blank. */
  readonly illustrativeTag: string;
  /** The mandatory demo-field hint — always {@link DEMO_FIELD_HINT}. */
  readonly demoFieldHint: string;
  /** Banner copy, desktop variant. */
  bannerFullCopy(options: BannerCopyOptions): BannerCopy;
  /** Banner copy, mobile-compressed variant (same element, small screens). */
  bannerCompactCopy(options: BannerCopyOptions): BannerCopy;
  /** Full desktop banner text as a single string (for assertions). */
  bannerFullText(options: BannerCopyOptions): string;
  /** Compact banner text as a single string (for assertions). */
  bannerCompactText(options: BannerCopyOptions): string;
  /** Footer legal line, every page. */
  footerLegalLine(options: FooterCopyOptions): string;
  /**
   * The four interstitial paragraphs, with the bold phrases marked. The four-paragraph
   * structure is fixed; only the convener, description, and negations vary.
   *
   * `variant: "own"` (convener-branded surfaces) keeps the structure but replaces the
   * org-negation paragraph — negating the convener against itself would be
   * self-contradictory — with a collective negation of every organisation named inside
   * the demo. The simulation and do-not-enter paragraphs are shared verbatim with the
   * modelled variant so the core copy cannot drift between variants.
   */
  interstitialParagraphs(organization: string, variant?: DisclaimerVariant): CopySegment[][];
  /** `<title>` — suffixed "— Concept Demo (not {Org})" on every branded surface. */
  demoTitle(options: DemoMetadataOptions): string;
  /** Meta/OG description — leads with the non-affiliation line. */
  demoDescription(options: DemoMetadataOptions): string;
  /**
   * Metadata helper for app layouts: title suffix + OG description + noindex.
   *
   * Usage: `export const metadata: Metadata = pack.demoMetadata({ appName, organization });`
   */
  demoMetadata(options: DemoMetadataOptions): DemoMetadata;
}

/**
 * Build the disclaimer pack for a branding config. The config is validated with
 * {@link brandingConfigSchema} (throws on violation) and the returned pack is frozen.
 */
export function createDisclaimerPack(branding: BrandingConfig): DisclaimerPack {
  const parsed = brandingConfigSchema.parse(branding);
  const convener = parsed.convener;
  const negations = parsed.domainNegations
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const primaryNegation = negations[0];
  const primaryCompact =
    primaryNegation === undefined ? undefined : compactNegation(primaryNegation);
  /** Entries after the first replace the primary in the interstitial (see branding.ts). */
  const interstitialNegations = negations.length > 1 ? negations.slice(1) : negations;
  const purpose = parsed.description.trim().replace(/\.\s*$/, "");
  const illustrativeTag =
    parsed.illustrativeTag !== undefined && parsed.illustrativeTag.trim().length > 0
      ? parsed.illustrativeTag
      : ILLUSTRATIVE_FIGURE_TAG;

  /** " A research prototype by the {convener}{roleClause}. All data is simulated.[ {negation}]" */
  const fullRest = (roleClause: string): string =>
    ` A research prototype by the ${convener}${roleClause}. All data is simulated.${
      primaryNegation === undefined ? "" : ` ${primaryNegation}`
    }`;

  const bannerFullCopy = (options: BannerCopyOptions): BannerCopy => {
    if (options.variant === "own") {
      return { aboutLabel: "About this demo", lead: "Concept demo.", rest: fullRest("") };
    }
    const roleClause = options.role === undefined ? "" : `, modelled on the ${options.role} role`;
    return {
      aboutLabel: "About this demo",
      lead: `Concept demo — this is not ${options.organization}.`,
      rest: fullRest(roleClause),
    };
  };

  const bannerCompactCopy = (options: BannerCopyOptions): BannerCopy => {
    const rest = ` Simulated data.${primaryCompact === undefined ? "" : ` ${primaryCompact}`}`;
    if (options.variant === "own") {
      return { aboutLabel: "About", lead: "Concept demo.", rest };
    }
    return { aboutLabel: "About", lead: `Concept demo — not ${options.organization}.`, rest };
  };

  const interstitialParagraphs = (
    organization: string,
    variant: DisclaimerVariant = "modelled",
  ): CopySegment[][] => {
    const builtBy: CopySegment[] = [
      { text: "This site is a research prototype built by the " },
      { strong: true, text: convener },
      { text: ` to ${purpose}.` },
    ];
    const simulated: CopySegment[] =
      interstitialNegations.length === 0
        ? [simulatedLead()]
        : [simulatedLead(), { text: ` ${interstitialNegations.join(" ")}` }];
    if (variant === "own") {
      return freezeParagraphs([
        builtBy,
        [
          { text: "The organisations named inside the demo " },
          { strong: true, text: "illustrate market roles only" },
          { text: ". " },
          { strong: true, text: "None of them built this demo" },
          { text: ", and " },
          { strong: true, text: "none is affiliated with, sponsors, or endorses it" },
          { text: "." },
        ],
        simulated,
        doNotEnterParagraph(),
      ]);
    }
    return freezeParagraphs([
      builtBy,
      [
        { text: "It is modelled on the role " },
        { strong: true, text: organization },
        { text: " plays in that journey. It was " },
        { strong: true, text: `not built by ${organization}` },
        { text: " and is " },
        {
          strong: true,
          text: `not affiliated with, sponsored by, or endorsed by ${organization}`,
        },
        { text: `. The ${organization} name is used only to identify that market role.` },
      ],
      simulated,
      doNotEnterParagraph(),
    ]);
  };

  const demoTitle = (options: DemoMetadataOptions): string => {
    if (options.variant === "own") return `${options.appName} — Concept Demo`;
    return `${options.appName} — Concept Demo (not ${options.organization})`;
  };

  const demoDescription = (options: DemoMetadataOptions): string => {
    if (options.variant === "own") {
      return `Concept demonstration by the ${convener}. All data simulated.`;
    }
    return `Concept demonstration by the ${convener} — not affiliated with ${options.organization}. All data simulated.`;
  };

  const pack: DisclaimerPack = {
    aboutHref: parsed.aboutHref ?? "/",
    bannerCompactCopy,
    bannerCompactText: (options) => {
      const copy = bannerCompactCopy(options);
      return `${copy.lead}${copy.rest}`;
    },
    bannerFullCopy,
    bannerFullText: (options) => {
      const copy = bannerFullCopy(options);
      return `${copy.lead}${copy.rest}`;
    },
    branding: parsed,
    consentCookiePrefix: parsed.consentCookiePrefix ?? DEFAULT_CONSENT_COOKIE_PREFIX,
    convener,
    demoDescription,
    demoFieldHint: DEMO_FIELD_HINT,
    demoMetadata: (options) => {
      const title = demoTitle(options);
      const description = demoDescription(options);
      return {
        description,
        openGraph: { description, title },
        robots: { follow: false, index: false },
        title,
      };
    },
    demoTitle,
    footerLegalLine: (options) => {
      const segments = ["Concept demonstration", convener];
      if (options.variant !== "own") {
        segments.push(`Not affiliated with, sponsored by, or endorsed by ${options.organization}`);
      }
      segments.push("All data simulated");
      if (primaryCompact !== undefined) segments.push(primaryCompact.replace(/\.$/, ""));
      segments.push("Do not enter real personal information");
      return segments.join(" · ");
    },
    illustrativeTag,
    interstitialParagraphs,
  };
  return Object.freeze(pack);
}
