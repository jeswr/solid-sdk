// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @vitest-environment node
//
// invalid_grant CLEARS vs TRANSIENT PRESERVES — proven through the package's REAL
// `restoreSession` with a stubbed fetch (no SessionProvider/React import here, so this
// runs in the `node` environment: oauth4webapi + WebCrypto behave like the browser
// without jsdom's Response/fetch shims intercepting the token-endpoint round-trip).
//
//  • a definitive 400 `invalid_grant` at the token endpoint → the durable entry is
//    CLEARED (a dead refresh token must not be retried on the next load);
//  • a TRANSIENT failure (503 / network throw) → the entry is PRESERVED (a blip on load
//    must not force a needless re-login).
//
// This is the package-owned half of test 3 (the clear-vs-preserve lives in
// restoreSession); the app-owned keep/drop-pointer half is in session-restore.test.ts.
import {
  type PersistedSession,
  restoreSession,
  type SessionStore,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it } from "vitest";

const ISSUER = "https://issuer.example/";
const WEBID_A = "https://alice.example/profile/card#me";
const CLIENT_ID = "https://app.example/clientid.jsonld";

class MemorySessionStore implements SessionStore {
  readonly map = new Map<string, PersistedSession>();
  async get(issuer: string) {
    return this.map.get(issuer);
  }
  async put(s: PersistedSession) {
    this.map.set(s.issuer, s);
  }
  async delete(issuer: string) {
    this.map.delete(issuer);
  }
}

/** discovery OK, then token-endpoint responds per `tokenResponder`. */
function makeFetchStub(tokenResponder: () => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/.well-known/openid-configuration")) {
      return new Response(
        JSON.stringify({
          issuer: ISSUER,
          token_endpoint: `${ISSUER}token`,
          authorization_endpoint: `${ISSUER}auth`,
          response_types_supported: ["code"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return tokenResponder(); // the refresh grant.
  }) as unknown as typeof fetch;
}

describe("restoreSession (real package) — invalid_grant clears, transient preserves", () => {
  let store: MemorySessionStore;

  beforeEach(async () => {
    store = new MemorySessionStore();
    await store.put({
      issuer: ISSUER,
      webId: WEBID_A,
      refreshToken: "rt-seed",
      dpopKey: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ]),
      clientId: CLIENT_ID,
    });
  });

  it("CLEARS the persisted entry on a definitive 400 invalid_grant", async () => {
    const restored = await restoreSession({
      store,
      issuer: new URL(ISSUER),
      clientId: CLIENT_ID,
      fetch: makeFetchStub(
        () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    expect(restored).toBeUndefined();
    expect(await store.get(ISSUER)).toBeUndefined(); // dead → cleared, no doomed retry.
  });

  it("PRESERVES the persisted entry on a TRANSIENT 503 server error", async () => {
    const restored = await restoreSession({
      store,
      issuer: new URL(ISSUER),
      clientId: CLIENT_ID,
      fetch: makeFetchStub(() => new Response("upstream down", { status: 503 })),
    });
    expect(restored).toBeUndefined();
    const kept = await store.get(ISSUER);
    expect(kept).toBeDefined();
    expect(kept?.refreshToken).toBe("rt-seed"); // KEPT for retry.
  });

  it("PRESERVES the persisted entry on a TRANSIENT network throw", async () => {
    const restored = await restoreSession({
      store,
      issuer: new URL(ISSUER),
      clientId: CLIENT_ID,
      fetch: makeFetchStub(() => {
        throw new TypeError("network down");
      }),
    });
    expect(restored).toBeUndefined();
    expect(await store.get(ISSUER)).toBeDefined();
  });
});
