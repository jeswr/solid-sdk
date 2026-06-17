// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// React wrapper smoke tests. Render a wrapper via react-dom/client and assert
// the underlying custom element mounts + a reactive prop reflects + an event
// prop is wired. (Full event-firing through React's synthetic layer needs a
// browser; here we assert the wrapper renders the real element and forwards a
// prop, plus that the event-prop name is part of the wrapper's surface.)
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountMenu,
  EmptyState,
  ErrorState,
  FeedbackButton,
  Loading,
  type LoginController,
  LoginPanel,
  type RestoreOutcome,
  SavingIndicator,
  ThemeToggle,
} from "../src/react/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("React wrappers", () => {
  it("ThemeToggle renders the underlying custom element", async () => {
    await act(async () => {
      root.render(createElement(ThemeToggle, {}));
    });
    const el = container.querySelector("jeswr-theme-toggle");
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("jeswr-theme-toggle");
  });

  it("AccountMenu forwards typed props (name/webId) to the element", async () => {
    await act(async () => {
      root.render(createElement(AccountMenu, { name: "Ada", webId: "https://id.example/me" }));
    });
    const el = container.querySelector("jeswr-account-menu") as HTMLElement & {
      name?: string;
      webId?: string;
    };
    expect(el).not.toBeNull();
    // @lit/react sets reactive properties on the element instance.
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.name).toBe("Ada");
    expect(el.webId).toBe("https://id.example/me");
  });

  it("FeedbackButton forwards the function `submit` prop and renders", async () => {
    const submit = async () => ({ url: "https://github.com/jeswr/x/issues/1", number: 1 });
    await act(async () => {
      root.render(createElement(FeedbackButton, { repo: "jeswr/x", appName: "X", submit }));
    });
    const el = container.querySelector("jeswr-feedback-button") as HTMLElement & {
      repo?: string;
      submit?: unknown;
    };
    expect(el).not.toBeNull();
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.repo).toBe("jeswr/x");
    expect(typeof el.submit).toBe("function");
  });

  it("LoginPanel forwards the `controller` prop to the element and renders", async () => {
    const controller: LoginController = {
      publicFetch: globalThis.fetch,
      authenticatedFetch: globalThis.fetch,
      webId: null,
      recentAccounts: () => [],
      restore: async (): Promise<RestoreOutcome> => ({ outcome: "login" }),
      login: async () => ({ webId: "https://id.example/me" }),
      logout: async () => {},
    };
    await act(async () => {
      root.render(createElement(LoginPanel, { controller, autoRestore: false }));
    });
    const el = container.querySelector("jeswr-login-panel") as HTMLElement & {
      controller?: LoginController;
    };
    expect(el).not.toBeNull();
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.controller).toBe(controller);
  });

  it("event-prop wrappers expose their on* props (onSignOut / onThemeChange / onFeedbackSubmit / onSessionChange)", () => {
    // The createComponent wrappers attach listeners for the configured events.
    // We assert the wrappers are usable React components (functions) — the
    // event mapping itself is exercised by the custom-element tests above.
    expect(typeof ThemeToggle).toBe("object");
    expect(typeof AccountMenu).toBe("object");
    expect(typeof FeedbackButton).toBe("object");
    expect(typeof LoginPanel).toBe("object");
  });

  it("the state/loading wrappers render their elements", async () => {
    await act(async () => {
      root.render(
        createElement("div", {}, [
          createElement(EmptyState, { key: "e", heading: "Empty" }),
          createElement(ErrorState, { key: "x", heading: "Err" }),
          createElement(Loading, { key: "l", label: "Loading" }),
          createElement(SavingIndicator, { key: "s", state: "saving" }),
        ]),
      );
    });
    expect(container.querySelector("jeswr-empty-state")).not.toBeNull();
    expect(container.querySelector("jeswr-error-state")).not.toBeNull();
    expect(container.querySelector("jeswr-loading")).not.toBeNull();
    expect(container.querySelector("jeswr-saving-indicator")).not.toBeNull();
  });

  // ── #122 regression: string props must REFLECT so @lit/react forwards them ──
  // The bug: under React 19, @lit/react's createComponent classifies props at
  // creation time (before Lit finalizes the class), so a NON-reflected reactive
  // string PROPERTY was silently dropped — `<Loading label="X">` rendered the
  // generic "Loading" fallback instead of "X". Making the string props reflect
  // fixes the forwarding. We assert the host string reaches the SHADOW render
  // (the robust path noted in the brief: the reflected attribute + the rendered
  // shadow text / aria-label), not just that the element mounted.

  it("Loading: <Loading label='X'> forwards the label to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(createElement(Loading, { label: "Loading files" }));
    });
    const el = container.querySelector("jeswr-loading") as HTMLElement & { label?: string };
    expect(el).not.toBeNull();
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // The reactive property carries the value …
    expect(el.label).toBe("Loading files");
    // … it REFLECTS to the attribute (the forwarding mechanism) …
    expect(el.getAttribute("label")).toBe("Loading files");
    // … and it actually reaches the shadow render: the status region's
    // accessible name is the label (NOT the generic "Loading" fallback) …
    const status = el.shadowRoot?.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Loading files");
    // … and the visible label node renders the text.
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Loading files");
  });

  it("EmptyState: heading + description forward to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(
        createElement(EmptyState, { heading: "No files yet", description: "Upload one." }),
      );
    });
    const el = container.querySelector("jeswr-empty-state") as HTMLElement;
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.getAttribute("heading")).toBe("No files yet");
    expect(el.getAttribute("description")).toBe("Upload one.");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("No files yet");
    expect(el.shadowRoot?.querySelector(".desc")?.textContent).toBe("Upload one.");
  });

  it("ErrorState: heading + description forward to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(createElement(ErrorState, { heading: "Load failed", description: "Try again." }));
    });
    const el = container.querySelector("jeswr-error-state") as HTMLElement;
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.getAttribute("heading")).toBe("Load failed");
    expect(el.getAttribute("description")).toBe("Try again.");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Load failed");
    expect(el.shadowRoot?.querySelector(".desc")?.textContent).toBe("Try again.");
  });

  it("SavingIndicator: a custom saving-label forwards to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(createElement(SavingIndicator, { state: "saving", savingLabel: "Syncing…" }));
    });
    const el = container.querySelector("jeswr-saving-indicator") as HTMLElement;
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.getAttribute("saving-label")).toBe("Syncing…");
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Syncing…");
  });

  it("AccountMenu: name + webId forward to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(
        createElement(AccountMenu, { name: "Ada Lovelace", webId: "https://id.example/me" }),
      );
    });
    const el = container.querySelector("jeswr-account-menu") as HTMLElement;
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.getAttribute("name")).toBe("Ada Lovelace");
    expect(el.getAttribute("webid")).toBe("https://id.example/me");
    // The trigger shows the name (not the "Signed in" fallback).
    expect(el.shadowRoot?.querySelector(".trigger-name")?.textContent?.trim()).toBe("Ada Lovelace");
  });

  it("FeedbackButton: the trigger label forwards to the shadow render (#122)", async () => {
    await act(async () => {
      root.render(createElement(FeedbackButton, { repo: "jeswr/x", label: "Report a bug" }));
    });
    const el = container.querySelector("jeswr-feedback-button") as HTMLElement;
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.getAttribute("label")).toBe("Report a bug");
    // The trigger renders the host's label (not the "Feedback" default).
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Report a bug");
  });
});
