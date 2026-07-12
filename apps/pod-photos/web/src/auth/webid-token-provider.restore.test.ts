// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Security-critical tests for SILENT SESSION RESTORE at the PROVIDER seam — the thin
// `WebIdDPoPTokenProvider.restoreIssuer` wrapper that DELEGATES the refresh grant to
// `@jeswr/solid-session-restore`'s `restoreSession` and pins the rebuilt session into
// the provider's in-memory state.
//
// What is pinned here (pod-photos delegates the grant; it does NOT re-implement it):
//   • restoreIssuer DELEGATES to the package's restoreSession with the provider's
//     clientId + allowInsecureLoopback + the auth controller's signal;
//   • on success it PINS the session — resolvedIssuer + authenticatedWebId are set,
//     and a subsequent `upgrade()` reuses the restored DPoP key + access token with
//     NO further interaction (no popup/iframe);
//   • on undefined (nothing to restore / dead / transient) it returns undefined and
//     pins nothing;
//   • the GENERATION FENCE: a reset() racing the grant discards the rebuilt session;
//   • forgetPersisted (logout) / hasPersisted (tri-state) delegate to the package;
//   • INVALID_GRANT CLEARS vs TRANSIENT PRESERVES: the package clears a definitively
//     dead credential (so hasPersisted → "absent" ⇒ DROP the pointer) and preserves a
//     transient one (hasPersisted → "present" ⇒ KEEP). The real `isInvalidGrantError`
//     classifier (the dead-vs-transient boundary) is exercised directly.
//
// The package's restoreSession is mocked so the provider seam is fully controllable
// with no browser + no network; the mock FAITHFULLY emulates the package contract
// (re-persist the rotated token on success; clear on invalid_grant; preserve on
// transient — exactly what the package source does).

import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { isInvalidGrantError } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));
vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => ["https://issuer.example/"],
}));
vi.mock("dpop", () => ({
  generateProof: vi.fn(async () => "dpop-proof"),
}));

// The package's restoreSession / forgetPersisted / hasPersisted are mocked. The mock
// faithfully mirrors the package's STORE side-effects so the keep/drop assertions are
// driven by the SAME contract the real package honours (re-persist on success; clear
// on invalid_grant; preserve on transient).
const restoreState = vi.hoisted(() => ({
  // What the next restoreSession resolves to (a RestoredSession) or undefined.
  result: null as Record<string, unknown> | null,
  // When set, restoreSession behaves as a DEFINITIVE invalid_grant: it clears the
  // persisted entry (mirroring the package) and returns undefined.
  invalidGrant: false,
  // The options restoreSession was called with (asserts delegation).
  lastOptions: null as Record<string, unknown> | null,
}));

vi.mock("@jeswr/solid-session-restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/solid-session-restore")>();
  return {
    ...actual,
    // Faithful emulation of the package's restoreSession store side-effects.
    restoreSession: vi.fn(async (options: { store: SessionStore; issuer: URL }) => {
      restoreState.lastOptions = options as unknown as Record<string, unknown>;
      const stored = await options.store.get(options.issuer.href);
      if (!stored || stored.refreshToken === undefined) return undefined;
      if (restoreState.invalidGrant) {
        // Definitive invalid_grant: the package CLEARS the dead entry, returns undefined.
        await options.store.delete(options.issuer.href);
        return undefined;
      }
      if (restoreState.result === null) {
        // Transient failure: the package PRESERVES the entry, returns undefined.
        return undefined;
      }
      // Success: re-persist the rotated token (the package does this) and return.
      const rotated = restoreState.result;
      await options.store.put({
        issuer: options.issuer.href,
        webId: rotated.webId as string,
        refreshToken: rotated.refreshToken as string,
        dpopKey: stored.dpopKey,
      });
      return rotated;
    }),
    forgetPersisted: vi.fn(async (store: SessionStore, issuer: URL) => {
      await store.delete(issuer.href);
    }),
    hasPersisted: vi.fn(async (store: SessionStore, issuer: URL) => {
      return (await store.get(issuer.href)) !== undefined ? "present" : "absent";
    }),
  };
});

