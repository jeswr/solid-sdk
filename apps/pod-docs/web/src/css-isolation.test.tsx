// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CSS-ISOLATION REGRESSION GUARD (#80 / solid-elements adoption #115, D-parity
// rollout #67/#68/#70).
//
// pod-docs RELAXED its CSS-leak workaround back to a near-global `button {}` filled
// rule (scoped via `:where(:not([data-app-shell-control]))`) + a direct re-alias of
// the host's `--accent` / `--accent-ink` onto the app-shell tokens, because
// @jeswr/app-shell #80 made the shell SELF-ISOLATING. This test pins WHY that
// relaxation is safe so a future app-shell bump that regressed the isolation would
// be caught here, not in production:
//
//   1. Every app-shell control the host renders (the FeedbackButton trigger + every
//      control in its portaled dialog) carries `data-app-shell-control`. That is the
//      hook the package's UNLAYERED reset uses to out-rank a host's near-global
//      `button {}` (an attribute selector beats a bare element selector), so the
//      host's filled look can no longer leak onto them.
//   2. The dialog is portaled to <body> (outside `.app-shell` / `.login-form`), which
//      is exactly the surface the old hand-scoping was needed to protect.
//
// (We assert the data-attribute contract rather than computed styles because jsdom
// does not run the cascade; the contract is what the unlayered reset keys off, and
// app-shell's own suite tests the cascade math. The real-browser render is verified
// at runtime in the rollout.)
//
// A THIRD contract is pinned below: the host filled-button base must use
// `:where(:not([data-app-shell-control]))` (zero specificity) and NOT a bare
// `:not([data-app-shell-control])` — see that describe block for why.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AccountMenu, FeedbackButton, ThemeProvider, ThemeToggle } from "@jeswr/app-shell";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// styles.css read from disk via the vitest cwd (= the web/ package root). NOT
// import.meta.url — vite serves the module under a non-file URL, so reading from
// the import URL fails; resolve(process.cwd(), "src/styles.css") is the file path.
const stylesCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("app-shell CSS isolation survives pod-docs's bare button {} (#80)", () => {
  it("every header control App renders is isolation-tagged", () => {
    // Render the SAME app-shell header trio App.tsx mounts (FeedbackButton +
    // ThemeToggle + AccountMenu), so the guard covers ALL the chrome the bare
    // `button {}` could leak onto — not just the FeedbackButton. A future app-shell
    // bump that dropped `data-app-shell-control` from ANY of these would fail here.
    const { container } = render(
      // ThemeProvider wraps the trio exactly as main.tsx does (ThemeToggle reads
      // the theme context). matchMedia is polyfilled in test/setup.ts.
      <ThemeProvider>
        <FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" appVersion="testsha" />
        <ThemeToggle />
        <AccountMenu
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
    render(<FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />);
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

describe("host filled-button base is zero-specificity (`:where()`, not bare `:not()`)", () => {
  // THE SPECIFICITY BUG this guard prevents (roborev Medium, addressed):
  //   A bare `button:not([data-app-shell-control])` has specificity (0,1,1) — the
  //   attribute selector LEAKS its (0,1,0) THROUGH `:not()`. That (0,1,1) base then
  //   OUT-RANKS the host's OWN class-only overrides (`.pod-docs-open-link`,
  //   `.pod-docs-new-cancel` — both (0,1,0) <button> elements), so those
  //   transparent/outline link+cancel buttons get repainted with the filled base
  //   look (background: var(--accent)) — a real visual regression.
  //   Wrapping the exclusion in `:where()` (zero specificity) makes the base
  //   (0,0,1) — identical to the unscoped `button {}` it replaced — so the class-only
  //   host overrides (0,1,0) win again, while [data-app-shell-control] stays excluded.
  // We assert against the SOURCE CSS (jsdom does not run the cascade), which is the
  // single artifact a future edit could regress.

  // Strip /* … */ block comments so the prose discussion of the rejected forms in
  // styles.css cannot accidentally satisfy/violate these substring assertions.
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("uses the zero-specificity :where(:not([data-app-shell-control])) base", () => {
    expect(css).toContain("button:where(:not([data-app-shell-control]))");
  });

  it("does NOT use the bare button:not([data-app-shell-control]) form (leaks (0,1,0) → (0,1,1))", () => {
    // The bare `:not()` form would be `button:not([data-app-shell-control])` NOT
    // immediately preceded by `:where(`. Match any `button:not(...)` occurrence whose
    // preceding token is not the `:where(` wrapper.
    expect(/(?<!:where\()button:not\(\[data-app-shell-control\]\)/.test(css)).toBe(false);
  });

  it("does NOT use an unscoped global `button {` filled base", () => {
    // The original pre-scope form. A bare `button {` (or `button{`) declaration block
    // would repaint EVERY button including the app-shell controls' box model.
    expect(/button\s*\{/.test(css)).toBe(false);
  });

  it("excludes app-shell controls (the [data-app-shell-control] marker is still in the base)", () => {
    // Sanity: the fix must KEEP excluding app-shell controls, not drop the exclusion.
    expect(css).toContain("[data-app-shell-control]");
  });
});
