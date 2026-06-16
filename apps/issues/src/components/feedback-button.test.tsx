// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

// The shared FeedbackButton (from @jeswr/app-shell) wired into the Solid Issues
// header. This guards that it renders with our OWN repo (`jeswr/solid-issues`)
// and that, with `submit` unset (GitHub prefill mode), opening the dialog and
// submitting targets that repo's `/issues/new` page — i.e. feedback is filed
// against solid-issues, not some other app's repo.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackButton } from "@jeswr/app-shell";

afterEach(cleanup);

describe("FeedbackButton (Solid Issues)", () => {
  it("renders the feedback trigger", () => {
    render(<FeedbackButton repo="jeswr/solid-issues" appName="Solid Issues" />);
    expect(screen.getByRole("button", { name: "Feedback" })).toBeTruthy();
  });

  it("files an issue against jeswr/solid-issues in GitHub prefill mode", () => {
    // `submit` unset → prefill mode opens GitHub's new-issue page in a new tab.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      render(
        <FeedbackButton
          repo="jeswr/solid-issues"
          appName="Solid Issues"
          appVersion="test-sha"
        />,
      );

      // Open the dialog, type a description, submit. With `submit` unset the
      // action button is labelled "Open issue on GitHub" (prefill mode).
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Something is wrong" } });
      fireEvent.click(screen.getByRole("button", { name: /open issue on github/i }));

      expect(open).toHaveBeenCalled();
      const url = String(open.mock.calls[0]?.[0] ?? "");
      expect(url).toContain("github.com/jeswr/solid-issues/issues/new");
    } finally {
      open.mockRestore();
    }
  });
});
