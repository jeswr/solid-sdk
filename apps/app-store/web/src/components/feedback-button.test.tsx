// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the header FeedbackButton wiring the App uses (App.tsx): the shared
// @jeswr/app-shell <FeedbackButton/> renders with the store's OWN repo
// (`jeswr/solid-app-store`) and app name, and opening it surfaces the themed dialog.
// We test the component with the SAME props the header passes rather than mounting the
// whole App (which needs the full auth runtime) — the load-bearing, app-specific
// contract is "files against jeswr/solid-app-store".
import { FeedbackButton } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("header FeedbackButton (solid-app-store adoption)", () => {
  it("renders the Feedback trigger with repo=jeswr/solid-app-store wiring", () => {
    render(
      <FeedbackButton
        repo="jeswr/solid-app-store"
        appName="Solid App Store"
        appVersion="testsha"
        webId="https://alice.example/profile/card#me"
      />,
    );
    const trigger = screen.getByRole("button", { name: /feedback/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the feedback dialog targeting the app's own repo", async () => {
    render(<FeedbackButton repo="jeswr/solid-app-store" appName="Solid App Store" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // The dialog copy names the app so the reporter knows where the issue lands. (The
    // prefill GitHub URL — built from repo="jeswr/solid-app-store" — is unit-tested in
    // app-shell's own buildIssueUrl suite.)
    expect(dialog).toHaveTextContent(/Solid App Store/i);
  });
});
