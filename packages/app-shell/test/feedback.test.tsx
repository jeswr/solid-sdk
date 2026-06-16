// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// FeedbackButton / FeedbackDialog — the pure URL/body helpers (encoding,
// WebID-consent gating) and the two submit mechanisms (proxy hook vs. GitHub
// prefill). The pure helpers carry the load-bearing privacy + encoding logic;
// the component tests exercise the two paths end-to-end.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  FeedbackButton,
  type FeedbackDiagnostics,
  feedbackLabels,
} from "../src/components/feedback.js";

const user = userEvent.setup({ pointerEventsCheck: 0 });

const diag = (over: Partial<FeedbackDiagnostics> = {}): FeedbackDiagnostics => ({
  appName: "Pod Mail",
  appVersion: "abc1234",
  pageUrl: "https://mail.example/inbox",
  userAgent: "TestUA/1.0",
  ...over,
});

describe("buildIssueUrl", () => {
  it("URL-encodes the title, body, and labels into the new-issue URL", () => {
    const url = buildIssueUrl({
      repo: "jeswr/pod-mail",
      title: "[Bug] It broke & vanished",
      body: "line one\nline two",
      labels: ["user-feedback", "bug"],
    });
    expect(url.startsWith("https://github.com/jeswr/pod-mail/issues/new?")).toBe(true);
    const qs = new URL(url).searchParams;
    expect(qs.get("title")).toBe("[Bug] It broke & vanished");
    expect(qs.get("body")).toBe("line one\nline two");
    expect(qs.get("labels")).toBe("user-feedback,bug");
    // Special chars are percent-encoded in the raw string.
    expect(url).toContain("It+broke+%26+vanished");
  });

  it("omits the labels param when there are none", () => {
    const url = buildIssueUrl({ repo: "jeswr/pod-docs", title: "t", body: "b", labels: [] });
    expect(new URL(url).searchParams.has("labels")).toBe(false);
  });
});

describe("feedbackLabels", () => {
  it("always includes user-feedback plus the category", () => {
    expect(feedbackLabels("bug")).toEqual(["user-feedback", "bug"]);
    expect(feedbackLabels("feedback")).toEqual(["user-feedback", "feedback"]);
    expect(feedbackLabels("help")).toEqual(["user-feedback", "help"]);
  });
});

describe("composeIssueTitle", () => {
  it("prefixes the category and uses the first non-empty line", () => {
    expect(composeIssueTitle("bug", "  \n  Cannot send mail\nmore detail")).toBe(
      "[Bug] Cannot send mail",
    );
    expect(composeIssueTitle("feedback", "Love the dark mode")).toBe(
      "[Feedback] Love the dark mode",
    );
    expect(composeIssueTitle("help", "How do I share?")).toBe("[Help] How do I share?");
  });

  it("falls back to just the prefix for an empty description", () => {
    expect(composeIssueTitle("bug", "   ")).toBe("[Bug]");
  });
});

describe("composeIssueBody", () => {
  it("appends the diagnostics block (app/page/UA) after the description", () => {
    const body = composeIssueBody("Something is wrong", diag());
    expect(body).toContain("Something is wrong");
    expect(body).toContain("App: Pod Mail abc1234");
    expect(body).toContain("Page: https://mail.example/inbox");
    expect(body).toContain("UA: TestUA/1.0");
  });

  it("OMITS the WebID when no webId is present (no consent)", () => {
    const body = composeIssueBody("hi", diag({ webId: undefined }));
    expect(body).not.toContain("Reporter WebID");
    expect(body).not.toContain("https://ada.example");
  });

  it("INCLUDES the WebID only when it is set (consent given)", () => {
    const body = composeIssueBody("hi", diag({ webId: "https://ada.example/me" }));
    expect(body).toContain("Reporter WebID: https://ada.example/me");
  });

  it("omits the version segment when no appVersion is given", () => {
    const body = composeIssueBody("hi", diag({ appVersion: undefined }));
    expect(body).toContain("App: Pod Mail\n");
    expect(body).not.toContain("App: Pod Mail undefined");
  });
});

