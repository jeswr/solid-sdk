// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { ConceptDemoBanner, ShowcaseTrustProvider } from "../src/index.js";
import { referencePack as pack } from "./support/fixtures.js";

afterEach(cleanup);

function renderWithPack(ui: ReactNode) {
  return render(<ShowcaseTrustProvider pack={pack}>{ui}</ShowcaseTrustProvider>);
}

test("renders both banner variants with the pack copy and the about link", () => {
  renderWithPack(
    <ConceptDemoBanner orgRole="vehicle hire operator" organization="Acme Vehicle Hire" />,
  );
  const banner = screen.getByRole("note", { name: "Concept demonstration notice" });
  expect(banner.textContent).toContain(
    pack.bannerFullText({ organization: "Acme Vehicle Hire", role: "vehicle hire operator" }),
  );
  expect(banner.textContent).toContain(
    pack.bannerCompactText({ organization: "Acme Vehicle Hire", role: "vehicle hire operator" }),
  );
  // At desktop width only the full variant is in the accessibility tree; the compact
  // variant exists in the DOM but is display:none via the embedded media query.
  const aboutLinks = screen.getAllByRole("link");
  expect(aboutLinks.map((link) => link.textContent)).toEqual(["About this demo"]);
  const compactLink = banner.querySelector("[data-cdb-compact] a");
  expect(compactLink?.textContent).toBe("About");
  expect(aboutLinks[0]?.getAttribute("href")).toBe("/");
  expect(compactLink?.getAttribute("href")).toBe("/");
});

test("stub-compatible: organization-only props render source and offer negation", () => {
  renderWithPack(<ConceptDemoBanner organization="Initech Logistics" />);
  const banner = screen.getByRole("note", { name: "Concept demonstration notice" });
  expect(banner.textContent).toContain("Concept demo — this is not Initech Logistics.");
  expect(banner.textContent).toContain("Nothing here is an offer of hire or insurance.");
  expect(banner.textContent).not.toContain("modelled on the");
});

test("own-branded variant drops the self-negation but keeps the offer negation", () => {
  renderWithPack(<ConceptDemoBanner organization="Example Demo Collective" variant="own" />);
  const banner = screen.getByRole("note", { name: "Concept demonstration notice" });
  expect(banner.textContent).not.toContain("this is not");
  expect(banner.textContent).toContain("Nothing here is an offer of hire or insurance.");
});

test("placement: fixed-bottom by default, in-flow when static (AppShell)", () => {
  const { unmount } = renderWithPack(<ConceptDemoBanner organization="Globex Telecom" />);
  expect(screen.getByRole("note", { name: "Concept demonstration notice" }).style.position).toBe(
    "fixed",
  );
  unmount();
  renderWithPack(<ConceptDemoBanner organization="Globex Telecom" placement="static" />);
  expect(screen.getByRole("note", { name: "Concept demonstration notice" }).style.position).toBe(
    "",
  );
});

test("an explicit pack prop works without a provider (error-page usage)", () => {
  const { container } = render(<ConceptDemoBanner organization="Globex Telecom" pack={pack} />);
  expect(container.querySelector("[data-concept-demo-banner]")).not.toBeNull();
  // The component API is copy-only: no prop combination may suppress rendering.
  expect(container.textContent).toContain("Concept demo");
});
