// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the @jeswr/solid-elements pilot adoption (#115): the host shell consumes
// the framework-agnostic W3C Web Components through the `./react` (@lit/react)
// adapter. This is the thin "the integration mechanics work" test for the pilot —
// it proves the @lit/react wrapper:
//   1. is importable + typed from `@jeswr/solid-elements/react`;
//   2. mounts in a DOM (the Lit custom element upgrades + renders a shadow root);
//   3. carries the app-shell theming-token-inheritance chain in its shadow styles
//      (`--jeswr-*` → app-shell `--primary` / `--border` / `--muted-foreground`),
//      so it follows the host's light/dark theme with no extra wiring.
//
// THE `label` FORWARDING NOTE (root cause now understood — solid-elements df0fbe4 /
// #122): the WC's `label` IS shown contextually in the real app. df0fbe4 made the
// `label` reactive property `reflect: true`, so the custom element renders the text
// (and mirrors it onto the host `label` attribute) — see the raw-element test below,
// which exercises exactly the same property-set path the @lit/react wrapper uses in
// a browser, and DOES assert the rendered label text under jsdom.
//
// The earlier "label doesn't land in jsdom" was NOT a component bug and NOT
// jsdom-flakiness: under vitest the `@lit/react` package resolves its `node` export
// condition (Vitest runs in Node), whose NODE_MODE build DELIBERATELY skips the
// `useLayoutEffect` that sets non-attribute element PROPERTIES — so the React
// wrapper never forwards `label` here regardless of the component. In a real browser
// the `browser` condition selects the property-setting build and `label` forwards +
// renders. We therefore assert the React-wrapper MOUNT + THEME contract (which holds
// in NODE_MODE), and assert the df0fbe4 label RENDER on the raw element (the
// component contract, independent of the React layer's NODE_MODE quirk).
//
// The deeper component behaviour (prefers-reduced-motion, ::part theming) is
// exhaustively tested in @jeswr/solid-elements itself; this is the adoption-
// mechanics test for THIS app, mirroring feedback-button.test.tsx.
import "@jeswr/solid-elements";
import { Loading } from "@jeswr/solid-elements/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("@jeswr/solid-elements <Loading> (pod-mail pilot adoption)", () => {
  it("is a real React component exported from the ./react adapter", () => {
    // The @lit/react createComponent wrapper is a truthy component.
    expect(Loading).toBeTruthy();
  });

  it("mounts the jeswr-loading custom element via the @lit/react adapter", async () => {
    const { container } = render(<Loading label="Locating your mailbox…" />);
    // The @lit/react adapter renders the registered custom element tag.
    const el = container.querySelector("jeswr-loading");
    expect(el).not.toBeNull();
    // The element upgrades: its class is registered + instantiated.
    await customElements.whenDefined("jeswr-loading");
    expect(customElements.get("jeswr-loading")).toBeTruthy();
    expect(el?.constructor.name).toBe("JeswrLoading");
  });

  it("renders a themed shadow root that inherits the app-shell tokens", async () => {
    const { container } = render(<Loading label="Loading…" />);
    const el = container.querySelector("jeswr-loading") as HTMLElement | null;
    await customElements.whenDefined("jeswr-loading");
    // Let Lit's first async render commit.
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

  // THE df0fbe4 CONTRACT (#122): the WC shows the CONTEXTUAL label text. We assert
  // this on the RAW custom element — the same `el.label = …` property-set path the
  // @lit/react wrapper takes in a real browser — because under vitest the React
  // wrapper resolves @lit/react's NODE_MODE build, which skips property forwarding
  // (see the file header). This exercises the component's own render contract:
  // setting the `label` PROPERTY (1) renders the contextual text in the shadow DOM,
  // (2) reflects onto the host `label` attribute (df0fbe4's `reflect: true`), and
  // (3) sets the accessible name. With the PRE-df0fbe4 pin the property did NOT
  // reflect and the contextual span was dropped, so this test genuinely pins the bump.
  it("shows the contextual label text + reflects it (df0fbe4 reflect:true)", async () => {
    const el = document.createElement("jeswr-loading") as HTMLElement & { label: string | null };
    document.body.appendChild(el);
    await customElements.whenDefined("jeswr-loading");
    el.label = "Locating your mailbox…";
    // Lit applies the property in a microtask; await the element's update.
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // (1) the contextual text renders in the shadow DOM (the `part="label"` span).
    const labelSpan = el.shadowRoot?.querySelector('[part="label"]');
    expect(labelSpan?.textContent).toBe("Locating your mailbox…");
    // (2) df0fbe4 reflects the string property onto the host attribute.
    expect(el.getAttribute("label")).toBe("Locating your mailbox…");
    // (3) the accessible name is the contextual text, not the generic fallback.
    expect(el.shadowRoot?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Locating your mailbox…",
    );
    el.remove();
  });
});
