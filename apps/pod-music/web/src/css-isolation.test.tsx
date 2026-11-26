// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Keep host button styling inside MusicLibrary so shared chrome, SignInCard and
// portaled dialogs retain their own colours and box model. jsdom cannot exercise
// the full CSS cascade, so pin the selector boundary and chrome marker contract.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccountControl, FeedbackButton, ThemeProvider, ThemeToggle } from "@jeswr/app-shell";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// The host stylesheet source — read statically so we can assert its selector text.
// (jsdom does not run the cascade, so a computed-style check would not catch a scope
// regression; the source-text assertion below does.)
const STYLES_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "styles.css"),
  "utf8",
);

describe("app-shell CSS isolation survives pod-music's host button base (#80 / #121)", () => {
  it("scopes the host button base to MusicLibrary and excludes shared controls", () => {
    expect(STYLES_CSS).toContain(
      ".pod-music-library button:where(:not([data-app-shell-control])) {",
    );
    expect(STYLES_CSS).not.toMatch(/(^|\n)\s*button(?::not\([^\n]*\))?\s*\{/);
    for (const sheet of ["tokens", "theme", "density", "components"]) {
      expect(STYLES_CSS).toContain(`@import "@jeswr/suite-ui/styles/${sheet}.css"`);
    }
    expect(STYLES_CSS).not.toContain("--surface: var(--card)");
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
        <FeedbackButton repo="jeswr/pod-music" appName="Pod Music" appVersion="testsha" />
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
    render(<FeedbackButton repo="jeswr/pod-music" appName="Pod Music" />);
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
