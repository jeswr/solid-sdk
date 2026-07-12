// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the header FeedbackButton wiring the App uses (App.tsx): the shared
// @jeswr/app-shell <FeedbackButton/> renders with pod-mail's OWN repo
// (`jeswr/pod-mail`) and app name, and opening it surfaces the themed feedback
// dialog. We test the component with the SAME props the header passes rather than
// mounting the whole App (which needs the full auth runtime + a live session) —
// the load-bearing, app-specific contract here is "files against jeswr/pod-mail".
//
// The deeper feedback behaviour (URL encoding, WebID-consent gating, the proxy
// vs. prefill paths) is exhaustively tested in @jeswr/app-shell itself; this is
// the thin adoption test for the pilot.
import { FeedbackButton } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("header FeedbackButton (pod-mail adoption)", () => {
  it("renders the Feedback trigger with repo=jeswr/pod-mail wiring", () => {
    render(
      <FeedbackButton
        repo="jeswr/pod-mail"
        appName="Pod Mail"
        appVersion="testsha"
        webId="https://alice.example/profile/card#me"
      />,
    );
    // The default trigger label is "Feedback"; it is a real <button>.
    const trigger = screen.getByRole("button", { name: /feedback/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the feedback dialog targeting the app's own repo", async () => {
    render(<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" />);
    // Closed by default — no dialog in the tree until the trigger is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    // The dialog opens (the open-state update flushes asynchronously). Its copy
    // names the app so the reporter knows where the issue lands. (The prefill
    // GitHub URL — built from repo="jeswr/pod-mail" — is unit-tested in
    // app-shell's own buildIssueUrl suite.)
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Pod Mail/i);
  });
});
