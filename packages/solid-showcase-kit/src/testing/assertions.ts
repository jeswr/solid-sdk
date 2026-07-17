// AUTHORED-BY Claude Fable 5
/**
 * Framework-agnostic e2e assertion helpers for the trust surfaces: stable selectors +
 * the exact expected copy, derived from the SAME disclaimer pack the components render
 * from, so asserted copy can never drift from rendered copy.
 *
 * Deliberately not coupled to any e2e runner — a Playwright suite uses them as:
 *
 * ```ts
 * const banner = page.locator(disclaimerAssertions.bannerSelector).first();
 * await expect(banner).toContainText(
 *   disclaimerAssertions.expectedBannerText(pack, { organization, role }),
 * );
 * ```
 */
import {
  copyText,
  type DisclaimerPack,
  type DisclaimerVariant,
  INTERSTITIAL_CONTINUE_LABEL,
  INTERSTITIAL_HEADING,
} from "../disclaimers.js";

/** One branded surface's banner identity (org/role/variant). */
export interface BannerIdentity {
  organization: string;
  role?: string | undefined;
  variant?: DisclaimerVariant | undefined;
}

export const disclaimerAssertions = {
  /** ARIA name of the banner `role="note"` element. */
  bannerAriaLabel: "Concept demonstration notice",
  /** The unremovable concept-demo banner (pages may carry extra per-section banners; the shell banner renders first). */
  bannerSelector: "[data-concept-demo-banner]",
  /** Visible label of the banner's about link (desktop variant). */
  bannerAboutLabel: "About this demo",
  /** The `AppShell` frame. */
  appShellSelector: "[data-app-shell]",
  /** The footer carrying the legal line. */
  footerSelector: "[data-demo-footer]",
  /** The consent interstitial overlay. */
  interstitialSelector: "[data-consent-interstitial]",
  /** ARIA name of the interstitial dialog. */
  interstitialHeading: INTERSTITIAL_HEADING,
  /** Label of the affirmative-continue button. */
  interstitialContinueLabel: INTERSTITIAL_CONTINUE_LABEL,
  /** Full required desktop banner copy for a surface. */
  expectedBannerText(pack: DisclaimerPack, identity: BannerIdentity): string {
    return pack.bannerFullText({
      organization: identity.organization,
      role: identity.role,
      variant: identity.variant,
    });
  },
  /** Full required footer legal line for a surface. */
  expectedFooterText(pack: DisclaimerPack, identity: BannerIdentity): string {
    return pack.footerLegalLine({
      organization: identity.organization,
      variant: identity.variant,
    });
  },
  /** The verbatim negation paragraph the interstitial must contain. */
  expectedNegationParagraph(
    pack: DisclaimerPack,
    organization: string,
    variant: DisclaimerVariant = "modelled",
  ): string {
    const paragraph = pack.interstitialParagraphs(organization, variant)[1];
    return paragraph === undefined ? "" : copyText(paragraph);
  },
} as const;
