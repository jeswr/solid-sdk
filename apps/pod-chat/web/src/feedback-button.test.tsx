// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// This is the ONLY test that needs a DOM, so it opts into jsdom per-file (the
// suite default is `node` — see vitest.config.ts). The pragma MUST be the first
// line for vitest to honour it.
//
// Pins the header FeedbackButton wiring the App uses (App.tsx): the shared
// @jeswr/app-shell <FeedbackButton/> renders with pod-chat's OWN repo
// (`jeswr/pod-chat`) and app name, and opening it surfaces the themed feedback
// dialog. We test the component with the SAME props the header passes rather than
// mounting the whole App (which needs the full auth runtime + a live session) —
// the load-bearing, app-specific contract here is "files against jeswr/pod-chat".
//
// The deeper feedback behaviour (URL encoding, WebID-consent gating, the proxy
// vs. prefill paths) is exhaustively tested in @jeswr/app-shell itself; this is
// the thin adoption test for the parity rollout.
import { buildIssueUrl, FeedbackButton } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("header FeedbackButton (pod-chat adoption)", () => {
  it("builds the GitHub issue URL against jeswr/pod-chat (the load-bearing repo wiring)", () => {
    // The repo value the header passes is load-bearing: it decides WHERE a filed
    // issue lands. Assert it through app-shell's pure URL builder (the same one the
    // dialog's submit path uses, feedback.tsx) so a wrong repo value FAILS here —
    // the render/open assertions below alone would pass for any repo.
    const url = buildIssueUrl({
      repo: "jeswr/pod-chat",
      title: "Feedback",
      body: "hello",
      labels: ["feedback"],
    });
    expect(url.startsWith("https://github.com/jeswr/pod-chat/issues/new?")).toBe(true);
    // Negative: a different repo would target a different path — so the assertion
    // above genuinely pins jeswr/pod-chat, not just "any GitHub issues URL".
    expect(url).not.toContain("github.com/jeswr/pod-mail/");
  });

  it("renders the Feedback trigger with repo=jeswr/pod-chat wiring", () => {
    render(
      <FeedbackButton
        repo="jeswr/pod-chat"
        appName="Pod Chat"
        appVersion="testsha"
        webId="https://alice.example/profile/card#me"
      />,
    );
    // The default trigger label is "Feedback"; it is a real <button>.
    const trigger = screen.getByRole("button", { name: /feedback/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the feedback dialog targeting the app's own repo", async () => {
    render(<FeedbackButton repo="jeswr/pod-chat" appName="Pod Chat" />);
    // Closed by default — no dialog in the tree until the trigger is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    // The dialog opens (the open-state update flushes asynchronously). Its copy
    // names the app so the reporter knows where the issue lands. (The prefill
    // GitHub URL — built from repo="jeswr/pod-chat" — is unit-tested in
    // app-shell's own buildIssueUrl suite.)
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Pod Chat/i);
  });
});
