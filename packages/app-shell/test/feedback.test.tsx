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
  tabbableElements,
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
    const payload = submit.mock.calls[0]?.[0];
    if (!payload) throw new Error("submit was not called with a payload");
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

  it("traps Tab within the dialog: wraps last→first and Shift+Tab first→last", async () => {
    render(<FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");

    // The trap considers the dialog's visible focusables in DOM order — query the
    // same selector the component uses so the test mirrors the trap's view.
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error("the dialog has no focusable controls");

    // Forward Tab from the last focusable wraps to the first.
    last.focus();
    expect(last).toHaveFocus();
    await user.tab();
    await vi.waitFor(() => expect(first).toHaveFocus());

    // Shift+Tab from the first focusable wraps to the last.
    first.focus();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    await vi.waitFor(() => expect(last).toHaveFocus());
  });

  it("pulls focus back into the dialog if focus starts outside it", async () => {
    render(
      <>
        <button type="button">outside</button>
        <FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");

    // Move focus to a control OUTSIDE the dialog, then Tab — the trap pulls it back.
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    expect(outside).toHaveFocus();
    await user.tab();
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  // Regression (roborev Medium): the trap must mirror the BROWSER's tab order, in
  // which a radio group contributes only the CHECKED radio — not every radio. If
  // it counted all three category radios, selecting a non-default category would
  // leave the checked radio ≠ `first`, so Shift+Tab from it would NOT wrap and
  // focus would escape the modal. Verify the wrap holds for a non-default pick.
  it.each([
    "Feedback",
    "Help",
  ])("keeps the trap wrapping after selecting the %s category (checked radio is the group's only tabbable)", async (categoryLabel) => {
    render(<FeedbackButton repo="jeswr/pod-docs" appName="Pod Docs" />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const dialog = await screen.findByRole("dialog");

    // Select a NON-default category so the checked radio is not the first radio.
    const checkedRadio = within(dialog).getByRole("radio", {
      name: new RegExp(categoryLabel),
    });
    await user.click(checkedRadio);
    await vi.waitFor(() => expect(checkedRadio).toBeChecked());

    // The trap's tabbable list mirrors the browser: the group yields ONLY the
    // checked radio, so it is `first`. The last focusable is the submit button.
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const tabbable = tabbableElements(dialog, selector);
    expect(tabbable[0]).toBe(checkedRadio);
    const last = tabbable[tabbable.length - 1];
    if (!last) throw new Error("the dialog has no focusable controls");
    // Exactly one radio of the category group is tabbable (the checked one).
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    expect(tabbable.filter((el) => radios.includes(el as HTMLInputElement))).toEqual([
      checkedRadio,
    ]);

    // Shift+Tab from the checked radio (the first focusable) wraps to the last,
    // staying inside the modal — it no longer escapes.
    checkedRadio.focus();
    expect(checkedRadio).toHaveFocus();
    await user.tab({ shift: true });
    await vi.waitFor(() => expect(last).toHaveFocus());
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the last focusable wraps back to the checked radio.
    last.focus();
    expect(last).toHaveFocus();
    await user.tab();
    await vi.waitFor(() => expect(checkedRadio).toHaveFocus());
  });
});

describe("tabbableElements (radio-group tab-order helper)", () => {
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const mount = (html: string): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  };
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("includes only the CHECKED radio of a named group, not every member", () => {
    const root = mount(`
      <button type="button">b</button>
      <input type="radio" name="cat" value="a" />
      <input type="radio" name="cat" value="b" checked />
      <input type="radio" name="cat" value="c" />
    `);
    const tabbable = tabbableElements(root, selector);
    const radios = tabbable.filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "radio",
    );
    expect(radios.map((r) => r.value)).toEqual(["b"]);
    // The non-radio button is untouched.
    expect(tabbable.some((el) => el.tagName === "BUTTON")).toBe(true);
  });

  it("falls back to the FIRST radio when none in the group is checked", () => {
    const root = mount(`
      <input type="radio" name="g" value="x" />
      <input type="radio" name="g" value="y" />
    `);
    const radios = tabbableElements(root, selector).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );
    expect(radios.map((r) => r.value)).toEqual(["x"]);
  });

  it("keeps unrelated controls and radios with NO name (each its own control)", () => {
    const root = mount(`
      <input type="radio" value="lone-a" />
      <input type="radio" value="lone-b" />
      <input type="checkbox" />
      <textarea></textarea>
    `);
    const tabbable = tabbableElements(root, selector);
    // Nameless radios are not grouped — both survive — plus checkbox + textarea.
    expect(tabbable.length).toBe(4);
  });
});
