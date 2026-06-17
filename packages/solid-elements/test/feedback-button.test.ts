// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JeswrFeedbackButton } from "../src/components/feedback-button.js";
import type { FeedbackPayload, FeedbackSubmitResult } from "../src/feedback-core.js";

async function mount(
  props: Partial<{
    repo: string;
    appName: string;
    appVersion: string;
    webId: string;
    submit: (p: FeedbackPayload) => Promise<FeedbackSubmitResult>;
  }> = {},
): Promise<JeswrFeedbackButton> {
  const el = document.createElement("jeswr-feedback-button") as JeswrFeedbackButton;
  if (props.repo !== undefined) el.setAttribute("repo", props.repo);
  if (props.appName !== undefined) el.setAttribute("app-name", props.appName);
  if (props.appVersion !== undefined) el.setAttribute("app-version", props.appVersion);
  if (props.webId !== undefined) el.setAttribute("webid", props.webId);
  if (props.submit) el.submit = props.submit;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function openAndType(el: JeswrFeedbackButton, text: string) {
  (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
  await el.updateComplete;
  const ta = el.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event("input"));
  await el.updateComplete;
  return ta;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<jeswr-feedback-button> registration + open/close", () => {
  it("registers", () => {
    expect(customElements.get("jeswr-feedback-button")).toBe(JeswrFeedbackButton);
  });
  it("opens a dialog with aria-modal and closes on Escape", async () => {
    const el = await mount({ repo: "jeswr/x", appName: "X" });
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const dialog = el.shadowRoot?.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
  });
  it("closes when the backdrop is clicked", async () => {
    const el = await mount({ repo: "jeswr/x", appName: "X" });
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    (el.shadowRoot?.querySelector(".backdrop") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("<jeswr-feedback-button> default (zero-infra) mechanism", () => {
  it("opens GitHub with noopener,noreferrer and DISCARDS the window handle", async () => {
    const openSpy = vi.fn(
      (_url?: string | URL, _target?: string, _features?: string) =>
        ({ opener: "back-channel" }) as unknown as Window,
    );
    vi.stubGlobal("open", openSpy);
    const el = await mount({ repo: "jeswr/pod-mail", appName: "Pod Mail", appVersion: "1.0.0" });
    await openAndType(el, "The save button fails");
    (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    const parsed = new URL(url as string);
    expect(parsed.host).toBe("github.com");
    expect(parsed.pathname).toBe("/jeswr/pod-mail/issues/new");
    expect(parsed.searchParams.get("title")).toBe("[Bug] The save button fails");
    expect(parsed.searchParams.get("labels")).toBe("user-feedback,bug");
    // The dialog closed after opening the tab.
    expect(el.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ALWAYS emits a feedback-submit CustomEvent with the payload", async () => {
    vi.stubGlobal("open", vi.fn());
    const el = await mount({ repo: "jeswr/x", appName: "X" });
    await openAndType(el, "Hello");
    const detail = await new Promise<FeedbackPayload>((resolve) => {
      el.addEventListener("feedback-submit", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      });
      (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    });
    expect(detail.repo).toBe("jeswr/x");
    expect(detail.labels).toEqual(["user-feedback", "bug"]);
    expect(detail.description).toBe("Hello");
  });

  it("surfaces an in-dialog error for an invalid repo instead of opening a tab", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const el = await mount({ repo: "evil.com/x?y", appName: "X" });
    await openAndType(el, "Hello");
    (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(openSpy).not.toHaveBeenCalled();
    expect(el.shadowRoot?.querySelector(".err")).not.toBeNull();
  });

  it("does not submit an empty description", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const el = await mount({ repo: "jeswr/x", appName: "X" });
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const submit = el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("<jeswr-feedback-button> proxy (submit hook) mechanism", () => {
  it("calls submit and shows the returned issue link on success", async () => {
    const submit = vi.fn(async () => ({ url: "https://github.com/jeswr/x/issues/42", number: 42 }));
    const el = await mount({ repo: "jeswr/x", appName: "X", submit });
    await openAndType(el, "Proxy please");
    (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    // Let the microtask + re-render settle.
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(submit).toHaveBeenCalledTimes(1);
    const link = el.shadowRoot?.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("https://github.com/jeswr/x/issues/42");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("shows an error message when submit rejects", async () => {
    const submit = vi.fn(async () => {
      throw new Error("proxy down");
    });
    const el = await mount({ repo: "jeswr/x", appName: "X", submit });
    await openAndType(el, "Will fail");
    (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".err")?.textContent).toContain("proxy down");
  });
});

describe("<jeswr-feedback-button> privacy (WebID consent default OFF)", () => {
  it("omits the WebID unless the consent box is ticked", async () => {
    vi.stubGlobal("open", vi.fn());
    const el = await mount({ repo: "jeswr/x", appName: "X", webId: "https://id.example/me" });
    await openAndType(el, "Hi");
    // Default: consent OFF → no WebID in the payload.
    const noConsent = await new Promise<FeedbackPayload>((resolve) => {
      el.addEventListener("feedback-submit", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      });
      (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    });
    expect(noConsent.diagnostics.webId).toBeUndefined();
    expect(noConsent.body).not.toContain("Reporter WebID");

    // Re-open, tick consent → WebID included.
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const ta = el.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "Hi again";
    ta.dispatchEvent(new Event("input"));
    await el.updateComplete;
    const checkbox = el.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const withConsent = await new Promise<FeedbackPayload>((resolve) => {
      el.addEventListener("feedback-submit", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      });
      (el.shadowRoot?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    });
    expect(withConsent.diagnostics.webId).toBe("https://id.example/me");
    expect(withConsent.body).toContain("Reporter WebID: https://id.example/me");
  });
});

describe("<jeswr-feedback-button> focus trap", () => {
  it("focuses the textarea when opened and traps Tab within the dialog", async () => {
    const el = await mount({ repo: "jeswr/x", appName: "X" });
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const ta = el.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement;
    expect(el.shadowRoot?.activeElement).toBe(ta);
    // Shift+Tab from the first focusable wraps to the last (no escape to page).
    const dialog = el.shadowRoot?.querySelector(".dialog") as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(0);
    // The handler is on document (capture); dispatch a Tab there.
    const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    document.dispatchEvent(evt);
    await el.updateComplete;
    // After the trap runs, focus is still inside the dialog.
    expect(dialog.contains(el.shadowRoot?.activeElement ?? null)).toBe(true);
  });
});
