// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the session/JWT persistence helpers: persistSolidTokensIntoJwt (build the persisted
 * shape from an account + DPoP private JWK, fail-closed), extractSolidAuthState (nested + flat),
 * and the DPoP key round-trip (export → persist → extract → import → solidDpopFetch with the same
 * thumbprint) — the load-bearing property that the refresh `jkt` binding survives a restart.
 */

import { exportDpopKeyPairJwk, generateDpopKeyPair, importDpopKeyPairJwk } from "@jeswr/solid-dpop";
import { describe, expect, it } from "vitest";
import { buildSolidDpopFetch } from "../src/dpopFetch.js";
import { extractSolidAuthState, persistSolidTokensIntoJwt, SOLID_JWT_KEY } from "../src/session.js";
import { createMockOp } from "./mockOp.js";

const WEBID = "https://alice.example/profile/card#me";
const POD = "https://alice.example/private/notes.ttl";

describe("persistSolidTokensIntoJwt", () => {
  it("builds the persisted state from an account + DPoP private JWK", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const state = persistSolidTokensIntoJwt({
      account: {
        access_token: "at",
        refresh_token: "rt",
        id_token: "it",
        expires_at: 12345,
        token_type: "DPoP",
      },
      dpopKeyJwk: jwk,
      webid: WEBID,
      issuer: "https://op.example",
    });
    expect(state.accessToken).toBe("at");
    expect(state.refreshToken).toBe("rt");
    expect(state.idToken).toBe("it");
    expect(state.expiresAt).toBe(12345);
    expect(state.webid).toBe(WEBID);
    expect(state.issuer).toBe("https://op.example");
    expect(state.dpopKeyJwk.d).toBe(jwk.d);
  });

  it("FAILS CLOSED when the account has no access token", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    expect(() => persistSolidTokensIntoJwt({ account: {}, dpopKeyJwk: jwk })).toThrow(
      /access_token|fail-closed/i,
    );
  });

  it("FAILS CLOSED when the dpopKeyJwk is public-only (no `d`)", async () => {
    const kp = await generateDpopKeyPair();
    const pubJwk = kp.publicJwk; // no private `d`
    expect(() =>
      persistSolidTokensIntoJwt({ account: { access_token: "at" }, dpopKeyJwk: pubJwk }),
    ).toThrow(/private|`d`/i);
  });

  it("FAILS CLOSED when the dpopKeyJwk is missing", async () => {
    expect(() =>
      persistSolidTokensIntoJwt({
        account: { access_token: "at" },
        dpopKeyJwk: undefined as never,
      }),
    ).toThrow(/dpopKeyJwk/);
  });

  it("omits optional fields that are absent", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const state = persistSolidTokensIntoJwt({
      account: { access_token: "at", token_type: "DPoP" },
      dpopKeyJwk: jwk,
    });
    expect("refreshToken" in state).toBe(false);
    expect("idToken" in state).toBe(false);
    expect("expiresAt" in state).toBe(false);
    expect("webid" in state).toBe(false);
  });

  it("FAILS CLOSED on a non-DPoP token_type (DPoP-downgrade guard)", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    expect(() =>
      persistSolidTokensIntoJwt({
        account: { access_token: "at", token_type: "Bearer" },
        dpopKeyJwk: jwk,
      }),
    ).toThrow(/DPoP|fail-closed/i);
  });

  it("FAILS CLOSED when token_type is absent (a Solid token MUST be DPoP-bound)", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    expect(() =>
      persistSolidTokensIntoJwt({ account: { access_token: "at" }, dpopKeyJwk: jwk }),
    ).toThrow(/DPoP|fail-closed/i);
  });

  it("accepts a case-insensitive `dpop` token_type", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const state = persistSolidTokensIntoJwt({
      account: { access_token: "at", token_type: "dpop" },
      dpopKeyJwk: jwk,
    });
    expect(state.accessToken).toBe("at");
  });
});

describe("extractSolidAuthState", () => {
  it("extracts from a token with the state nested under SOLID_JWT_KEY", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const token = {
      sub: "x",
      [SOLID_JWT_KEY]: { accessToken: "at", dpopKeyJwk: jwk, webid: WEBID, issuer: "https://op" },
    };
    const state = extractSolidAuthState(token);
    expect(state?.accessToken).toBe("at");
    expect(state?.webid).toBe(WEBID);
    expect(state?.issuer).toBe("https://op");
  });

  it("extracts when passed the SolidJwtState directly (flat)", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const state = extractSolidAuthState({ accessToken: "at", dpopKeyJwk: jwk });
    expect(state?.accessToken).toBe("at");
  });

  it("returns undefined when there is no access token", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    expect(extractSolidAuthState({ [SOLID_JWT_KEY]: { dpopKeyJwk: jwk } })).toBeUndefined();
  });

  it("returns undefined when there is no DPoP key", () => {
    expect(extractSolidAuthState({ [SOLID_JWT_KEY]: { accessToken: "at" } })).toBeUndefined();
  });

  it("returns undefined for null/undefined/non-object", () => {
    expect(extractSolidAuthState(null)).toBeUndefined();
    expect(extractSolidAuthState(undefined)).toBeUndefined();
    expect(extractSolidAuthState("nope" as never)).toBeUndefined();
  });
});

describe("DPoP key round-trip — the restart-survival property", () => {
  it("export → persist → extract → import yields the SAME thumbprint", async () => {
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const persisted = persistSolidTokensIntoJwt({
      account: { access_token: "at", token_type: "DPoP" },
      dpopKeyJwk: jwk,
    });
    // Simulate JSON serialization through the JWT.
    const roundTripped = JSON.parse(JSON.stringify({ [SOLID_JWT_KEY]: persisted }));
    const state = extractSolidAuthState(roundTripped);
    expect(state).toBeDefined();
    const restored = await importDpopKeyPairJwk(state?.dpopKeyJwk as never);
    expect(restored.thumbprint).toBe(kp.thumbprint);
  });

  it("a restored state drives solidDpopFetch with a proof bound to the original key", async () => {
    const op = await createMockOp({ issuer: "https://op.example", clientId: "c", webId: WEBID });
    const kp = await generateDpopKeyPair();
    const jwk = await exportDpopKeyPairJwk(kp);
    const persisted = persistSolidTokensIntoJwt({
      account: { access_token: "pod-at", token_type: "DPoP" },
      dpopKeyJwk: jwk,
    });
    const roundTripped = JSON.parse(JSON.stringify({ [SOLID_JWT_KEY]: persisted }));
    const state = extractSolidAuthState(roundTripped);
    const f = buildSolidDpopFetch(state as never, { fetch: op.fetch });
    const res = await f(POD);
    expect(res.status).toBe(200);
    const { calculateJwkThumbprint } = await import("jose");
    const headerJkt = await calculateJwkThumbprint(op.lastResourceDpop()?.header.jwk as never);
    expect(headerJkt).toBe(kp.thumbprint);
  });
});
