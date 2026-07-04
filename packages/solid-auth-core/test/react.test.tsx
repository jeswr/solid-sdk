// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
//
// Tests for the /react layer (SessionProvider + useSolidSession) — driven with
// an INJECTED fake SolidAuth (the injectable-auth seam), so the whole component
// contract is exercised with no server, no OP, and no real credentials.
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoginResult, RestoreOutcome, SolidAuth } from "../src/index.js";
import { SessionProvider, type SolidSession, useSolidSession } from "../src/react/index.js";

declare global {
  // biome-ignore lint: the React test-environment flag must be a global `var` declaration
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A controllable fake SolidAuth implementing the full seam. */
class FakeAuth implements SolidAuth {
  webId: string | null = null;
  issuer: string | null = null;
  restoreCalls = 0;
  publicFetch: typeof fetch = (async () => new Response("public")) as unknown as typeof fetch;
  /** What the live authenticatedFetch responds with (checked via session.fetch). */
  authedBody = "authed";
  authenticatedFetch: typeof fetch = (async () =>
    new Response(this.authedBody)) as unknown as typeof fetch;
  loginError: Error | null = null;
  logoutError: Error | null = null;
  #listeners = new Set<(s: { webId: string | null }) => void>();
  #restoreResult: Promise<RestoreOutcome>;
  #resolveRestore!: (o: RestoreOutcome) => void;
  constructor() {
    this.#restoreResult = new Promise((res) => {
      this.#resolveRestore = res;
    });
  }
  resolveRestore(outcome: RestoreOutcome): void {
    if (outcome.outcome === "restored") this.webId = outcome.webId;
    this.#resolveRestore(outcome);
  }
  restore(): Promise<RestoreOutcome> {
    this.restoreCalls++;
    return this.#restoreResult; // single-flight like the real engine
  }
  async login(webId?: string): Promise<LoginResult> {
    if (this.loginError) throw this.loginError;
    this.webId = webId ?? "https://alice.example/#me";
    this.#emit();
    return { webId: this.webId };
  }
  async logout(): Promise<void> {
    this.webId = null;
    this.#emit(); // fail-closed local teardown notifies FIRST…
    if (this.logoutError) throw this.logoutError; // …then the durable delete may fail
  }
  recentAccounts(): [] {
    return [];
  }
  onSessionChange(listener: (s: { webId: string | null }) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(): void {
    for (const l of this.#listeners) l({ webId: this.webId });
  }
}

let container: HTMLDivElement;
let root: Root;
let latest: SolidSession | null;

function Probe(): null {
  latest = useSolidSession();
  return null;
}

function mount(auth: SolidAuth, strict = false): void {
  const tree = createElement(SessionProvider, { auth }, createElement(Probe));
  act(() => {
    root.render(strict ? createElement(StrictMode, null, tree) : tree);
  });
}

beforeEach(() => {
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SessionProvider + useSolidSession", () => {
  it("starts in `restoring`, then lands `unauthenticated` when silent restore falls back to login", async () => {
    const auth = new FakeAuth();
    mount(auth);
    expect(latest?.status).toBe("restoring");
    await act(async () => auth.resolveRestore({ outcome: "login" }));
    expect(latest?.status).toBe("unauthenticated");
    expect(latest?.webId).toBeNull();
  });

  it("lands `authenticated` with the WebID when silent restore succeeds (cross-app invariant #1)", async () => {
    const auth = new FakeAuth();
    mount(auth);
    await act(async () =>
      auth.resolveRestore({ outcome: "restored", webId: "https://a.example/#me" }),
    );
    expect(latest?.status).toBe("authenticated");
    expect(latest?.webId).toBe("https://a.example/#me");
  });

  it("login() transitions to authenticated via the core session-change event", async () => {
    const auth = new FakeAuth();
    mount(auth);
    await act(async () => auth.resolveRestore({ outcome: "login" }));
    await act(async () => latest?.login("https://bob.example/#me"));
    expect(latest?.status).toBe("authenticated");
    expect(latest?.webId).toBe("https://bob.example/#me");
    expect(latest?.error).toBeNull();
  });

  it("a login failure surfaces in `error` (and rethrows for the caller)", async () => {
    const auth = new FakeAuth();
    auth.loginError = new Error("OP said no");
    mount(auth);
    await act(async () => auth.resolveRestore({ outcome: "login" }));
    await act(async () => {
      await expect(latest?.login("https://bob.example/#me")).rejects.toThrow("OP said no");
    });
    expect(latest?.status).toBe("unauthenticated");
    expect(latest?.error).toBe("OP said no");
  });

  it("a superseded login (AbortError) is NOT a user-facing error", async () => {
    const auth = new FakeAuth();
    auth.loginError = new DOMException("Login superseded", "AbortError");
    mount(auth);
    await act(async () => auth.resolveRestore({ outcome: "login" }));
    await act(async () => latest?.login());
    expect(latest?.error).toBeNull();
  });

  it("logout() lands unauthenticated even when the durable delete rejects (fail-closed), surfacing the error", async () => {
    const auth = new FakeAuth();
    mount(auth);
    await act(async () =>
      auth.resolveRestore({ outcome: "restored", webId: "https://a.example/#me" }),
    );
    auth.logoutError = new Error("durable delete failed");
    await act(async () => {
      await expect(latest?.logout()).rejects.toThrow("durable delete failed");
    });
    expect(latest?.status).toBe("unauthenticated");
    expect(latest?.webId).toBeNull();
    expect(latest?.error).toBe("durable delete failed");
  });

  it("session.fetch has a STABLE identity across state changes and delegates to the live authenticatedFetch", async () => {
    const auth = new FakeAuth();
    mount(auth);
    const fetchBefore = latest?.fetch;
    await act(async () =>
      auth.resolveRestore({ outcome: "restored", webId: "https://a.example/#me" }),
    );
    expect(latest?.fetch).toBe(fetchBefore);
    const res = await (latest as SolidSession).fetch("https://a.example/x");
    expect(await res.text()).toBe("authed");
  });

  it("a StrictMode double-mount shares ONE restore attempt (the core single-flights)", async () => {
    const auth = new FakeAuth();
    mount(auth, true);
    await act(async () =>
      auth.resolveRestore({ outcome: "restored", webId: "https://a.example/#me" }),
    );
    // StrictMode runs the effect twice; the shared promise means both calls
    // resolve the SAME attempt (FakeAuth mirrors the engine's single-flight).
    expect(auth.restoreCalls).toBeLessThanOrEqual(2);
    expect(latest?.status).toBe("authenticated");
  });

  it("useSolidSession outside a SessionProvider throws a targeted error", () => {
    expect(() => {
      act(() => {
        root.render(createElement(Probe));
      });
    }).toThrow(/must be used inside a <SessionProvider>/);
  });
});
