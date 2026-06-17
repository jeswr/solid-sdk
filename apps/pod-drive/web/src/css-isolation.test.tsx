// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CSS-ISOLATION REGRESSION GUARD (#80 / solid-elements adoption #115, D-parity
// rollout #67/#68/#70).
//
// @jeswr/app-shell `5a7484d` made the shell SELF-ISOLATING (#80): every control it
// renders carries `data-app-shell-control`, and an UNLAYERED reset (the package's
// reset.css) re-asserts those controls' COLOUR/border/fill through shell-private
// `--as-*` tokens — out-ranking a consuming app's bare unlayered `button {}` rule.
//
// pod-drive's host filled-button look stays HOST-SCOPED (`.login-form button`,
// `.pod-drive-error button`) rather than a bare global `button {}`, because that
// reset DELIBERATELY does NOT lock the box model (padding / border-radius /
// font-size / sizing — see reset.css), so a bare `button {}` would still distort the
// shell controls' layered sizing. This test pins the part of the isolation contract
// the shell DOES guarantee — the `data-app-shell-control` tagging on every control,
// incl. those in the PORTALED feedback dialog — so a future app-shell bump that
// dropped the attribute (regressing the colour-leak protection) would be caught here,
// not in production.
//
// We assert the data-attribute contract rather than computed styles because jsdom
// does not run the cascade; the contract is what the unlayered reset keys off, and
// app-shell's own suite tests the cascade math. The real-browser render is verified
// at runtime in the rollout.
import { AccountMenu, FeedbackButton, ThemeProvider, ThemeToggle } from "@jeswr/app-shell";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("app-shell CSS isolation (#80) — every control is isolation-tagged", () => {
  it("every header control App renders is isolation-tagged", () => {
    // Render the SAME app-shell header trio App.tsx mounts (FeedbackButton +
    // ThemeToggle + AccountMenu), so the guard covers ALL the chrome a host
    // `button {}` could leak onto — not just the FeedbackButton. A future app-shell
    // bump that dropped `data-app-shell-control` from ANY of these would fail here.
    const { container } = render(
      // ThemeProvider wraps the trio exactly as main.tsx does (ThemeToggle reads
      // the theme context). matchMedia is polyfilled in test/setup.ts.
      <ThemeProvider>
        <FeedbackButton repo="jeswr/pod-drive" appName="Pod Drive" appVersion="testsha" />
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
    render(<FeedbackButton repo="jeswr/pod-drive" appName="Pod Drive" />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const dialog = await screen.findByRole("dialog");
    // Collect the dialog's interactive controls — the surface a bare `button {}`
    // historically leaked onto (the dialog is portaled to <body>, outside .app-shell).
    const dialogControls = within(dialog).getAllByRole("button");
    expect(dialogControls.length).toBeGreaterThan(0);
    // EVERY button in the dialog must be isolation-tagged, so none can be repainted
    // by a host's unlayered filled `button {}` rule.
    for (const btn of dialogControls) {
      expect(btn).toHaveAttribute("data-app-shell-control");
    }
    // ALSO cover the portaled controls that are SIBLINGS of the dialog node rather
    // than descendants of it — most importantly the full-bleed translucent BACKDROP
    // button (`data-app-shell-control="backdrop"`), which a `within(dialog)` query
    // misses but which is just as exposed to a host `button { background; padding;
    // margin }` leak (reset.css re-asserts its scrim look). Scan EVERY <button> in the
    // document body once the dialog is open: each must carry the isolation attribute.
    const allPortaledButtons = document.body.querySelectorAll("button");
    expect(allPortaledButtons.length).toBeGreaterThan(dialogControls.length);
    let sawBackdrop = false;
    for (const btn of allPortaledButtons) {
      expect(btn).toHaveAttribute("data-app-shell-control");
      if (btn.getAttribute("data-app-shell-control") === "backdrop") sawBackdrop = true;
    }
    // Pin the backdrop specifically (the sibling control the dialog-scoped query above
    // does not reach) so a future app-shell bump that dropped its tagging fails here.
    expect(sawBackdrop).toBe(true);
  });
});
