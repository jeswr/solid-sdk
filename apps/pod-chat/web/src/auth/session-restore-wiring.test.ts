// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial, security-critical tests for the SILENT SESSION RESTORE wiring
// (cross-app UX invariant #1) added to pod-chat's auth seam. The durable + decision
// machinery is the audited @jeswr/solid-session-restore package; these tests pin
// THIS APP'S thin wiring of it — the three behaviours the task calls out:
//
//   1. RESTORE-ON-MOUNT: runSilentRestore → decideSilentRestore → the provider's
//      restoreIssuer yields `restored`, returns the restored WebID + session, and
//      re-confirms the remembered pointer (so App sets webId and does NOT flash the
//      login form).
//   2. FAIL-CLOSED WEBID-MISMATCH: a restored WebID that ≠ the remembered (last-active)
//      WebID tears down in the EXACT README order — reset() FIRST, THEN forgetIssuer,
//      THEN clear the pointer — and falls to login. This test GENUINELY FAILS without
//      the webIdsEqual guard (the adversarial proof: with the guard disabled the wrong
//      WebID would be ASSERTED as restored), then with the real guard it is torn down.
//   3. invalid_grant CLEARS vs transient PRESERVES: driven through the REAL package
//      `restoreSession` (the exact code pod-chat's restoreIssuer delegates to) with a
//      STUBBED fetch — a 400 `{error:"invalid_grant"}` clears the persisted credential
//      (a doomed restore is not retried); a transient network throw / 503 PRESERVES it
//      (a blip must not force a needless re-login).
//
// Scenarios 1 + 2 use a FAKE provider (so the security branch table + teardown are
// exercised with no OAuth stack at all) over the REAL package decision + pointer.
// Scenario 3 uses the REAL package restoreSession over a stubbed fetch + an in-memory
// store, so it pins the package contract pod-chat relies on without a fragile oauth
// mock. No browser, no network.
import {
  decideSilentRestore,
  type PersistedSession,
  restoreSession,
  type SessionStore,
  webIdsEqual as ssrWebIdsEqual,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";
const ISSUER = "https://issuer.example/";

// pod-chat's localStorage pointer key — the EXACT app-specific string the
// SessionProvider's RememberedAccount uses. A test that read a different key would
// silently never see the seeded pointer; pinning it here keeps the wiring honest.
const REMEMBERED_KEY = "pod-chat:remembered-account";

/** A trivial in-memory SessionStore double (the package's injectable contract). */
function inMemoryStore(seed?: PersistedSession): SessionStore & {
  map: Map<string, PersistedSession>;
} {
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

/** A real, NON-extractable ES256 DPoP key pair — what a persisted record holds. */
async function es256Key(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

/**
 * An in-memory localStorage shim so the module-level RememberedAccount that
 * runSilentRestore reads returns a record we control. Installed on globalThis (the
 * suite default env is `node`, which has no localStorage).
 */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  return store;
}

beforeEach(() => {
  installLocalStorage();
});

// Import the app wiring AFTER globalThis.localStorage exists (the SessionProvider
// module constructs a module-level RememberedAccount; that construction is inert, but
// the import is kept here for symmetry with the OAuth-mocked suites).
const { runSilentRestore, autologinTakesPrecedence } = await import("./SessionProvider");
type Provider = import("./webid-token-provider").WebIdDPoPTokenProvider;

/** A fake provider exposing ONLY the surface runSilentRestore drives. */
function fakeProvider(opts: {
  restoreResult: { webId: string } | undefined;
  presence?: "present" | "absent" | "unknown";
}) {
  return {
    reset: vi.fn(),
    forgetIssuer: vi.fn(async () => {}),
    hasPersistedFor: vi.fn(async () => opts.presence ?? "present"),
    restoreIssuer: vi.fn(async () => opts.restoreResult),
  };
}

function remember(ls: Map<string, string>, webId: string, issuer: string) {
  ls.set(REMEMBERED_KEY, JSON.stringify({ webId, issuer }));
}

describe("runSilentRestore — restore on mount (scenario 1)", () => {
  it("RESTORED — a matching restored WebID yields a restored result + re-confirms the pointer (no login flash)", async () => {
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    const provider = fakeProvider({ restoreResult: { webId: WEBID_A } });

    const result = await runSilentRestore(provider as unknown as Provider);

    // The mount effect sets webId from this `restored` outcome → App renders the app,
    // never the login form.
    expect(result).toEqual({ kind: "restored", webId: WEBID_A, session: expect.anything() });
    // The remembered pointer is re-confirmed (still WEBID_A), and NOTHING was torn down.
    expect(JSON.parse(ls.get(REMEMBERED_KEY) as string).webId).toBe(WEBID_A);
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetIssuer).not.toHaveBeenCalled();
    // The restore ran exactly the remembered issuer's grant.
    expect(provider.restoreIssuer).toHaveBeenCalledWith(new URL(ISSUER));
  });

  it("NO REMEMBERED ACCOUNT — login, no restore attempted, no teardown (a fresh user is not blocked)", async () => {
    installLocalStorage(); // empty — no pointer.
    const provider = fakeProvider({ restoreResult: undefined });
    const result = await runSilentRestore(provider as unknown as Provider);
    expect(result).toEqual({ kind: "login" });
    expect(provider.restoreIssuer).not.toHaveBeenCalled();
    expect(provider.reset).not.toHaveBeenCalled();
  });
});

describe("runSilentRestore — fail-closed WebID mismatch (scenario 2)", () => {
  it("WEBID-MISMATCH — tears down FAIL-CLOSED: reset() BEFORE forgetIssuer, pointer cleared, NO session asserted", async () => {
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    // The grant SUCCEEDED but authenticated a DIFFERENT WebID (B) than remembered (A).
    const provider = fakeProvider({ restoreResult: { webId: WEBID_B } });

    const order: string[] = [];
    provider.reset.mockImplementation(() => {
      order.push("reset");
    });
    provider.forgetIssuer.mockImplementation(async () => {
      order.push("forget");
    });

    const result = await runSilentRestore(provider as unknown as Provider);

    // The session is NOT asserted for the wrong identity — fall to login.
    expect(result).toEqual({ kind: "login" });
    expect(provider.reset).toHaveBeenCalledTimes(1);
    expect(provider.forgetIssuer).toHaveBeenCalledWith(new URL(ISSUER));
    // ORDER MATTERS (README, load-bearing): drop the in-memory session FIRST, then the
    // durable credential, then the pointer — because restoreIssuer already pinned +
    // re-persisted the WRONG WebID one layer down.
    expect(order).toEqual(["reset", "forget"]);
    // The known-bad pointer is dropped so it does not re-fail the isolation check.
    expect(ls.get(REMEMBERED_KEY)).toBeUndefined();
  });

  it("ADVERSARIAL — WITHOUT the webIdsEqual guard a mismatched restore would be ASSERTED (proves the guard is load-bearing)", async () => {
    // Re-run the REAL package decider both WITH the guard (the app's webIdsEqual) and
    // with it DISABLED (equality forced true). The disabled variant asserts the WRONG
    // WebID — the exact cross-identity assertion the fail-closed guard prevents. This
    // makes the guard genuinely load-bearing: remove it and a mismatch is "restored".
    const inputs = {
      lastActiveWebId: WEBID_A,
      remembered: [{ webId: WEBID_A, issuer: ISSUER }],
      restoreIssuer: async () => ({ webId: WEBID_B }) as { webId: string },
    };
    const guarded = await decideSilentRestore({ ...inputs, webIdsEqual: ssrWebIdsEqual });
    const unguarded = await decideSilentRestore({ ...inputs, webIdsEqual: () => true });

    // WITH the guard: the mismatch is CAUGHT → login (webid-mismatch).
    expect(guarded).toEqual({ outcome: "login", reason: "webid-mismatch" });
    // WITHOUT the guard: the WRONG WebID (B) would be ASSERTED as restored.
    expect(unguarded).toEqual({ outcome: "restored", webId: WEBID_B, issuer: ISSUER });

    // And runSilentRestore (which uses the REAL guard, the app's webIdsEqual) does NOT
    // assert B — it tears down and falls to login.
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    const provider = fakeProvider({ restoreResult: { webId: WEBID_B } });
    const result = await runSilentRestore(provider as unknown as Provider);
    expect(result).toEqual({ kind: "login" });
    expect(provider.reset).toHaveBeenCalledTimes(1);
    expect(provider.forgetIssuer).toHaveBeenCalledWith(new URL(ISSUER));
    expect(ls.get(REMEMBERED_KEY)).toBeUndefined();
  });
});

describe("runSilentRestore — keep/drop the pointer on a non-mismatch login fall-back", () => {
  it("RESTORE-FAILED + credential PRESENT — KEEP the pointer (a transient blip → retry next load)", async () => {
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    const provider = fakeProvider({ restoreResult: undefined, presence: "present" });
    const result = await runSilentRestore(provider as unknown as Provider);
    expect(result).toEqual({ kind: "login" });
    // The credential survived → the pointer is KEPT for a later retry, NOT torn down.
    expect(ls.get(REMEMBERED_KEY)).toBeDefined();
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetIssuer).not.toHaveBeenCalled();
  });

  it("RESTORE-FAILED + credential ABSENT — DROP the pointer (a definitive invalid_grant cleared it)", async () => {
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    const provider = fakeProvider({ restoreResult: undefined, presence: "absent" });
    const result = await runSilentRestore(provider as unknown as Provider);
    expect(result).toEqual({ kind: "login" });
    // The dead credential was cleared by restore → the pointer is dropped too.
    expect(ls.get(REMEMBERED_KEY)).toBeUndefined();
  });

  it("RESTORE-FAILED + credential UNKNOWN (store-read error) — KEEP the pointer (bias to keep under uncertainty)", async () => {
    const ls = installLocalStorage();
    remember(ls, WEBID_A, ISSUER);
    const provider = fakeProvider({ restoreResult: undefined, presence: "unknown" });
    const result = await runSilentRestore(provider as unknown as Provider);
    expect(result).toEqual({ kind: "login" });
    // An unreadable store cannot prove the credential gone — KEEP the pointer rather
    // than orphan a possibly-valid credential.
    expect(ls.get(REMEMBERED_KEY)).toBeDefined();
  });
});

