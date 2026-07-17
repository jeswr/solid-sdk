// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  ConsentInterstitial,
  copyText,
  INTERSTITIAL_CONTINUE_LABEL,
  INTERSTITIAL_HEADING,
  ShowcaseTrustProvider,
} from "../src/index.js";
import { referencePack as pack } from "./support/fixtures.js";

const APP_ID = "test-app";

function clearConsentCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API; test-only cleanup.
  document.cookie = `${pack.consentCookiePrefix}${APP_ID}=; max-age=0; path=/`;
}

beforeEach(clearConsentCookie);
afterEach(() => {
  cleanup();
  clearConsentCookie();
});

function renderWithPack(ui: ReactNode) {
  return render(<ShowcaseTrustProvider pack={pack}>{ui}</ShowcaseTrustProvider>);
}

test("first visit: renders the pack copy, blocks scroll, and takes focus", async () => {
  renderWithPack(<ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />);
  const dialog = screen.getByRole("dialog", { name: INTERSTITIAL_HEADING });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  for (const paragraph of pack.interstitialParagraphs("Globex Telecom")) {
    expect(dialog.textContent).toContain(copyText(paragraph));
  }
  expect(screen.getByRole("link", { name: "Learn more about the project" })).toBeDefined();
  expect(document.body.style.overflow).toBe("hidden");
  await waitFor(() => expect(document.activeElement).toBe(dialog));
});

test("affirmative continue persists the branding-prefixed cookie and dismisses", () => {
  renderWithPack(<ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />);
  fireEvent.click(screen.getByRole("button", { name: INTERSTITIAL_CONTINUE_LABEL }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.cookie).toContain(`ex-demo-consent-${APP_ID}=1`);
  expect(document.body.style.overflow).toBe("");
});

test("returning visit: consent cookie suppresses the interstitial", async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API; test-only setup.
  document.cookie = `${pack.consentCookiePrefix}${APP_ID}=1; path=/`;
  renderWithPack(<ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("Escape does not dismiss it — continuing must be affirmative", () => {
  renderWithPack(<ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeNull();
});

test("Tab is trapped inside the dialog", () => {
  renderWithPack(<ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />);
  const dialog = screen.getByRole("dialog");
  const continueButton = screen.getByRole("button", { name: INTERSTITIAL_CONTINUE_LABEL });
  const learnMoreLink = screen.getByRole("link", { name: "Learn more about the project" });
  learnMoreLink.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(continueButton);
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(learnMoreLink);
});

test("own variant: collective role negation, no self-negation of the convener", () => {
  renderWithPack(
    <ConsentInterstitial appId={APP_ID} organization="Example Demo Collective" variant="own" />,
  );
  const dialog = screen.getByRole("dialog", { name: INTERSTITIAL_HEADING });
  for (const paragraph of pack.interstitialParagraphs("Example Demo Collective", "own")) {
    expect(dialog.textContent).toContain(copyText(paragraph));
  }
  expect(dialog.textContent).not.toContain("not built by Example Demo Collective");
});

test("FIX E: reuse with a NEW appId re-opens — per-app acknowledgement is enforced", async () => {
  const { rerender } = renderWithPack(
    <ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />,
  );
  fireEvent.click(screen.getByRole("button", { name: INTERSTITIAL_CONTINUE_LABEL }));
  expect(screen.queryByRole("dialog")).toBeNull();
  // Same component instance, different app with NO stored consent → must show again.
  rerender(
    <ShowcaseTrustProvider pack={pack}>
      <ConsentInterstitial appId="other-app" organization="Globex Telecom" />
    </ShowcaseTrustProvider>,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
  // And switching back to the consented app closes it again.
  rerender(
    <ShowcaseTrustProvider pack={pack}>
      <ConsentInterstitial appId={APP_ID} organization="Globex Telecom" />
    </ShowcaseTrustProvider>,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API; test-only cleanup.
  document.cookie = `${pack.consentCookiePrefix}other-app=; max-age=0; path=/`;
});