import { shouldDropRememberedPointer } from "@jeswr/solid-session-restore";
import { WebIdDPoPTokenProvider } from "./webid-token-provider";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const ISSUER = "https://issuer.example/";

/** An in-memory SessionStore double, recording put/delete so isolation is testable. */
function makeStore(seed?: PersistedSession): SessionStore & { map: Map<string, PersistedSession> } {
  const map = new Map<string, PersistedSession>();
  if (seed) map.set(seed.issuer, seed);
  return {
    map,
    async get(issuer) {
      return map.get(issuer);
    },
    async put(session) {
      map.set(session.issuer, session);
    },
    async delete(issuer) {
      map.delete(issuer);
    },
  };
}

/** A persisted credential for ALICE under ISSUER, with a real non-extractable key. */
async function aliceCredential(): Promise<PersistedSession> {
  const dpopKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  return {
    issuer: ISSUER,
    webId: ALICE,
    refreshToken: "rt-alice",
    dpopKey,
    clientId: "https://app.example/clientid.jsonld",
  };
}

function makeProvider(store: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "ignored", // getCode — never reached on the restore path.
    async () => ALICE, // getWebId
    {
      clientId: "https://app.example/clientid.jsonld",
      sessionStore: store,
    },
  );
}

beforeEach(() => {
  restoreState.result = null;
  restoreState.invalidGrant = false;
  restoreState.lastOptions = null;
  vi.clearAllMocks();
});

describe("restoreIssuer — delegation + pinning", () => {
  it("delegates to restoreSession with the provider's clientId + signal, and pins the session", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.result = {
      webId: ALICE,
      accessToken: "at-alice",
      refreshToken: "rt-alice-2",
      dpopKey: store.map.get(ISSUER)?.dpopKey,
      expiresAt: undefined,
      issuer: ISSUER,
    };

    const restored = await provider.restoreIssuer(new URL(ISSUER));

    expect(restored).toEqual({ webId: ALICE });
    // Delegation: restoreSession got the right store/issuer/clientId.
    expect(restoreState.lastOptions?.clientId).toBe("https://app.example/clientid.jsonld");
    expect((restoreState.lastOptions?.issuer as URL).href).toBe(ISSUER);
    expect(restoreState.lastOptions?.signal).toBeInstanceOf(AbortSignal);
    // Pinned: the provider now reports the restored identity + issuer.
    expect(provider.authenticatedWebId()).toBe(ALICE);
    expect(provider.resolvedIssuer()).toBe(ISSUER);
  });

  it("a subsequent upgrade() REUSES the pinned restored session (no re-prompt)", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.result = {
      webId: ALICE,
      accessToken: "at-alice",
      refreshToken: "rt-alice-2",
      dpopKey: store.map.get(ISSUER)?.dpopKey,
      expiresAt: undefined,
      issuer: ISSUER,
    };
    await provider.restoreIssuer(new URL(ISSUER));

    // upgrade() must reuse the pinned session: it attaches the RESTORED access token
    // with a DPoP proof, never calling getCode (which would throw "ignored" path).
    const upgraded = await provider.upgrade(new Request("https://alice.example/private"));
    expect(upgraded.headers.get("Authorization")).toBe("DPoP at-alice");
    expect(upgraded.headers.get("DPoP")).toBe("dpop-proof");
  });

  it("returns undefined and pins nothing when restoreSession returns undefined", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.result = null; // transient → undefined, entry preserved.

    const restored = await provider.restoreIssuer(new URL(ISSUER));

    expect(restored).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.resolvedIssuer()).toBeUndefined();
  });

  it("is a no-op (undefined) without a session store", async () => {
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => "ignored",
      async () => ALICE,
      { clientId: "https://app.example/clientid.jsonld" }, // no sessionStore
    );
    expect(await provider.restoreIssuer(new URL(ISSUER))).toBeUndefined();
  });

  it("GENERATION FENCE: a reset() racing the grant discards the rebuilt session", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.result = {
      webId: ALICE,
      accessToken: "at-alice",
      refreshToken: "rt-alice-2",
      dpopKey: store.map.get(ISSUER)?.dpopKey,
      expiresAt: undefined,
      issuer: ISSUER,
    };
    // Start the restore, then reset() BEFORE it settles (the grant is async).
    const p = provider.restoreIssuer(new URL(ISSUER));
    provider.reset();
    const restored = await p;
    // The rebuilt session belongs to a superseded generation → discarded.
    expect(restored).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.resolvedIssuer()).toBeUndefined();
  });
});

