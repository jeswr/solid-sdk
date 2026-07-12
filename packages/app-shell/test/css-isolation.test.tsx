// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CSS isolation (#80) — the shell's controls carry the `data-app-shell-control`
// marker that `styles/reset.css` targets, so a consuming app's global element
// styles (a bare `button {}` / `input {}` / `textarea {}` rule — which is
// UNLAYERED and therefore out-ranks Tailwind's layered utilities) cannot bleed
// into the shell. These tests pin the contract that EVERY shell control exposes
// the marker (so the defensive reset actually reaches them) and that the marker
// distinguishes the ghost/outline variants the reset styles per-variant.
//
// (The cascade-precedence mechanism itself — attribute-selector 0,1,1 beats a
// bare element selector 0,0,1, both unlayered — is verified at the CSS level; in
// jsdom there is no layout/cascade engine, so we assert the structural contract
// the reset relies on: presence + variant of the marker on the rendered DOM.)
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AccountMenu } from "../src/components/account-menu.js";
import { FeedbackButton } from "../src/components/feedback.js";
import { APP_SHELL_CONTROL_ATTR, Button } from "../src/components/primitives.js";
import { ThemeProvider } from "../src/components/theme-provider.js";
import { ThemeToggle } from "../src/components/theme-toggle.js";

const user = userEvent.setup({ pointerEventsCheck: 0 });

describe("CSS isolation — the [data-app-shell-control] marker (#80)", () => {
  it("exports the canonical marker attribute name", () => {
    expect(APP_SHELL_CONTROL_ATTR).toBe("data-app-shell-control");
  });

  it("the <Button> primitive (ghost) carries the marker + its variant", () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole("button", { name: "Click" });
    expect(btn).toHaveAttribute("data-app-shell-control");
    expect(btn).toHaveAttribute("data-variant", "ghost");
  });

  it("the outline <Button> carries the marker + the outline variant", () => {
    render(<Button variant="outline">Outline</Button>);
    const btn = screen.getByRole("button", { name: "Outline" });
    expect(btn).toHaveAttribute("data-app-shell-control");
    expect(btn).toHaveAttribute("data-variant", "outline");
  });

  it("the escape hatch (defensiveReset={false}) OMITS the marker so a consumer's className wins", () => {
    // An app building its own chrome on the exported primitive opts out of the
    // defensive fill reset; with no marker, reset.css does not target the button
    // and the consumer's Tailwind classes fully control its look (roborev #80).
    render(
      <Button defensiveReset={false} className="bg-red-500">
        Custom
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Custom" })).not.toHaveAttribute(
      "data-app-shell-control",
    );
  });

  it("the FeedbackButton trigger carries the marker", () => {
    render(<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" />);
    const trigger = screen.getByRole("button", { name: "Feedback" });
    expect(trigger).toHaveAttribute("data-app-shell-control");
  });

  it("the FeedbackDialog's native controls (backdrop, textarea, consent) carry the marker", async () => {
    render(
      <FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" webId="https://ada.example/me" />,
    );
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");

    // The full-bleed backdrop button is tagged with the "backdrop" role value so
    // the reset can re-assert its translucent scrim against a host `button {}`.
    const backdrop = screen.getByRole("button", { name: "Close feedback dialog" });
    expect(backdrop).toHaveAttribute("data-app-shell-control", "backdrop");

    // The description textarea + the WebID-consent checkbox are tagged so a host
    // `textarea {}` / `input {}` reset cannot blank out their look.
    expect(within(dialog).getByLabelText("Tell us more")).toHaveAttribute("data-app-shell-control");
    expect(within(dialog).getByRole("checkbox")).toHaveAttribute("data-app-shell-control");

    // The (sr-only) category radios are tagged too, so the reset can re-assert
    // their visually-hidden styling against a host `input {}` reset.
    for (const radio of within(dialog).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("data-app-shell-control");
    }

    // The visible category <label> cards are tagged ("card"), so a host `label {}`
    // reset can't repaint the selector; the selected card carries `data-selected`.
    const cards = dialog.querySelectorAll('label[data-app-shell-control="card"]');
    expect(cards.length).toBe(3);
    expect(
      dialog.querySelector('label[data-app-shell-control="card"][data-selected]'),
    ).not.toBeNull();
  });

  it("the ThemeToggle trigger carries the marker", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: /change colour theme/i })).toHaveAttribute(
      "data-app-shell-control",
    );
  });

  it("the AccountMenu trigger carries the marker", () => {
    render(<AccountMenu webId="https://ada.example/me" onSignOut={() => {}} />);
    expect(screen.getByRole("button", { name: /account menu/i })).toHaveAttribute(
      "data-app-shell-control",
    );
  });
});
