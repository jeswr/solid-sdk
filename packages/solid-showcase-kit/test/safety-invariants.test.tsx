// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom

// The kit's non-negotiables: NO prop or configuration path may drop the safety copy,
// hide the banner, remove the demo-field hint, or break the interstitial's
// four-paragraph structure. These tests exercise the hostile-config paths.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import {
  AppShell,
  ConceptDemoBanner,
  copyText,
  createDisclaimerPack,
  DEMO_FIELD_HINT,
  DemoLockedField,
  IllustrativeFigure,
  ShowcaseTrustProvider,
} from "../src/index.js";
import { walletTheme } from "./support/fixtures.js";

afterEach(cleanup);

/** A branding config trying to configure AWAY as much as the schema allows. */
const hostilePack = createDisclaimerPack({
  convener: "Anyone",
  description: "show a thing",
  domainNegations: [],
  illustrativeTag: "   ",
});

test("fixed safety copy renders even with zero domain negations", () => {
  expect(hostilePack.bannerFullText({ organization: "Acme" })).toBe(
    "Concept demo — this is not Acme. A research prototype by the Anyone. All data is simulated.",
  );
  expect(hostilePack.bannerCompactText({ organization: "Acme" })).toBe(
    "Concept demo — not Acme. Simulated data.",
  );
  expect(hostilePack.footerLegalLine({ organization: "Acme" })).toBe(
    "Concept demonstration · Anyone · Not affiliated with, sponsored by, or endorsed by Acme · All data simulated · Do not enter real personal information",
  );
});

test("interstitial keeps its four-paragraph structure for every variant and config", () => {
  for (const variant of ["modelled", "own"] as const) {
    const paragraphs = hostilePack.interstitialParagraphs("Acme", variant);
    expect(paragraphs).toHaveLength(4);
    expect(copyText(paragraphs[2] ?? [])).toBe("Everything here is simulated.");
    expect(copyText(paragraphs[3] ?? [])).toBe(
      "Do not enter real personal or financial information. Use the demo personas provided.",
    );
  }
});

test("a blank illustrativeTag override falls back to the default qualifier", () => {
  expect(hostilePack.illustrativeTag).toBe("illustrative figure, not an offer");
});

test("the pack is frozen — safety copy cannot be patched out after creation", () => {
  expect(Object.isFrozen(hostilePack)).toBe(true);
});

test("AppShell always renders the adjacent banner and the footer legal line", () => {
  // AppShellProps has no prop that hides either surface; this pins the minimal render.
  const { container } = render(
    <ShowcaseTrustProvider pack={hostilePack} theme={walletTheme}>
      <AppShell appName="Anything">
        <main>content</main>
      </AppShell>
    </ShowcaseTrustProvider>,
  );
  expect(container.querySelector("[data-concept-demo-banner]")?.textContent).toContain(
    "Concept demo — this is not Globex Telecom.",
  );
  expect(container.querySelector("[data-demo-footer]")?.textContent).toContain(
    "Do not enter real personal information",
  );
});

test("trust components fail closed without a pack: they throw rather than render bare", () => {
  expect(() => render(<ConceptDemoBanner organization="Acme" />)).toThrow(/ShowcaseTrustProvider/);
});

test("IllustrativeFigure renders its qualifier even with no provider at all", () => {
  const { container } = render(<IllustrativeFigure>6.875%</IllustrativeFigure>);
  expect(container.querySelector("[data-illustrative-figure]")?.textContent).toBe(
    "6.875% — illustrative figure, not an offer",
  );
});

test("DemoLockedField's hint prop is supplemental — the warning cannot be replaced", () => {
  render(<DemoLockedField hint="Use persona Jordan Demo." label="City" value="Springfield" />);
  const input = screen.getByLabelText<HTMLInputElement>("City");
  const hintId = input.getAttribute("aria-describedby");
  expect(document.getElementById(hintId as string)?.textContent).toBe(
    `${DEMO_FIELD_HINT} Use persona Jordan Demo.`,
  );
});

test("FIX A: interstitial paragraphs are fresh deep-frozen copies — safety copy cannot be mutated away", () => {
  const first = hostilePack.interstitialParagraphs("Acme");
  const segment = first[3]?.[0];
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first[3])).toBe(true);
  expect(Object.isFrozen(segment)).toBe(true);
  expect(() => {
    (segment as { text: string }).text = "tampered";
  }).toThrow(TypeError);
  // A later call returns intact copy via distinct objects.
  const second = hostilePack.interstitialParagraphs("Acme");
  expect(copyText(second[3] ?? [])).toBe(
    "Do not enter real personal or financial information. Use the demo personas provided.",
  );
  expect(second[3]?.[0]).not.toBe(segment);
});
