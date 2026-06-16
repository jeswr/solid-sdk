// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the header FeedbackButton wiring the App uses (App.tsx): the shared
// @jeswr/app-shell <FeedbackButton/> renders with pod-photos's OWN repo
// (`jeswr/pod-photos`) and app name, and opening it surfaces the themed feedback
// dialog. We test the component with the SAME props the header passes rather than
// mounting the whole App (which needs the full auth runtime + a live session) —
// the load-bearing, app-specific contract here is "files against jeswr/pod-photos".
//
// The deeper feedback behaviour (URL encoding, WebID-consent gating, the proxy
// vs. prefill paths) is exhaustively tested in @jeswr/app-shell itself; this is
// the thin adoption test for the parity rollout.
import { FeedbackButton } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("header FeedbackButton (pod-photos adoption)", () => {
  it("renders the Feedback trigger with repo=jeswr/pod-photos wiring", () => {
    render(
      <FeedbackButton
        repo="jeswr/pod-photos"
        appName="Pod Photos"
        appVersion="testsha"
        webId="https://alice.example/profile/card#me"
      />,
    );
    // The default trigger label is "Feedback"; it is a real <button>.
    const trigger = screen.getByRole("button", { name: /feedback/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the feedback dialog targeting the app's own repo", async () => {
    render(<FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" />);
    // Closed by default — no dialog in the tree until the trigger is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    // The dialog opens (the open-state update flushes asynchronously). Its copy
    // names the app so the reporter knows where the issue lands.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Pod Photos/i);
  });

  // The load-bearing, app-specific contract: with `submit` UNSET (our wiring),
  // submitting opens a GitHub issue against THIS app's OWN repo. We mock
  // window.open and assert the prefill URL targets jeswr/pod-photos/issues/new —
  // so the test would FAIL if the repo prop were ever wired to the wrong repo.
  describe("prefill submit targets the app's own GitHub repo", () => {
    beforeEach(() => {
      vi.spyOn(window, "open").mockImplementation(() => null);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("opens github.com/jeswr/pod-photos/issues/new on submit", async () => {
      render(<FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" appVersion="testsha" />);
      fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
      await screen.findByRole("dialog");
      // The submit control is disabled until a description is entered, so fill the
      // "Tell us more" textarea first.
      fireEvent.change(screen.getByRole("textbox", { name: /tell us more/i }), {
        target: { value: "A test report from the adoption suite." },
      });
      // The submit control (no `submit` prop → GitHub prefill path) is labelled
      // "Open issue on GitHub". Click it and assert the opened URL.
      fireEvent.click(screen.getByRole("button", { name: /open issue on github/i }));
      expect(window.open).toHaveBeenCalledTimes(1);
      const url = (window.open as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("https://github.com/jeswr/pod-photos/issues/new");
    });
  });
});