describe("restoreIssuer — WebID isolation (account A never restores account B)", () => {
  it("restoreIssuer for B's issuer cannot see A's credential under A's issuer", async () => {
    // A's credential lives under A's issuer key; restoring a DIFFERENT issuer finds
    // nothing (the store is keyed by issuer). This is the per-issuer isolation the
    // decision layer relies on.
    const store = makeStore(await aliceCredential()); // only ALICE @ ISSUER
    const provider = makeProvider(store);
    restoreState.result = {
      webId: BOB,
      accessToken: "at-bob",
      refreshToken: "rt-bob",
      dpopKey: undefined,
      expiresAt: undefined,
      issuer: "https://other-issuer.example/",
    };
    const restored = await provider.restoreIssuer(new URL("https://other-issuer.example/"));
    // No credential under B's issuer → undefined; A's stays untouched.
    expect(restored).toBeUndefined();
    expect(store.map.has(ISSUER)).toBe(true);
  });
});

describe("invalid_grant CLEARS vs transient PRESERVES (keep/drop the pointer)", () => {
  it("invalid_grant → restoreIssuer undefined AND the credential is CLEARED → hasPersisted absent → DROP", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.invalidGrant = true; // definitive dead token.

    const restored = await provider.restoreIssuer(new URL(ISSUER));

    expect(restored).toBeUndefined();
    // The package cleared the dead entry: hasPersisted is now "absent".
    expect(await provider.hasPersisted(new URL(ISSUER))).toBe("absent");
    expect(store.map.has(ISSUER)).toBe(false);
    // absent ⇒ the caller DROPS the remembered pointer.
    expect(shouldDropRememberedPointer("restore-failed", "absent")).toBe(true);
  });

  it("transient failure → restoreIssuer undefined but the credential is PRESERVED → hasPersisted present → KEEP", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    restoreState.result = null; // transient → undefined, NO clear.
    restoreState.invalidGrant = false;

    const restored = await provider.restoreIssuer(new URL(ISSUER));

    expect(restored).toBeUndefined();
    // The credential SURVIVED the transient blip: hasPersisted is "present".
    expect(await provider.hasPersisted(new URL(ISSUER))).toBe("present");
    expect(store.map.has(ISSUER)).toBe(true);
    // present ⇒ the caller KEEPS the pointer to retry on the next load.
    expect(shouldDropRememberedPointer("restore-failed", "present")).toBe(false);
  });

  it("forgetPersisted (logout) drops the durable credential → hasPersisted absent", async () => {
    const store = makeStore(await aliceCredential());
    const provider = makeProvider(store);
    expect(await provider.hasPersisted(new URL(ISSUER))).toBe("present");
    await provider.forgetPersisted(new URL(ISSUER));
    expect(await provider.hasPersisted(new URL(ISSUER))).toBe("absent");
  });

  it("the REAL isInvalidGrantError classifier draws the dead-vs-transient boundary", async () => {
    // The package's classifier is what makes the clear-vs-preserve split correct;
    // exercise it directly so the boundary is pinned by the real code, not the mock.
    expect(isInvalidGrantError({ error: "invalid_grant" })).toBe(true);
    expect(
      isInvalidGrantError({ cause: { parameters: new URLSearchParams("error=invalid_grant") } }),
    ).toBe(true);
    // Transient / unrelated failures are NOT invalid_grant (credential preserved).
    expect(isInvalidGrantError(new TypeError("network error"))).toBe(false);
    expect(isInvalidGrantError({ error: "temporarily_unavailable" })).toBe(false);
    expect(isInvalidGrantError(undefined)).toBe(false);
  });
});
