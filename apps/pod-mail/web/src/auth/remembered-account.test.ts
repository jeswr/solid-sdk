// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the remembered-account pointer (WebID + issuer in localStorage) that
// selects WHICH issuer silent restore runs against on load. Pins: round-trip
// write→read; overwrite (new identity supersedes); clear (logout/account change);
// corrupt-JSON / missing-webId → treated as absent; storage errors swallowed; and
// the load-bearing security property — the pointer holds NO credential (no token).
//
// This vitest env's jsdom does not expose a functional `localStorage` (it is a bare
// object with no Storage methods), so each test installs a faithful in-memory
// Storage double on globalThis — exactly as the provider suite installs a
// sessionStorage double for the redirect-flow tests.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRememberedAccount,
  REMEMBERED_ACCOUNT_KEY,
  readRememberedAccount,
  writeRememberedAccount,
} from "./remembered-account";

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";
const ISSUER_A = "https://issuer-a.example/";
const ISSUER_B = "https://issuer-b.example/";

/** A minimal in-memory localStorage double, optionally throwing on a chosen op. */
function installLocalStorage(throwOn?: "getItem" | "setItem" | "removeItem"): Map<string, string> {
  const store = new Map<string, string>();
  const guard = (op: "getItem" | "setItem" | "removeItem") => {
    if (throwOn === op) throw new Error(`${op} blocked`);
  };
  const stub: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (k) => {
      guard("getItem");
      return store.get(k) ?? null;
    },
    setItem: (k, v) => {
      guard("setItem");
      store.set(k, String(v));
    },
    removeItem: (k) => {
      guard("removeItem");
      store.delete(k);
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = stub;
  return store;
}

describe("remembered-account — durable WebID→issuer pointer for silent restore", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("round-trips a written account (WebID + issuer)", () => {
    writeRememberedAccount(WEBID_A, ISSUER_A);
    expect(readRememberedAccount()).toEqual({ webId: WEBID_A, issuer: ISSUER_A });
  });

  it("returns null when nothing is remembered", () => {
    expect(readRememberedAccount()).toBeNull();
  });

  it("OVERWRITES on a new identity (a re-login as B supersedes A's pointer)", () => {
    writeRememberedAccount(WEBID_A, ISSUER_A);
    writeRememberedAccount(WEBID_B, ISSUER_B);
    expect(readRememberedAccount()).toEqual({ webId: WEBID_B, issuer: ISSUER_B });
  });

  it("clears the pointer (logout / account change)", () => {
    writeRememberedAccount(WEBID_A, ISSUER_A);
    clearRememberedAccount();
    expect(readRememberedAccount()).toBeNull();
  });

  it("treats corrupt JSON as absent (no throw)", () => {
    store.set(REMEMBERED_ACCOUNT_KEY, "{not json");
    expect(readRememberedAccount()).toBeNull();
  });

  it("treats a record with no webId as absent (silent restore keys off the WebID)", () => {
    store.set(REMEMBERED_ACCOUNT_KEY, JSON.stringify({ issuer: ISSUER_A }));
    expect(readRememberedAccount()).toBeNull();
  });

  it("reads a record with a webId but NO issuer (→ silent restore then falls through to login)", () => {
    store.set(REMEMBERED_ACCOUNT_KEY, JSON.stringify({ webId: WEBID_A }));
    expect(readRememberedAccount()).toEqual({ webId: WEBID_A, issuer: undefined });
  });

  it("SECURITY: the persisted pointer holds NO credential — no token field of any kind", () => {
    writeRememberedAccount(WEBID_A, ISSUER_A);
    const raw = store.get(REMEMBERED_ACCOUNT_KEY) ?? "";
    expect(raw).not.toMatch(/token/i);
    expect(raw).not.toMatch(/refresh/i);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["issuer", "webId"]);
  });
});

describe("remembered-account — degrades safely when localStorage throws / is absent", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("swallows a throwing setItem (quota / private mode) — never a failed login", () => {
    installLocalStorage("setItem");
    expect(() => writeRememberedAccount(WEBID_A, ISSUER_A)).not.toThrow();
  });

  it("swallows a throwing getItem — returns null", () => {
    installLocalStorage("getItem");
    expect(readRememberedAccount()).toBeNull();
  });

  it("swallows a throwing removeItem — idempotent clear", () => {
    installLocalStorage("removeItem");
    expect(() => clearRememberedAccount()).not.toThrow();
  });

  it("returns null + no-ops when localStorage is entirely absent (SSR)", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readRememberedAccount()).toBeNull();
    expect(() => writeRememberedAccount(WEBID_A, ISSUER_A)).not.toThrow();
    expect(() => clearRememberedAccount()).not.toThrow();
  });
});
