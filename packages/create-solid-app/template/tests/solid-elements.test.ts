// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the @jeswr/solid-elements adoption baked into every create-solid-app scaffold:
// the suite wait-state spinner <jeswr-loading> is registered (a side effect of
// importing the package) and shows its CONTEXTUAL label via the RAW-ATTRIBUTE form.
//
// THE RAW-ATTRIBUTE FORM (over the @lit/react `<Loading label>` wrapper): under a
// Node runtime (Vitest, and Next's SSR/RSC compile) @lit/react resolves its `node`
// export condition, whose build DELIBERATELY skips the useLayoutEffect that sets
// non-attribute element PROPERTIES — so the React wrapper does NOT forward `label`
// in those modes. The raw element's `label` ATTRIBUTE always reflects (df0fbe4
// `reflect: true`): the WC renders the contextual text + sets the accessible name.
// So the template uses `<jeswr-loading label="…">` directly (see app/page.tsx), and
// this test exercises that exact path — the `label` set as an attribute/property on
// the raw element — which is what reliably renders a contextual label.
//
// This is the adoption-mechanics test for THIS app (the component's deeper behaviour
// — prefers-reduced-motion, ::part theming — is tested in @jeswr/solid-elements
// itself). Runs under jsdom (file-local docblock) so the Lit element can upgrade.
import "@jeswr/solid-elements/react";
import { beforeAll, describe, expect, it } from "vitest";

// jsdom ships no matchMedia; the Lit component reads prefers-reduced-motion, so
// stub it (default: motion allowed) before the element upgrades.
beforeAll(() => {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
});

describe("@jeswr/solid-elements <jeswr-loading> (create-solid-app baked adoption)", () => {
  it("registers the jeswr-loading custom element on import", async () => {
    await customElements.whenDefined("jeswr-loading");
    expect(customElements.get("jeswr-loading")).toBeTruthy();
  });

  it("renders into a themed shadow root inheriting the app-shell tokens", async () => {
    const el = document.createElement("jeswr-loading");
    document.body.appendChild(el);
    await customElements.whenDefined("jeswr-loading");
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // Shadow-DOM encapsulation — this is WHY a host's light-DOM `button {}` rule
    // cannot leak into the spinner (the second isolation reason).
    expect(el.shadowRoot).toBeTruthy();
    const shadowCss = el.shadowRoot?.textContent ?? "";
    // THE THEMING CONTRACT: the shadow styles read `--jeswr-*`, each falling back
    // through the shadow boundary to the app-shell token (--primary/--border/
    // --muted-foreground). So the host's `.dark`-flipped tokens reach it for free.
    expect(shadowCss).toContain("--jeswr-primary: var(--primary");
    expect(shadowCss).toContain("--jeswr-border: var(--border");
    expect(shadowCss).toContain("--jeswr-muted-fg: var(--muted-foreground");
    el.remove();
  });

  it("shows the CONTEXTUAL label via the raw-ATTRIBUTE form (the template's path)", async () => {
    // Exercise the EXACT path the template uses — `<jeswr-loading label="…">` sets
    // the `label` ATTRIBUTE (React renders an unknown string prop on a custom element
    // as a DOM attribute). Use setAttribute so the test guards attribute->property
    // ingestion (Lit's attributeChangedCallback), not just a direct property set: a
    // regression that broke attribute handling (the SSR/template path) would fail
    // here, whereas a property-only set could mask it. The first render is awaited
    // off the connected element before setting the attribute.
    const el = document.createElement("jeswr-loading");
    document.body.appendChild(el);
    await customElements.whenDefined("jeswr-loading");
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    el.setAttribute("label", "Signing you in…");
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // (1) the contextual text renders in the shadow DOM (the part="label" span) —
    // proving the attribute was ingested into the reactive property + rendered.
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe(
      "Signing you in…",
    );
    // (2) the attribute is the one we set (and df0fbe4's reflect keeps it in sync).
    expect(el.getAttribute("label")).toBe("Signing you in…");
    // (3) the accessible name is the contextual text, not a generic fallback.
    expect(
      el.shadowRoot?.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Signing you in…");
    el.remove();
  });
});
