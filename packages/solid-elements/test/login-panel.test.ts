// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-login-panel> tests. The auth machinery is injected via a MOCK
// LoginController, so these exercise the element's UX + the auth seam
// (`.fetch` / `.publicFetch` / `.webId`) + the events, WITHOUT standing up a
// real OP. Because this is auth-adjacent (the seam is the credential-leak
// boundary), the seam tests are adversarial: they assert `.publicFetch` is the
// PRISTINE fetch the controller exposes, distinct from the authenticated one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialsOf, JeswrLoginPanel } from "../src/components/login-panel.js";
import type {
  LoginController,
  RecentLoginAccount,
  RestoreOutcome,
} from "../src/login-controller.js";

/** A fully-controllable mock LoginController for the seam + UX tests. */
class MockController implements LoginController {
  // Two DISTINCT fetch sentinels so a test can prove which one the element relays.
  readonly publicFetch = vi.fn(async () => new Response("public")) as unknown as typeof fetch;
  #authFetch = this.publicFetch; // pre-login: equals publicFetch (nothing to bind)
  #webId: string | null = null;

  // Test knobs:
  restoreOutcome: RestoreOutcome = { outcome: "login" };
  restoreThrows = false;
  loginRejects: Error | null = null;
  // When set, logout() clears local state (logged-out) but THEN throws — mirroring the
  // real controller's partial-failure contract (local teardown ok, durable delete failed).
  logoutRejects: Error | null = null;
  accounts: RecentLoginAccount[] = [];
  // A separate sentinel installed as the authenticated fetch after login.
  readonly sessionFetch = vi.fn(async () => new Response("authed")) as unknown as typeof fetch;

  restoreCalls = 0;
  loginCalls: (string | undefined)[] = [];
  logoutCalls = 0;

  get authenticatedFetch(): typeof fetch {
    return this.#authFetch;
  }
  get webId(): string | null {
    return this.#webId;
  }
  recentAccounts(): RecentLoginAccount[] {
    return this.accounts;
  }
  async restore(): Promise<RestoreOutcome> {
    this.restoreCalls++;
    if (this.restoreThrows) throw new Error("boom"); // element must defend
    if (this.restoreOutcome.outcome === "restored") {
      this.#webId = this.restoreOutcome.webId;
      this.#authFetch = this.sessionFetch;
    }
    return this.restoreOutcome;
  }
  async login(webId?: string): Promise<{ webId: string }> {
    this.loginCalls.push(webId);
    if (this.loginRejects) throw this.loginRejects;
    const id = webId ?? "https://id.example/recent#me";
    this.#webId = id;
    this.#authFetch = this.sessionFetch;
    return { webId: id };
  }
  async logout(): Promise<void> {
    this.logoutCalls++;
    this.#webId = null;
    this.#authFetch = this.publicFetch;
    // Local teardown is done (logged out); a durable-delete failure surfaces as a reject.
    if (this.logoutRejects) throw this.logoutRejects;
  }
}

async function mount(
  controller?: LoginController,
  attrs: Record<string, string> = {},
): Promise<JeswrLoginPanel> {
  const el = document.createElement("jeswr-login-panel") as JeswrLoginPanel;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (controller) el.controller = controller;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function shadow(el: JeswrLoginPanel): ShadowRoot {
  const root = el.shadowRoot;
  if (!root) throw new Error("no shadow root");
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("initialsOf", () => {
  it("derives from a WebID host", () => {
    expect(initialsOf("https://alice.solidcommunity.net/profile/card#me")).toBe("AL");
    expect(initialsOf("https://www.example.org/me")).toBe("EX");
  });
  it("derives from a display name when not a URL", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("madonna")).toBe("MA");
    expect(initialsOf("")).toBe("?");
  });
});

