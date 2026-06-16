// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the header FeedbackButton wiring the App uses (App.tsx): the shared
// @jeswr/app-shell <FeedbackButton/> renders with pod-money's OWN repo
// (`jeswr/pod-money`) and app name, and opening it surfaces the themed feedback
// dialog. The render/open tests use the App's OWN exported config constants
// (FEEDBACK_REPO / FEEDBACK_APP_NAME) — NOT duplicated string literals — so a
// regression that re-points the header at the wrong repo fails here. The
// buildIssueUrl assertion proves the generated GitHub issue URL targets
// jeswr/pod-money for exactly the config the header passes.
//
// The deeper feedback behaviour (URL encoding, WebID-consent gating, the proxy
// vs. prefill paths) is exhaustively tested in @jeswr/app-shell itself; this is
// the thin adoption test for the parity rollout.
import { buildIssueUrl, FeedbackButton } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FEEDBACK_APP_NAME, FEEDBACK_REPO } from "./App";

describe("header FeedbackButton (pod-money adoption)", () => {
  it("the App's feedback config targets jeswr/pod-money", () => {
    // Load-bearing, app-specific contract: a filed issue must land on THIS repo.
    expect(FEEDBACK_REPO).toBe("jeswr/pod-money");
    // The generated GitHub issue URL (for the App's exact config) targets the repo.
    const url = buildIssueUrl({ repo: FEEDBACK_REPO, title: "t", body: "b", labels: [] });
    expect(url).toContain("github.com/jeswr/pod-money/issues/new");
  });

  it("renders the Feedback trigger with the App's repo wiring", () => {
    render(
      <FeedbackButton
        repo={FEEDBACK_REPO}
        appName={FEEDBACK_APP_NAME}
        appVersion="testsha"
        webId="https://alice.example/profile/card#me"
      />,
    );
    // The default trigger label is "Feedback"; it is a real <button>.
    const trigger = screen.getByRole("button", { name: /feedback/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the feedback dialog targeting the app's own repo", async () => {
    render(<FeedbackButton repo={FEEDBACK_REPO} appName={FEEDBACK_APP_NAME} />);
    // Closed by default — no dialog in the tree until the trigger is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    // The dialog opens (the open-state update flushes asynchronously). Its copy
    // names the app so the reporter knows where the issue lands.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Pod Money/i);
  });
});
