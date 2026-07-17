// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import {
  AppShell,
  CredentialCard,
  createDisclaimerPack,
  DEMO_FIELD_HINT,
  DemoLockedField,
  HonestyPanel,
  IllustrativeFigure,
  ReceiptCard,
  ShowcaseTrustProvider,
  StatCard,
} from "../src/index.js";
import { referencePack as pack, tourTheme, walletTheme } from "./support/fixtures.js";

afterEach(cleanup);

test("IllustrativeFigure keeps the tag in the same element as the figure", () => {
  const { container } = render(<IllustrativeFigure>6.875%</IllustrativeFigure>);
  const figure = container.querySelector("[data-illustrative-figure]");
  expect(figure?.textContent).toBe("6.875% — illustrative figure, not an offer");
});

test("IllustrativeFigure renders a branding-config tag override from the provider", () => {
  const quotePack = createDisclaimerPack({
    ...pack.branding,
    illustrativeTag: "illustrative figure, not a quote",
  });
  const { container } = render(
    <ShowcaseTrustProvider pack={quotePack}>
      <IllustrativeFigure>£120</IllustrativeFigure>
    </ShowcaseTrustProvider>,
  );
  expect(container.querySelector("[data-illustrative-figure]")?.textContent).toBe(
    "£120 — illustrative figure, not a quote",
  );
});

test("DemoLockedField is read-only and hint-described by default", () => {
  render(<DemoLockedField label="Full name" value="Jordan Demo" />);
  const input = screen.getByLabelText<HTMLInputElement>("Full name");
  expect(input.readOnly).toBe(true);
  expect(input.value).toBe("Jordan Demo");
  const hintId = input.getAttribute("aria-describedby");
  expect(hintId).not.toBeNull();
  expect(document.getElementById(hintId as string)?.textContent).toBe(DEMO_FIELD_HINT);
});

test("DemoLockedField editable variant stays prefilled and keeps the hint", () => {
  render(<DemoLockedField editable label="Preferred contact" value="demo@example.org" />);
  const input = screen.getByLabelText<HTMLInputElement>("Preferred contact");
  expect(input.readOnly).toBe(false);
  expect(input.value).toBe("demo@example.org");
  expect(screen.getByText(DEMO_FIELD_HINT)).toBeDefined();
});

test("AppShell frames the app with role-first header, adjacent banner, footer, and theme", () => {
  const { container } = render(
    <ShowcaseTrustProvider pack={pack} theme={walletTheme}>
      <AppShell appName="Data Vault">
        <main>content</main>
      </AppShell>
    </ShowcaseTrustProvider>,
  );
  expect(screen.getByText("Data Vault")).toBeDefined();
  expect(screen.getByText("consumer data custodian · modelled on Globex Telecom")).toBeDefined();
  const banner = container.querySelector("[data-concept-demo-banner]");
  expect(banner?.textContent).toContain(
    pack.bannerFullText({ organization: walletTheme.modelledOn, role: walletTheme.role }),
  );
  expect(container.querySelector("[data-demo-footer]")?.textContent).toBe(
    pack.footerLegalLine({ organization: walletTheme.modelledOn }),
  );
  const shell = container.querySelector<HTMLElement>("[data-app-shell]");
  expect(shell?.style.getPropertyValue("--primary")).toBe(walletTheme.tokens.primary);
});

test("AppShell accepts an explicit theme prop over the provider theme", () => {
  render(
    <ShowcaseTrustProvider pack={pack} theme={walletTheme}>
      <AppShell appName="Tour" theme={tourTheme} variant="own">
        <main>content</main>
      </AppShell>
    </ShowcaseTrustProvider>,
  );
  expect(screen.getByText("convener · Example Demo Collective")).toBeDefined();
});

test("AppShell own-branded variant frames without source-negation", () => {
  const { container } = render(
    <ShowcaseTrustProvider pack={pack} theme={tourTheme}>
      <AppShell appName="Journey Tour" variant="own">
        <main>content</main>
      </AppShell>
    </ShowcaseTrustProvider>,
  );
  expect(container.querySelector("[data-concept-demo-banner]")?.textContent).not.toContain(
    "this is not",
  );
  expect(container.querySelector("[data-demo-footer]")?.textContent).not.toContain(
    "Not affiliated",
  );
});

test("StatCard wraps illustrative values in the qualifier tag", () => {
  const { container } = render(
    <StatCard detail="illustrative daily figure" illustrative label="Quoted rate" value="6.875%" />,
  );
  expect(screen.getByText("Quoted rate")).toBeDefined();
  expect(container.querySelector("[data-illustrative-figure]")?.textContent).toBe(
    "6.875% — illustrative figure, not an offer",
  );
  expect(screen.getByText("illustrative daily figure")).toBeDefined();
});

test("CredentialCard shows issuer, validity window, and a non-colour-only status", () => {
  const { container } = render(
    <CredentialCard
      issuer="employment and income verifier (demo)"
      status="revoked"
      title="Employment and income"
      validFrom="2026-01-01"
      validUntil="2027-01-01"
    />,
  );
  expect(screen.getByText("Issued by employment and income verifier (demo)")).toBeDefined();
  expect(screen.getByText("Valid from 2026-01-01 · until 2027-01-01")).toBeDefined();
  const status = container.querySelector("[data-credential-status='revoked']");
  expect(status?.textContent).toContain("Revoked");
});

test("HonestyPanel is a native disclosure with injected real/simulated content", () => {
  const { container } = render(
    <HonestyPanel real={<p>Actual Solid pod reads</p>} simulated={<p>Rates and decisions</p>} />,
  );
  const details = container.querySelector<HTMLDetailsElement>("details[data-honesty-panel]");
  expect(details?.open).toBe(false);
  expect(screen.getByText("What is real and what is simulated?")).toBeDefined();
  expect(screen.getByText("Actual Solid pod reads")).toBeDefined();
  expect(screen.getByText("Rates and decisions")).toBeDefined();
  cleanup();
  const { container: openContainer } = render(<HonestyPanel defaultOpen real="r" simulated="s" />);
  expect(openContainer.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
});

test("ReceiptCard renders the app-level who, what, and when trail", () => {
  const { container } = render(
    <ReceiptCard
      action="revoke"
      actor="https://pod.example/profile/card#me"
      issuedAt="2026-07-16T14:30:00.000Z"
      recipient="https://operator.example/profile/card#service"
      resource="https://pod.example/consents/closing-record"
    />,
  );
  expect(screen.getByRole("heading", { name: "Access revoked", level: 3 })).toBeDefined();
  expect(screen.getByText("https://pod.example/profile/card#me")).toBeDefined();
  expect(screen.getByText("https://operator.example/profile/card#service")).toBeDefined();
  expect(screen.getByText("https://pod.example/consents/closing-record")).toBeDefined();
  expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-07-16T14:30:00.000Z",
  );
  expect(screen.getByText(/written by this application/)).toBeDefined();
});
