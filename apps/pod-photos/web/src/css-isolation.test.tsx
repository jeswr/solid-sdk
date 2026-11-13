// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Keep host button styling inside PhotoGallery so shared chrome, SignInCard and
// portaled dialogs retain their own colours and box model. jsdom cannot exercise
// the full CSS cascade, so pin the selector boundary and chrome marker contract.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccountControl, FeedbackButton, ThemeProvider, ThemeToggle } from "@jeswr/app-shell";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

afterEach(cleanup);

// The host stylesheet source — read statically so we can assert its selector text.
// (jsdom does not run the cascade, so a computed-style check would not catch a scope
// regression; the source-text assertion below does.)
const STYLES_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "styles.css"),
  "utf8",
);

describe("app-shell CSS isolation survives pod-photos's host button base (#80 / #121)", () => {
  // STALE-INSTALL GUARD. The `data-app-shell-control` contract is satisfied by the
  // @jeswr/app-shell build pinned in package.json (5a7484d ships the unlayered reset
  // primitive that stamps the attribute). A LOCAL node_modules holding an OLDER
  // app-shell build than the lockfile resolves (a build-skew stale install) renders the
  // controls WITHOUT the attribute, making the render assertions below fail with a
  // cryptic `received: null`. Probe the installed build once and, if the hook is absent,
  // fail with the actionable cause instead — a clean reinstall fixes it. (`npm ci`
  // rebuilds the git dep from the pinned SHA; CI is always clean, so this only bites
  // stale local checkouts.) This does NOT replace the contract assertions below — it
  // disambiguates a stale-install failure from a genuine app-shell isolation regression.
  beforeAll(() => {
    const { container } = render(<FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" />);
    const probe = container.querySelector("button");
    if (probe && !probe.hasAttribute("data-app-shell-control")) {
      throw new Error(
        "Installed @jeswr/app-shell build does NOT emit data-app-shell-control — " +
          "this is a STALE/build-skew node_modules, not a CSS-isolation regression. " +
          "Run `npm ci` to rebuild the git dep from the pinned SHA, then re-run.",
      );
    }
    cleanup();
  });

  it("scopes the host button base to PhotoGallery and preserves suite-ui tokens", () => {
    expect(STYLES_CSS).toContain(
      ".pod-photos-gallery button:where(:not([data-app-shell-control])) {",
    );
    expect(STYLES_CSS).not.toMatch(/(^|\n)\s*button(?::not\([^\n]*\))?\s*\{/);
    for (const sheet of ["tokens", "theme", "density", "components"]) {
      expect(STYLES_CSS).toContain(`@import "@jeswr/suite-ui/styles/${sheet}.css"`);
    }
    expect(STYLES_CSS).toContain('@source "../node_modules/@jeswr/suite-ui/dist";');
    expect(STYLES_CSS).not.toMatch(/(^|\n)\s*--(?:surface|accent|muted)\s*:/);
  });

  it("every header control App renders is isolation-tagged", () => {
    // Render the SAME app-shell header trio App.tsx mounts (FeedbackButton +
    // ThemeToggle + AccountControl), so the guard covers ALL the chrome the bare
    // `button {}` could leak onto — not just the FeedbackButton. A future app-shell
    // bump that dropped `data-app-shell-control` from ANY of these would fail here.
    const { container } = render(
      // ThemeProvider wraps the trio exactly as main.tsx does (ThemeToggle reads
      // the theme context). matchMedia is polyfilled in test/setup.ts.
      <ThemeProvider>
        <FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" appVersion="testsha" />
        <ThemeToggle />
        <AccountControl
          webId="https://alice.example/profile/card#me"
          displayName="Alice"
          onSignOut={() => {}}
        />
      </ThemeProvider>,
    );
    const buttons = container.querySelectorAll("button");
    // The trio renders at least three trigger buttons.
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    // EVERY app-shell button in the header must opt into the unlayered reset, so a
    // host `button {}` cannot repaint any of them.
    for (const btn of buttons) {
      expect(btn).toHaveAttribute("data-app-shell-control");
    }
    // And specifically the FeedbackButton trigger (the one whose dialog we open below).
    expect(screen.getByRole("button", { name: /feedback/i })).toHaveAttribute(
      "data-app-shell-control",
    );
  });

  it("every control in the portaled feedback dialog is isolation-tagged", async () => {
    render(<FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const dialog = await screen.findByRole("dialog");
    // Collect the dialog's interactive controls — the surface the bare `button {}`
    // historically leaked onto (the dialog is portaled to <body>, outside .app-shell).
    const controls = within(dialog).getAllByRole("button");
    expect(controls.length).toBeGreaterThan(0);
    // EVERY button in the dialog must be isolation-tagged, so none can be repainted
    // by the host's unlayered filled `button {}` rule.
    for (const btn of controls) {
      expect(btn).toHaveAttribute("data-app-shell-control");
    }
  });
});
