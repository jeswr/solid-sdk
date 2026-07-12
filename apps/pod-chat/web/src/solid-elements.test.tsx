// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// This test needs a DOM (the Lit custom element upgrades + renders a shadow root),
// so it opts into jsdom per-file — the suite default is `node` (see vitest.config.ts).
// The pragma MUST be the first line for vitest to honour it.
//
// Pins the @jeswr/solid-elements adoption (#67/#68/#70 D-parity rollout): the host
// shell consumes the framework-agnostic <jeswr-loading> W3C Web Component DIRECTLY
// (the package's bare entry registers it), passing `label` as a DOM ATTRIBUTE — the
// SAME way App.tsx renders it. This test proves the integration mechanics:
//   1. the element registers + upgrades (its class is defined + instantiated);
//   2. the `label` ATTRIBUTE actually lands as the VISIBLE + ANNOUNCED status copy
//      (the shadow `[part="label"]` text + the `[part="status"]` aria-label), so the
//      signing-in / restoring messages are never silently dropped;
//   3. it carries the app-shell theming-token-inheritance chain in its shadow styles
//      (`--jeswr-*` → app-shell `--primary` / `--border` / `--muted-foreground`), so
//      it follows the host's light/dark theme with no extra wiring.
//
// WHY the raw element + attribute (not the @lit/react `Loading` wrapper): the wrapper
// forwards `label` as a PROPERTY, and @lit/react classifies props at createComponent
// time — before Lit finalises the element class — so under React 19 the `label`
// property can silently fail to land (verified: the wrapper renders no label text and
// the aria-label falls back to "Loading"). The Lit reactive `label` property
// auto-observes the lowercased `label` attribute, and the attribute path is
// environment-independent + verified — so App.tsx uses it, and this test asserts it.
//
// The deeper component behaviour (prefers-reduced-motion, ::part theming) is
// exhaustively tested in @jeswr/solid-elements itself; this is the adoption-mechanics
// test for THIS app, mirroring feedback-button.test.tsx.
import "@jeswr/solid-elements"; // registers <jeswr-loading> (bare-entry side-effect)
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("@jeswr/solid-elements <jeswr-loading> (pod-chat adoption)", () => {
  it("registers + upgrades the jeswr-loading custom element", async () => {
    const { container } = render(<jeswr-loading label="Restoring your session…" />);
    const el = container.querySelector("jeswr-loading");
    expect(el).not.toBeNull();
    // The element upgrades: its class is registered + instantiated.
    await customElements.whenDefined("jeswr-loading");
    expect(customElements.get("jeswr-loading")).toBeTruthy();
    expect(el?.constructor.name).toBe("JeswrLoading");
  });

  it("renders + announces the label passed as a DOM attribute", async () => {
    const { container } = render(<jeswr-loading label="Signing you in…" />);
    const el = container.querySelector("jeswr-loading") as HTMLElement | null;
    await customElements.whenDefined("jeswr-loading");
    // Let Lit's first async render commit.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = el?.shadowRoot?.querySelector('[part="status"]');
    const labelEl = el?.shadowRoot?.querySelector('[part="label"]');
    // THE A11Y CONTRACT (resolving the roborev finding): the label is BOTH visible
    // (the shadow `[part="label"]` text node) AND announced (the status wrapper's
    // aria-label). Both must carry the real message, not the "Loading" fallback —
    // this is what guarantees the signing-in / restoring copy is never dropped.
    expect(labelEl?.textContent).toBe("Signing you in…");
    expect(status?.getAttribute("aria-label")).toBe("Signing you in…");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders a themed shadow root that inherits the app-shell tokens", async () => {
    const { container } = render(<jeswr-loading label="Loading…" />);
    const el = container.querySelector("jeswr-loading") as HTMLElement | null;
    await customElements.whenDefined("jeswr-loading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The component renders into a shadow root (shadow-DOM encapsulation — this is
    // why a host's light-DOM `button {}` rule cannot leak into it).
    expect(el?.shadowRoot).toBeTruthy();
    const shadowCss = el?.shadowRoot?.textContent ?? "";
    // THE THEMING CONTRACT: the component's shadow styles read `--jeswr-*`, each of
    // which falls back through the shadow boundary to the app-shell shadcn token
    // (`--primary` / `--border` / `--muted-foreground`), then to an OKLCH literal.
    // So the host's `.dark`-flipped app-shell tokens reach the component for free.
    expect(shadowCss).toContain("--jeswr-primary: var(--primary");
    expect(shadowCss).toContain("--jeswr-border: var(--border");
    expect(shadowCss).toContain("--jeswr-muted-fg: var(--muted-foreground");
    // The spinner reads those inherited tokens for its colours.
    expect(shadowCss).toContain("var(--jeswr-primary)");
  });
});
