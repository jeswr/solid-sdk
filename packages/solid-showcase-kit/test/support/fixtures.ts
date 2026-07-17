// AUTHORED-BY Claude Fable 5
/**
 * Shared test fixture: a fully FICTIONAL branding config exercising every knob the pack
 * parameterises (convener, purpose clause, multi-entry negations, cookie prefix). The
 * golden vectors in disclaimers.test.ts pin the strings THIS config produces, proving the
 * `createDisclaimerPack` parameterisation end to end.
 *
 * NOTE: a real consumer's exact-string proof (its own convener/negations asserted as
 * literal golden vectors) deliberately lives in THAT consumer's repository, alongside its
 * real BrandingConfig — the kit's own suite stays generic.
 */
import { type BrandingConfig, createDisclaimerPack, themeFromSpec } from "../../src/index.js";

export const referenceBranding: BrandingConfig = {
  consentCookiePrefix: "ex-demo-consent-",
  convener: "Example Demo Collective",
  description: "show how a vehicle-hire journey could work on Solid personal data stores",
  domainNegations: [
    "Nothing here is an offer of hire or insurance.",
    "Rates, fees, hire decisions, documents, and personas are fictitious and illustrative.",
    "Nothing on this site is an offer or solicitation of hire, insurance, or of any product or service.",
  ],
};

export const referencePack = createDisclaimerPack(referenceBranding);

/** A branded app's theme spec (palette data is consumer data, not kit data). */
export const walletTheme = themeFromSpec(
  {
    accent: "oklch(0.5 0.19 20)",
    hue: 270,
    primary: "oklch(0.22 0.012 270)",
    role: "consumer data custodian",
  },
  "Globex Telecom",
);

export const tourTheme = themeFromSpec(
  {
    accent: "oklch(0.55 0.1 250)",
    hue: 260,
    primary: "oklch(0.279 0.041 260)",
    role: "convener",
  },
  "Example Demo Collective",
);