describe("restoreSession (real package) — invalid_grant CLEARS, transient PRESERVES (scenario 3)", () => {
  const issuer = new URL(ISSUER);

  /**
   * A stubbed fetch driving the package's restoreSession: discovery returns AS
   * metadata; the token endpoint behaves per `kind` (a definitive invalid_grant 400, a
   * transient network throw, or a transient 5xx). This exercises the REAL package code
   * pod-chat's restoreIssuer delegates to — no oauth mock.
   */
  function fetchStub(kind: "invalid_grant" | "transient" | "server-5xx"): typeof fetch {
    return (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes(".well-known/openid-configuration")) {
        return new Response(JSON.stringify({ issuer: ISSUER, token_endpoint: `${ISSUER}token` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/token")) {
        if (kind === "transient") throw new TypeError("network down");
        if (kind === "server-5xx") return new Response("upstream error", { status: 503 });
        // invalid_grant → a definitive dead-token OAuth error.
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  }

  async function seededStore() {
    return inMemoryStore({
      issuer: ISSUER,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey: await es256Key(),
      clientId: "https://app.example/clientid.jsonld",
    });
  }

  it("a definitive invalid_grant CLEARS the persisted credential (a doomed restore is not retried)", async () => {
    const store = await seededStore();
    const result = await restoreSession({
      store,
      issuer,
      clientId: "https://app.example/clientid.jsonld",
      fetch: fetchStub("invalid_grant"),
    });
    expect(result).toBeUndefined();
    // The dead token is GONE — a later load won't re-attempt a doomed grant.
    expect(store.map.has(ISSUER)).toBe(false);
    expect(await store.get(ISSUER)).toBeUndefined();
  });

  it("a TRANSIENT network failure PRESERVES the credential (a blip must not force re-login)", async () => {
    const store = await seededStore();
    const result = await restoreSession({
      store,
      issuer,
      clientId: "https://app.example/clientid.jsonld",
      fetch: fetchStub("transient"),
    });
    expect(result).toBeUndefined();
    // The credential is intact — the next reload retries.
    expect(store.map.has(ISSUER)).toBe(true);
    expect((await store.get(ISSUER))?.refreshToken).toBe("rt-A");
  });

  it("a TRANSIENT 5xx PRESERVES the credential (a server blip must not force re-login)", async () => {
    const store = await seededStore();
    const result = await restoreSession({
      store,
      issuer,
      clientId: "https://app.example/clientid.jsonld",
      fetch: fetchStub("server-5xx"),
    });
    expect(result).toBeUndefined();
    expect(store.map.has(ISSUER)).toBe(true);
    expect((await store.get(ISSUER))?.refreshToken).toBe("rt-A");
  });
});

describe("autologinTakesPrecedence — silent restore DEFERS to an explicit flow", () => {
  it("defers to an #autologin deep-link", () => {
    expect(autologinTakesPrecedence(`#autologin/${encodeURIComponent(WEBID_A)}`, "", false)).toBe(
      true,
    );
  });

  it("defers to an OAuth ?code&state redirect return", () => {
    expect(autologinTakesPrecedence("", "?code=abc&state=xyz", false)).toBe(true);
  });

  it("defers to an OAuth ?error&state redirect return", () => {
    expect(autologinTakesPrecedence("", "?error=login_required&state=xyz", false)).toBe(true);
  });

  it("defers to a persisted pending redirect record", () => {
    expect(autologinTakesPrecedence("", "", true)).toBe(true);
  });

  it("does NOT defer on a plain load (no fragment / no params / no pending) — silent restore runs", () => {
    expect(autologinTakesPrecedence("", "", false)).toBe(false);
  });
});