describe("FeedbackButton — submit hook (proxy) path", () => {
  it("calls the submit hook (not window.open) and renders the created issue link", async () => {
    const submit = vi
      .fn()
      .mockResolvedValue({ url: "https://github.com/jeswr/pod-mail/issues/42", number: 42 });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" submit={submit} />);

    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tell us more"), "Cannot send mail");
    await user.click(within(dialog).getByRole("button", { name: /send feedback/i }));

    expect(submit).toHaveBeenCalledTimes(1);
    const payload = submit.mock.calls[0][0];
    expect(payload.repo).toBe("jeswr/pod-mail");
    expect(payload.category).toBe("bug");
    expect(payload.labels).toEqual(["user-feedback", "bug"]);
    expect(payload.description).toBe("Cannot send mail");
    // The proxy path must NOT also open a browser tab.
    expect(openSpy).not.toHaveBeenCalled();

    expect(await screen.findByText(/tracked as/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "#42" });
    expect(link).toHaveAttribute("href", "https://github.com/jeswr/pod-mail/issues/42");

    openSpy.mockRestore();
  });

  it("shows an error state when the submit hook rejects", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("proxy is down"));
    render(<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" submit={submit} />);

    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tell us more"), "broken");
    await user.click(within(dialog).getByRole("button", { name: /send feedback/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("proxy is down");
  });
});

describe("FeedbackButton — GitHub prefill path (no hook)", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    openSpy.mockRestore();
  });

  it("opens the prefilled new-issue URL in a new tab when no submit hook is given", async () => {
    render(<FeedbackButton repo="jeswr/pod-photos" appName="Pod Photos" appVersion="v9" />);

    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");
    // Pick the Feedback category, then describe.
    await user.click(within(dialog).getByRole("radio", { name: /Feedback/ }));
    await user.type(within(dialog).getByLabelText("Tell us more"), "Add an album view");
    await user.click(within(dialog).getByRole("button", { name: /open issue on github/i }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe("https://github.com/jeswr/pod-photos/issues/new");
    expect(parsed.searchParams.get("title")).toBe("[Feedback] Add an album view");
    expect(parsed.searchParams.get("labels")).toBe("user-feedback,feedback");
    expect(parsed.searchParams.get("body")).toContain("App: Pod Photos v9");
  });

  it("does NOT include the WebID unless the consent box is ticked", async () => {
    render(
      <FeedbackButton repo="jeswr/pod-music" appName="Pod Music" webId="https://ada.example/me" />,
    );

    await user.click(screen.getByRole("button", { name: "Feedback" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tell us more"), "no consent");
    await user.click(within(dialog).getByRole("button", { name: /open issue on github/i }));

    let body = new URL(openSpy.mock.calls[0][0] as string).searchParams.get("body") ?? "";
    expect(body).not.toContain("Reporter WebID");
    openSpy.mockClear();

    // Re-open, tick consent, submit again → WebID present.
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tell us more"), "with consent");
    await user.click(
      within(dialog).getByLabelText(/Include my WebID so the maintainer can follow up/i),
    );
    await user.click(within(dialog).getByRole("button", { name: /open issue on github/i }));

    body = new URL(openSpy.mock.calls[0][0] as string).searchParams.get("body") ?? "";
    expect(body).toContain("Reporter WebID: https://ada.example/me");
  });

  it("disables submit until a description is entered (required)", async () => {
    render(<FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /open issue on github/i })).toBeDisabled();
  });
});

describe("FeedbackDialog — modal focus management (a11y)", () => {
  it("moves focus into the dialog on open and restores it to the trigger on close", async () => {
    render(<FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />);
    const trigger = screen.getByRole("button", { name: "Feedback" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    // The description textarea takes focus on open (focus is inside the dialog).
    const textarea = within(dialog).getByLabelText("Tell us more");
    await vi.waitFor(() => expect(textarea).toHaveFocus());

    // Escape closes and restores focus to the trigger.
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
