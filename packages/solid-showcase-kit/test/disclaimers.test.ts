// AUTHORED-BY Claude Fable 5
import { expect, test } from "vitest";
import { copyText, createDisclaimerPack } from "../src/index.js";
import { referencePack as pack, referenceBranding } from "./support/fixtures.js";

// GOLDEN TESTS — literal assertions pinning the exact strings the fictional
// `referenceBranding` fixture produces, across every surface the pack parameterises:
// convener substitution, the purpose clause, primary-negation placement (banner), the
// "Nothing … is" → "Not …" compact derivation (compact banner + footer), the
// interstitial's negation expansion, and both disclaimer variants.
//
// A real consumer proves ITS exact copy in its own repository by passing its real
// BrandingConfig and asserting its own golden vectors — do not add real-project branding
// here. Do not weaken these assertions; a copy-mechanism change must be deliberate.

test("banner copy — desktop, modelled with role", () => {
  expect(
    pack.bannerFullText({ organization: "Acme Vehicle Hire", role: "vehicle hire operator" }),
  ).toBe(
    "Concept demo — this is not Acme Vehicle Hire. A research prototype by the Example Demo Collective, modelled on the vehicle hire operator role. All data is simulated. Nothing here is an offer of hire or insurance.",
  );
});

test("banner copy — desktop, modelled without a role clause", () => {
  expect(pack.bannerFullText({ organization: "Globex Telecom" })).toBe(
    "Concept demo — this is not Globex Telecom. A research prototype by the Example Demo Collective. All data is simulated. Nothing here is an offer of hire or insurance.",
  );
});

test("banner copy — mobile-compressed variant derives the compact negation", () => {
  expect(pack.bannerCompactText({ organization: "Globex Telecom" })).toBe(
    "Concept demo — not Globex Telecom. Simulated data. Not an offer of hire or insurance.",
  );
});

test("banner copy — own-branded (convener) variant drops the self-negation", () => {
  expect(pack.bannerFullText({ organization: "Example Demo Collective", variant: "own" })).toBe(
    "Concept demo. A research prototype by the Example Demo Collective. All data is simulated. Nothing here is an offer of hire or insurance.",
  );
  expect(pack.bannerCompactText({ organization: "Example Demo Collective", variant: "own" })).toBe(
    "Concept demo. Simulated data. Not an offer of hire or insurance.",
  );
});

test("footer legal line", () => {
  expect(pack.footerLegalLine({ organization: "Globex Telecom" })).toBe(
    "Concept demonstration · Example Demo Collective · Not affiliated with, sponsored by, or endorsed by Globex Telecom · All data simulated · Not an offer of hire or insurance · Do not enter real personal information",
  );
  expect(pack.footerLegalLine({ organization: "Anyone", variant: "own" })).not.toContain(
    "Not affiliated",
  );
});

test("interstitial copy — four paragraphs: purpose clause, negation, expansion, safety", () => {
  const paragraphs = pack.interstitialParagraphs("Globex Telecom").map(copyText);
  expect(paragraphs).toEqual([
    "This site is a research prototype built by the Example Demo Collective to show how a vehicle-hire journey could work on Solid personal data stores.",
    "It is modelled on the role Globex Telecom plays in that journey. It was not built by Globex Telecom and is not affiliated with, sponsored by, or endorsed by Globex Telecom. The Globex Telecom name is used only to identify that market role.",
    "Everything here is simulated. Rates, fees, hire decisions, documents, and personas are fictitious and illustrative. Nothing on this site is an offer or solicitation of hire, insurance, or of any product or service.",
    "Do not enter real personal or financial information. Use the demo personas provided.",
  ]);
});

test("illustrative-figure tag and demo-field hint defaults", () => {
  expect(pack.illustrativeTag).toBe("illustrative figure, not an offer");
  expect(pack.demoFieldHint).toBe("Demo field — do not enter real information.");
});