describe("<jeswr-login-panel> registration + inert", () => {
  it("registers under the jeswr- prefix", () => {
    expect(customElements.get("jeswr-login-panel")).toBe(JeswrLoginPanel);
  });

  it("with NO controller renders a 'not configured' notice and asserts no session", async () => {
    const el = await mount();
    expect(shadow(el).querySelector('[part="not-configured"]')).not.toBeNull();
    expect(el.webId).toBeNull();
    // .fetch / .publicFetch are always callable (fall back to the native fetch).
    expect(typeof el.fetch).toBe("function");
    expect(typeof el.publicFetch).toBe("function");
  });

  it("an unwired panel's .publicFetch is NOT a global patched AFTER module load", async () => {
    // The module-load snapshot guards against a controller (or another lib) patching
    // globalThis.fetch before this panel is created exposing a credentialed fetch as
    // the supposedly-pristine fallback.
    const patched = (() => Promise.resolve(new Response("PATCHED"))) as unknown as typeof fetch;
    const orig = globalThis.fetch;
    globalThis.fetch = patched;
    try {
      const el = await mount(); // no controller
      expect(el.publicFetch).not.toBe(patched);
      expect(el.fetch).not.toBe(patched); // the fallback for .fetch too
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("<jeswr-login-panel> login UI", () => {
  it("renders the WebID input + sign-in button when there are no recent accounts", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "login" };
    const el = await mount(c, { "auto-restore": "false" });
    expect(shadow(el).querySelector('[part="webid-input"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("renders recent-account buttons and a 'use a different WebID' affordance", async () => {
    const c = new MockController();
    c.accounts = [
      { webId: "https://ada.example/me", displayName: "Ada" },
      { webId: "https://bob.example/me", displayName: "Bob" },
    ];
    const el = await mount(c, { "auto-restore": "false" });
    const accountButtons = shadow(el).querySelectorAll('[part="account"]');
    expect(accountButtons.length).toBe(2);
    expect(shadow(el).querySelector('[part="add-account"]')).not.toBeNull();
    // The input is hidden until the user opts to use a different WebID.
    expect(shadow(el).querySelector('[part="webid-input"]')).toBeNull();
  });

  it("shows the input prefilled with initial-webid even WHEN recent accounts exist", async () => {
    const c = new MockController();
    c.accounts = [{ webId: "https://ada.example/me", displayName: "Ada" }];
    const el = await mount(c, {
      "auto-restore": "false",
      "initial-webid": "https://carol.example/me",
    });
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull(); // visible despite the recent-account list
    expect(input?.value).toBe("https://carol.example/me");
    // The recent account is still offered alongside.
    expect(shadow(el).querySelectorAll('[part="account"]').length).toBe(1);
  });

  it("updates the input when initial-webid CHANGES after connect (until the user edits)", async () => {
    const c = new MockController();
    const el = await mount(c, {
      "auto-restore": "false",
      "initial-webid": "https://one.example/me",
    });
    expect((shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement).value).toBe(
      "https://one.example/me",
    );
    // Change the property after connect → the input tracks it.
    el.initialWebId = "https://two.example/me";
    await el.updateComplete;
    expect((shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement).value).toBe(
      "https://two.example/me",
    );
    // Once the user types, their edit is preserved against later initial-webid changes.
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://typed.example/me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    el.initialWebId = "https://three.example/me";
    await el.updateComplete;
    expect((shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement).value).toBe(
      "https://typed.example/me",
    );
  });
});

describe("<jeswr-login-panel> the login flow + the auth seam", () => {
  it("drives controller.login, exposes .fetch/.webId, and emits login + session-change", async () => {
    const c = new MockController();
    const el = await mount(c, { "auto-restore": "false" });

    const sessionEvents: Array<{ webId: string | null; loggedIn: boolean }> = [];
    el.addEventListener("session-change", (e) => {
      sessionEvents.push((e as CustomEvent).detail);
    });
    const loginEvents: Array<{ webId: string }> = [];
    el.addEventListener("login", (e) => loginEvents.push((e as CustomEvent).detail));

    // Type a WebID and submit.
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/profile#me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    const form = shadow(el).querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    // Let the async login resolve.
    await c.login; // no-op await to settle
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(c.loginCalls).toEqual(["https://ada.example/profile#me"]);
    expect(el.webId).toBe("https://ada.example/profile#me");
    // .fetch now relays the controller's AUTHENTICATED fetch (the session fetch),
    // NOT the public one.
    expect(el.fetch).toBe(c.sessionFetch);
    expect(el.fetch).not.toBe(c.publicFetch);

    expect(loginEvents).toEqual([{ webId: "https://ada.example/profile#me" }]);
    expect(sessionEvents.at(-1)).toEqual({
      webId: "https://ada.example/profile#me",
      loggedIn: true,
    });
    // The signed-in summary is shown.
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
  });

  it(".publicFetch is the controller's PRISTINE fetch — distinct from the authenticated one after login", async () => {
    const c = new MockController();
    const el = await mount(c, { "auto-restore": "false" });
    // Pre-login: publicFetch === the pristine; authenticatedFetch also pristine.
    expect(el.publicFetch).toBe(c.publicFetch);

    // Log in through the element's public flow (drives the controller).
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/profile#me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // CRITICAL: after login, .publicFetch is STILL the pristine fetch (the
    // foreign-origin boundary), NOT the session fetch. A session token can never
    // leak through .publicFetch.
    expect(el.publicFetch).toBe(c.publicFetch);
    expect(el.publicFetch).not.toBe(c.sessionFetch);
    // ...while .fetch IS the session fetch.
    expect(el.fetch).toBe(c.sessionFetch);
  });

  it("surfaces a non-cancel login error in the prompt and stays logged out", async () => {
    const c = new MockController();
    c.loginRejects = new Error("Unreachable identity provider");
    const el = await mount(c, { "auto-restore": "false" });
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/profile#me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.webId).toBeNull();
    const err = shadow(el).querySelector('[part="error"]');
    expect(err?.textContent).toContain("Unreachable identity provider");
    // Still showing the prompt, not the signed-in summary.
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("a cancelled login (AbortError) returns to the prompt WITHOUT a shouty error", async () => {
    const c = new MockController();
    c.loginRejects = new DOMException("cancelled", "AbortError");
    const el = await mount(c, { "auto-restore": "false" });
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/profile#me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="error"]')).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("a slow EARLIER login does not flip the UI back to the prompt after a LATER login wins", async () => {
    // The panel-level generation fence: two near-simultaneous logins must not let a
    // superseded earlier attempt's completion set _phase back to idle/error after a
    // later attempt already authenticated (the roborev race).
    const c = new MockController();
    let releaseFirst!: (v: { webId: string }) => void;
    let call = 0;
    c.login = (webId?: string) => {
      call++;
      if (call === 1) {
        return new Promise<{ webId: string }>((res) => {
          releaseFirst = res;
        });
      }
      // Second (later) login completes immediately.
      return Promise.resolve({ webId: webId ?? "https://second.example/me" });
    };
    const el = await mount(c, { "auto-restore": "false" });

    // Kick off the first (slow) login.
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://first.example/me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await el.updateComplete;

    // Now a SECOND login (re-submitting the form) supersedes it and completes.
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[part="logout-button"]')).not.toBeNull(); // authenticated

    // Let the FIRST (superseded) login resolve LATE — it must NOT flip back to the
    // prompt; the panel stays authenticated.
    releaseFirst({ webId: "https://first.example/me" });
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).toBeNull();
  });

  it("logout that REJECTS after local teardown → logged-out UI + emits logout, but SURFACES the error (Medium fix)", async () => {
    // The roborev follow-up: the controller now rejects logout() when the DURABLE credential
    // delete fails even though local teardown succeeded (webId is null). The panel must NOT
    // treat that as a fully-clean logout — it transitions to logged-out + emits the events
    // (the session IS gone), but SURFACES the error rather than hiding it.
    const c = new MockController();
    const el = await mount(c, { "auto-restore": "false" });
    // Log in first.
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.webId).toBe("https://ada.example/me");

    // Now logout REJECTS (durable delete failed) but clears local state.
    c.logoutRejects = new Error("store delete failed");
    const logoutEvents: number[] = [];
    const sessionEvents: Array<{ webId: string | null; loggedIn: boolean }> = [];
    el.addEventListener("logout", () => logoutEvents.push(1));
    el.addEventListener("session-change", (e) => sessionEvents.push((e as CustomEvent).detail));
    (shadow(el).querySelector('[part="logout-button"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // The session IS gone (logged-out UI), and the events fired (consumers drop the session).
    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
    expect(logoutEvents.length).toBe(1);
    expect(sessionEvents.at(-1)).toEqual({ webId: null, loggedIn: false });
    // … BUT the durable-delete failure is SURFACED (not hidden as a clean logout).
    const err = shadow(el).querySelector('[part="error"]');
    expect(err?.textContent ?? "").toMatch(/couldn't fully clear stored credentials|store delete/i);
  });
});

describe("<jeswr-login-panel> silent restore on load", () => {
  it("RESTORED → lands logged-in with NO redirect/popup and emits session-change(loggedIn:true)", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "restored", webId: "https://ada.example/me" };
    const sessionEvents: Array<{ webId: string | null; loggedIn: boolean }> = [];
    const el = document.createElement("jeswr-login-panel") as JeswrLoginPanel;
    el.addEventListener("session-change", (e) => sessionEvents.push((e as CustomEvent).detail));
    el.controller = c;
    document.body.appendChild(el);
    await el.updateComplete;
    // The restore promise resolves on the microtask queue.
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(c.restoreCalls).toBe(1);
    expect(c.loginCalls).toEqual([]); // NO interactive login was triggered
    expect(el.webId).toBe("https://ada.example/me");
    expect(el.fetch).toBe(c.sessionFetch);
    expect(sessionEvents.at(-1)).toEqual({ webId: "https://ada.example/me", loggedIn: true });
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
  });

  it("shows the 'Restoring…' state before the decision resolves, never flashing the prompt", async () => {
    const c = new MockController();
    // Make restore hang so we can observe the restoring state.
    let resolveRestore!: (v: RestoreOutcome) => void;
    c.restore = () =>
      new Promise<RestoreOutcome>((res) => {
        resolveRestore = res;
      });
    const el = await mount(c);
    // Mid-restore: the restoring state is shown, not the login prompt.
    expect(shadow(el).querySelector('[part="restoring"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).toBeNull();
    resolveRestore({ outcome: "login" });
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    // Now the prompt.
    expect(shadow(el).querySelector('[part="restoring"]')).toBeNull();
    expect(shadow(el).querySelector('[part="webid-input"]')).not.toBeNull();
  });

  it("restore FAILURE → falls back to the login prompt (fail-closed), no session asserted", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "login" };
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("a THROWN restore is defended (fail-closed) → login prompt, no false session", async () => {
    const c = new MockController();
    c.restoreThrows = true;
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("does NOT attempt restore when auto-restore is off", async () => {
    const c = new MockController();
    const el = await mount(c, { "auto-restore": "false" });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.restoreCalls).toBe(0);
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("if DETACHED mid-restore, a later RE-ATTACH runs a fresh restore (not stuck)", async () => {
    const c = new MockController();
    // First restore hangs; we detach while it is in flight.
    let resolveFirst!: (v: RestoreOutcome) => void;
    c.restore = () => {
      c.restoreCalls++;
      return new Promise<RestoreOutcome>((res) => {
        resolveFirst = res;
      });
    };
    const el = await mount(c);
    expect(shadow(el).querySelector('[part="restoring"]')).not.toBeNull();
    expect(c.restoreCalls).toBe(1);

    // Detach mid-restore — its result is now invalidated.
    el.remove();
    resolveFirst({ outcome: "restored", webId: "https://stale.example/me" });
    await new Promise((r) => setTimeout(r, 0));
    // The stale result must NOT have logged us in on the detached element.
    expect(el.webId).toBeNull();

    // Re-attach: a FRESH restore must run (the single-flight guard was reset).
    c.restore = async () => {
      c.restoreCalls++;
      return { outcome: "login" };
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(c.restoreCalls).toBe(2); // ran again on re-attach
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("if a restore SETTLED before detach, re-attach does NOT re-run it", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "login" };
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(c.restoreCalls).toBe(1);
    // Detach AFTER the restore already settled (we're showing the prompt).
    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    // No second restore — a settled attempt must not re-run on re-attach.
    expect(c.restoreCalls).toBe(1);
  });

  it("reflects an ALREADY-authenticated controller on mount (restore not needed)", async () => {
    const c = new MockController();
    // Simulate the controller having restored before the element mounted.
    await c.login("https://pre.example/me");
    const sessionEvents: Array<{ webId: string | null; loggedIn: boolean }> = [];
    const el = document.createElement("jeswr-login-panel") as JeswrLoginPanel;
    el.addEventListener("session-change", (e) => sessionEvents.push((e as CustomEvent).detail));
    el.controller = c;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(c.restoreCalls).toBe(0);
    expect(el.webId).toBe("https://pre.example/me");
    expect(sessionEvents.at(-1)).toEqual({ webId: "https://pre.example/me", loggedIn: true });
  });

  it("SWAPPING the controller does not inherit the old controller's signed-in UI", async () => {
    // An authenticated controller → the panel shows the signed-in view.
    const first = new MockController();
    first.restoreOutcome = { outcome: "restored", webId: "https://first.example/me" };
    const el = await mount(first);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();

    // Swap in a FRESH controller with NO session: the panel must re-decide and show
    // the login prompt for the new controller, not the stale signed-in view.
    const second = new MockController();
    second.restoreOutcome = { outcome: "login" };
    el.controller = second;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(second.restoreCalls).toBe(1); // the new controller's restore ran
    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="logout-button"]')).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("SWAPPING a logged-in controller for a logged-out one EMITS session-change (logged out) (Low fix)", async () => {
    // The roborev follow-up: a swap that drops the exposed webId to null must notify
    // consumers via `session-change` — else a listener keeps using a stale session / fetch.
    const first = new MockController();
    first.restoreOutcome = { outcome: "restored", webId: "https://first.example/me" };
    const el = await mount(first);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.webId).toBe("https://first.example/me");

    // Start listening AFTER the initial restore so we capture only the swap transition.
    const events: Array<{ webId: string | null; loggedIn: boolean }> = [];
    el.addEventListener("session-change", (e) => events.push((e as CustomEvent).detail));

    // Swap to a logged-out controller.
    const second = new MockController();
    second.restoreOutcome = { outcome: "login" };
    el.controller = second;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // The exposed session dropped to null → a session-change (logged out) was emitted.
    expect(el.webId).toBeNull();
    expect(events.at(-1)).toEqual({ webId: null, loggedIn: false });
  });

  it("SWAPPING for an already-authenticated controller EMITS session-change once with the new session (Low fix)", async () => {
    // Complement: a swap to a controller that is ALREADY signed in must emit the NEW
    // session (not double-emit), so consumers pick up the new identity.
    const first = new MockController();
    first.restoreOutcome = { outcome: "restored", webId: "https://first.example/me" };
    const el = await mount(first);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const events: Array<{ webId: string | null; loggedIn: boolean }> = [];
    el.addEventListener("session-change", (e) => events.push((e as CustomEvent).detail));

    // The new controller is already authenticated (signed in before the swap).
    const second = new MockController();
    await second.login("https://second.example/me");
    el.controller = second;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.webId).toBe("https://second.example/me");
    // Exactly one emit, carrying the NEW session (no logged-out flicker, no double-emit).
    expect(events).toEqual([{ webId: "https://second.example/me", loggedIn: true }]);
  });

  it("detach DURING an interactive login → re-attach reconciles UI to the controller (no stale spinner)", async () => {
    const c = new MockController();
    // The login hangs until released; on release it sets the controller's session
    // (so reconcile on re-attach sees a real session) and resolves.
    let releaseLogin!: () => void;
    const original = c.login.bind(c);
    c.login = (webId?: string) =>
      new Promise<{ webId: string }>((resolve) => {
        releaseLogin = () => {
          original(webId).then(resolve); // sets the mock's #webId + auth fetch
        };
      });
    const el = await mount(c, { "auto-restore": "false" });
    // Start the (hanging) login.
    const input = shadow(el).querySelector('[part="webid-input"]') as HTMLInputElement;
    input.value = "https://ada.example/me";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    (shadow(el).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await el.updateComplete;
    // Mid-login the panel is "authenticating"; detach now.
    el.remove();
    // The login resolves on the (detached) controller → the controller now has a session.
    releaseLogin();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.webId).toBe("https://ada.example/me");
    // Re-attach: the panel must reconcile to the controller's actual session, not stay
    // stuck on the stale "authenticating" state.
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.webId).toBe("https://ada.example/me");
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
  });

  it("detach while logged in then a controller-side logout → re-attach shows the prompt (no stale signed-in UI)", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "restored", webId: "https://ada.example/me" };
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
    // Detach, then the controller loses its session out-of-band (e.g. logout elsewhere).
    el.remove();
    await c.logout();
    // Re-attach: the panel must reconcile to logged-out, not show the stale signed-in UI.
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.webId).toBeNull();
    expect(shadow(el).querySelector('[part="logout-button"]')).toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });
});

describe("<jeswr-login-panel> logout", () => {
  it("clears the session, emits logout + session-change(loggedIn:false), and shows the prompt", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "restored", webId: "https://ada.example/me" };
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.webId).toBe("https://ada.example/me");

    const sessionEvents: Array<{ webId: string | null; loggedIn: boolean }> = [];
    el.addEventListener("session-change", (e) => sessionEvents.push((e as CustomEvent).detail));
    let logoutFired = false;
    el.addEventListener("logout", () => {
      logoutFired = true;
    });

    (shadow(el).querySelector('[part="logout-button"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(c.logoutCalls).toBe(1);
    expect(el.webId).toBeNull();
    // After logout, .fetch is the pristine fetch again (no session bound).
    expect(el.fetch).toBe(c.publicFetch);
    expect(logoutFired).toBe(true);
    expect(sessionEvents.at(-1)).toEqual({ webId: null, loggedIn: false });
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });

  it("a FAILED logout (controller still has a session) keeps the signed-in UI + shows an error", async () => {
    const c = new MockController();
    c.restoreOutcome = { outcome: "restored", webId: "https://ada.example/me" };
    const el = await mount(c);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();

    // Make logout REJECT and leave the session intact (controller.webId stays set).
    c.logout = async () => {
      throw new Error("network down");
    };
    let logoutFired = false;
    el.addEventListener("logout", () => {
      logoutFired = true;
    });
    (shadow(el).querySelector('[part="logout-button"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // Still signed in (controller.webId is still set) — no false logged-out UI/event.
    expect(el.webId).toBe("https://ada.example/me");
    expect(logoutFired).toBe(false);
    expect(shadow(el).querySelector('[part="logout-button"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="error"]')?.textContent).toContain("Could not sign out");
  });
});

describe("<jeswr-login-panel> theming", () => {
  it("exposes the documented ::part hooks on the rendered tree", async () => {
    const c = new MockController();
    const el = await mount(c, { "auto-restore": "false" });
    expect(shadow(el).querySelector('[part="panel"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="webid-input"]')).not.toBeNull();
    expect(shadow(el).querySelector('[part="login-button"]')).not.toBeNull();
  });
});
