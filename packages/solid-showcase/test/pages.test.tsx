// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom
/** The generic example document renders end-to-end through all four page renderers. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ShowcaseChapterPage,
  ShowcaseCompliancePage,
  ShowcaseLanding,
  ShowcaseLayout,
} from "../src/index.js";
import { exampleWalkthrough } from "./support/example-document.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("unreachable"))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("ShowcaseLayout renders the shell frame, banner, launcher, and interstitial", () => {
  const { container, baseElement } = render(
    <ShowcaseLayout document={exampleWalkthrough}>
      <p>page body</p>
    </ShowcaseLayout>,
  );
  expect(container.querySelector("[data-app-shell]")).not.toBeNull();
  // The concept-demo banner and footer legal line are unremovable kit surfaces.
  expect(container.textContent).toContain("Concept demo");
  expect(container.querySelector("[data-demo-footer]")).not.toBeNull();
  expect(screen.getByText("page body")).toBeTruthy();
  expect(container.querySelector("[data-launcher]")).not.toBeNull();
  // First visit (no consent cookie): the interstitial is open.
  expect(baseElement.querySelector("[data-consent-interstitial]")).not.toBeNull();
  // The compliance lens is linked from the header nav under its document title.
  expect(screen.getAllByRole("link", { name: "Steward Review" }).length).toBeGreaterThan(0);
});

test("ShowcaseLanding renders hero, anchors with sources, map, chapter cards, persona", () => {
  const { container } = render(<ShowcaseLanding document={exampleWalkthrough} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "One journey, many parties, one vault",
  );
  expect(container.textContent).toContain("Meridian Trails Collective");
  // Anchors + their public sources.
  expect(container.querySelectorAll("[data-stat-card]")).toHaveLength(2);
  expect(container.querySelector("[data-anchor-sources] a")?.getAttribute("href")).toBe(
    "https://example.org/research/journeys",
  );
  // Ecosystem map and chapter cards.
  expect(container.querySelector("[data-ecosystem-map]")).not.toBeNull();
  expect(container.querySelectorAll("[data-chapter-card]")).toHaveLength(4); // 3 chapters + lens card
  expect(
    container.querySelector("[data-chapter-card='pack-the-vault']")?.getAttribute("href"),
  ).toBe("/chapters/pack-the-vault");
  expect(container.querySelector("[data-cta-start-tour]")?.textContent).toBe(
    "Start the walkthrough",
  );
  // Persona card.
  expect(container.querySelector("[data-demo-identity-card]")).not.toBeNull();
});

test("ShowcaseChapterPage renders the chapter player and neighbour navigation", () => {
  const { container } = render(
    <ShowcaseChapterPage document={exampleWalkthrough} slug="prove-the-permit" />,
  );
  expect(container.querySelector("[data-chapter-player='prove-the-permit']")).not.toBeNull();
  expect(container.textContent).toContain("Scene 2 of 3");
  expect(container.textContent).toContain("Anchor:");
  expect(container.querySelector("[data-previous-chapter]")?.getAttribute("href")).toBe(
    "/chapters/pack-the-vault",
  );
  expect(container.querySelector("[data-next-chapter]")?.getAttribute("href")).toBe(
    "/chapters/share-the-route",
  );
});

test("the last chapter hands off to the compliance lens when configured", () => {
  const { container } = render(
    <ShowcaseChapterPage document={exampleWalkthrough} slug="share-the-route" />,
  );
  expect(container.querySelector("[data-next-chapter]")?.getAttribute("href")).toBe("/compliance");
});

test("ShowcaseChapterPage throws on an unknown slug (routes must guard with chapterBySlug)", () => {
  expect(() =>
    render(<ShowcaseChapterPage document={exampleWalkthrough} slug="nope" />),
  ).toThrowError(/Unknown chapter slug "nope"/);
});

test("ShowcaseCompliancePage renders the unbranded checklist with non-affiliation", () => {
  const { container } = render(<ShowcaseCompliancePage document={exampleWalkthrough} />);
  expect(container.querySelector("[data-compliance-view]")).not.toBeNull();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Steward Review");
  const statement =
    "An illustrative checklist over public trail rules; not affiliated with or endorsed by any park or range authority.";
  expect(container.textContent).toContain(statement);
  expect(container.querySelectorAll("[data-compliance-check]")).toHaveLength(2);
  const check = container.querySelector("[data-compliance-check='day-permit']");
  expect(check?.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.org/rules/day-permits",
  );
  expect(check?.textContent).toContain("Dramatized in scene 1");
});

test("ShowcaseCompliancePage refuses to render without a configured lens", () => {
  const doc = structuredClone(exampleWalkthrough);
  doc.compliance = undefined;
  expect(() => render(<ShowcaseCompliancePage document={doc} />)).toThrowError(
    /configures no compliance lens/,
  );
});