test("demoMetadata — title suffix, OG description, noindex", () => {
  expect(pack.demoTitle({ appName: "Data Vault", organization: "Globex Telecom" })).toBe(
    "Data Vault — Concept Demo (not Globex Telecom)",
  );
  expect(pack.demoDescription({ appName: "Data Vault", organization: "Globex Telecom" })).toBe(
    "Concept demonstration by the Example Demo Collective — not affiliated with Globex Telecom. All data simulated.",
  );
  const metadata = pack.demoMetadata({ appName: "Data Vault", organization: "Globex Telecom" });
  expect(metadata.openGraph).toEqual({
    description: metadata.description,
    title: metadata.title,
  });
  expect(metadata.robots).toEqual({ follow: false, index: false });
});

test("demoMetadata — own-branded variant", () => {
  const metadata = pack.demoMetadata({
    appName: "Journey Tour",
    organization: "Example Demo Collective",
    variant: "own",
  });
  expect(metadata.title).toBe("Journey Tour — Concept Demo");
  expect(metadata.description).toBe(
    "Concept demonstration by the Example Demo Collective. All data simulated.",
  );
  expect(metadata.robots).toEqual({ follow: false, index: false });
});

test("interstitial own variant: shared core copy + collective negation", () => {
  const own = pack.interstitialParagraphs("Example Demo Collective", "own").map(copyText);
  const modelled = pack.interstitialParagraphs("Globex Telecom").map(copyText);
  expect(own).toHaveLength(4);
  // First, third, and fourth paragraphs are shared verbatim with the modelled variant.
  expect(own[0]).toBe(modelled[0]);
  expect(own[2]).toBe(modelled[2]);
  expect(own[3]).toBe(modelled[3]);
  // The negation paragraph negates the organisations named inside the demo, not the convener.
  expect(own[1]).toBe(
    "The organisations named inside the demo illustrate market roles only. None of them built this demo, and none is affiliated with, sponsors, or endorses it.",
  );
  expect(own[1]).not.toContain("Example Demo Collective");
});

test("a single-negation branding degrades gracefully across all surfaces", () => {
  const bikes = createDisclaimerPack({
    convener: "Example Research Lab",
    description: "show how a bicycle-share journey could work on Solid personal data stores",
    domainNegations: ["Nothing here is an offer of transport services."],
  });
  expect(bikes.bannerFullText({ organization: "Acme Bikes" })).toBe(
    "Concept demo — this is not Acme Bikes. A research prototype by the Example Research Lab. All data is simulated. Nothing here is an offer of transport services.",
  );
  expect(bikes.bannerCompactText({ organization: "Acme Bikes" })).toBe(
    "Concept demo — not Acme Bikes. Simulated data. Not an offer of transport services.",
  );
  expect(bikes.footerLegalLine({ organization: "Acme Bikes" })).toContain(
    " · Not an offer of transport services · ",
  );
  // With one entry, the same negation serves the interstitial's simulation paragraph.
  expect(copyText(bikes.interstitialParagraphs("Acme Bikes")[2] ?? [])).toBe(
    "Everything here is simulated. Nothing here is an offer of transport services.",
  );
});

test("createDisclaimerPack validates the branding config with the zod schema", () => {
  expect(() =>
    createDisclaimerPack({ ...referenceBranding, consentCookiePrefix: "NoTrailingDash" }),
  ).toThrow();
  expect(() => createDisclaimerPack({ ...referenceBranding, convener: "" })).toThrow();
});

test("pack surface defaults: aboutHref and consent cookie prefix", () => {
  expect(pack.aboutHref).toBe("/");
  expect(pack.consentCookiePrefix).toBe("ex-demo-consent-");
  const bare = createDisclaimerPack({
    convener: "Anyone",
    description: "show a thing",
    domainNegations: [],
  });
  expect(bare.consentCookiePrefix).toBe("demo-consent-");
});

test("FIX D: whitespace-only convener or description is rejected (no malformed copy)", () => {
  expect(() => createDisclaimerPack({ ...referenceBranding, convener: "   " })).toThrow();
  expect(() => createDisclaimerPack({ ...referenceBranding, description: " \n " })).toThrow();
  // Surrounding whitespace is trimmed before templating.
  const padded = createDisclaimerPack({
    ...referenceBranding,
    convener: "  Example Demo Collective  ",
  });
  expect(padded.convener).toBe("Example Demo Collective");
  expect(padded.bannerFullText({ organization: "Acme Bikes" })).toContain(
    "by the Example Demo Collective.",
  );
});
