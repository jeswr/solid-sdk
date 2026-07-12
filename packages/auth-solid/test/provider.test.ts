// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the `Solid(config)` provider factory: the OIDCConfig shape (checks/scope/type),
 * the verified-WebID-only `profile` callback (fail-closed), transport guards, public-vs-confidential
 * client, and the `account` field shaping. Plus an end-to-end token exchange through the customFetch
 * against the faithful mock OP (real DPoP proof verification + §8 nonce retry).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { customFetch } from "@auth/core";
import { calculateJwkThumbprint } from "jose";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE, SOLID_CHECKS, Solid } from "../src/provider.js";
import { createMockOp } from "./mockOp.js";

const ISSUER = "https://op.example";
const CLIENT_ID = "https://app.example/client-id";
const WEBID = "https://alice.example/profile/card#me";

describe("Solid() provider factory — config shape", () => {
  it("returns an OIDCConfig with type oidc, the mandatory checks, scope, and a customFetch", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect(p.type).toBe("oidc");
    expect(p.id).toBe("solid");
    expect(p.name).toBe("Solid");
    expect(p.issuer).toBe(ISSUER);
    expect(p.clientId).toBe(CLIENT_ID);
    expect(p.checks).toEqual([...SOLID_CHECKS]);
    expect(p.checks).toContain("pkce");
    expect(p.checks).toContain("state");
    expect(p.checks).toContain("nonce");
    expect((p.authorization as { params: { scope: string } }).params.scope).toBe(DEFAULT_SCOPE);
    expect(typeof p[customFetch]).toBe("function");
  });

  it("does NOT set a clientSecret for a public client (Client Identifier Document)", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect("clientSecret" in p).toBe(false);
  });

  it("sets token_endpoint_auth_method `none` for a public client (so Auth.js does NOT default to basic-with-no-secret)", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect((p.client as { token_endpoint_auth_method?: string })?.token_endpoint_auth_method).toBe(
      "none",
    );
  });

  it("sets a clientSecret for a confidential client", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: "static-client", clientSecret: "s3cret" });
    expect(p.clientSecret).toBe("s3cret");
  });

  it("sets token_endpoint_auth_method explicitly for a confidential client (never undefined)", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: "static-client", clientSecret: "s3cret" });
    expect((p.client as { token_endpoint_auth_method?: string })?.token_endpoint_auth_method).toBe(
      "client_secret_basic",
    );
  });

  it("honours id/name overrides", async () => {
    const p = await Solid({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      id: "my-solid",
      name: "My Solid",
    });
    expect(p.id).toBe("my-solid");
    expect(p.name).toBe("My Solid");
  });

  it("normalizes a custom scope and always forces `openid`", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID, scope: "webid offline_access" });
    const scope = (p.authorization as { params: { scope: string } }).params.scope;
    expect(scope.split(" ")[0]).toBe("openid");
    expect(scope).toContain("webid");
    expect(scope).toContain("offline_access");
  });

  it("de-duplicates scopes", async () => {
    const p = await Solid({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      scope: "openid openid webid webid",
    });
    const scope = (p.authorization as { params: { scope: string } }).params.scope;
    expect(scope).toBe("openid webid");
  });
});

describe("Solid() — required-field + transport guards", () => {
  it("throws when issuer is missing", async () => {
    await expect(Solid({ issuer: "", clientId: CLIENT_ID })).rejects.toThrow(/issuer/);
  });

  it("throws when clientId is missing", async () => {
    await expect(Solid({ issuer: ISSUER, clientId: "" })).rejects.toThrow(/clientId/);
  });

  it("rejects an http: issuer when allowInsecure is false", async () => {
    await expect(Solid({ issuer: "http://op.example", clientId: CLIENT_ID })).rejects.toThrow(
      /insecure http/,
    );
  });

  it("rejects an http: non-loopback issuer even when allowInsecure is true", async () => {
    await expect(
      Solid({ issuer: "http://op.example", clientId: CLIENT_ID, allowInsecure: true }),
    ).rejects.toThrow(/insecure http|loopback/);
  });

  it("allows an http: loopback issuer when allowInsecure is true", async () => {
    const p = await Solid({
      issuer: "http://localhost:3000",
      clientId: CLIENT_ID,
      allowInsecure: true,
    });
    expect(p.issuer).toBe("http://localhost:3000");
  });
});

describe("Solid() — profile callback (verified WebID only, fail-closed)", () => {
  function callProfile(p: Awaited<ReturnType<typeof Solid>>, claims: Record<string, unknown>) {
    const profileFn = p.profile as (claims: unknown, tokens: unknown) => unknown;
    return profileFn(claims, {});
  }

  it("maps a `webid` claim → id + webid", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    const user = callProfile(p, { webid: WEBID, sub: "abc" }) as { id: string; webid: string };
    expect(user.id).toBe(WEBID);
    expect(user.webid).toBe(WEBID);
  });

  it("falls back to a `sub` that is itself an http(s) WebID", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    const user = callProfile(p, { sub: WEBID }) as { id: string; webid: string };
    expect(user.id).toBe(WEBID);
    expect(user.webid).toBe(WEBID);
  });

  it("FAILS CLOSED when no webid claim is present", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect(() => callProfile(p, { sub: "opaque-subject-not-a-url" })).toThrow(/webid|fail-closed/i);
  });

  it("FAILS CLOSED on an empty webid claim", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect(() => callProfile(p, { webid: "" })).toThrow(/webid|fail-closed/i);
  });

  it("FAILS CLOSED on a non-http(s) webid claim", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect(() => callProfile(p, { webid: "urn:not:a:webid" })).toThrow(/webid|fail-closed/i);
  });

  it("does NOT trust a webid from a non-claim location (only the passed verified claims)", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    // The access token is NOT passed to profile()'s claim arg — only the verified ID-token claims.
    expect(() => callProfile(p, {})).toThrow(/webid|fail-closed/i);
  });
});

describe("Solid() — account callback shaping", () => {
  it("keeps only the allow-listed token fields and drops extras", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    const accountFn = p.account as (a: Record<string, unknown>) => Record<string, unknown>;
    const out = accountFn({
      access_token: "at",
      refresh_token: "rt",
      id_token: "it",
      expires_at: 123,
      token_type: "dpop",
      scope: "openid webid",
      provider: "solid",
      // an extra field the OP returned that must NOT survive
      some_secret_extra: "leak-me",
    });
    expect(out.access_token).toBe("at");
    expect(out.refresh_token).toBe("rt");
    expect(out.id_token).toBe("it");
    expect(out.expires_at).toBe(123);
    expect(out.token_type).toBe("dpop");
    expect(out.scope).toBe("openid webid");
    expect("some_secret_extra" in out).toBe(false);
    expect("provider" in out).toBe(false);
  });
});

describe("Solid() — DPoP keypair", () => {
  it("generates an ES256 (EC P-256) keypair", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    expect(p.dpopKeyPair.publicJwk.kty).toBe("EC");
    expect(p.dpopKeyPair.publicJwk.crv).toBe("P-256");
  });

  it("dpopKeyJwkForPersistence() exports the private JWK (carries `d`) matching the thumbprint", async () => {
    const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    const jwk = await p.dpopKeyJwkForPersistence();
    expect(typeof jwk.d).toBe("string");
    // calculateJwkThumbprint derives the thumbprint from the required EC members only, so passing
    // the full private JWK yields the same value as the public thumbprint.
    const tp = await calculateJwkThumbprint(jwk);
    expect(tp).toBe(p.dpopKeyPair.thumbprint);
  });

  it("restores a supplied dpopKeyJwk (same thumbprint)", async () => {
    const first = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
    const jwk = await first.dpopKeyJwkForPersistence();
    const restored = await Solid({ issuer: ISSUER, clientId: CLIENT_ID, dpopKeyJwk: jwk });
    expect(restored.dpopKeyPair.thumbprint).toBe(first.dpopKeyPair.thumbprint);
  });
});

describe("Solid() — token exchange end-to-end through the customFetch", () => {
  it("attaches a valid DPoP proof on the token request, does the §8 nonce retry once, and succeeds", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    // The provider's customFetch wraps `globalThis.fetch` (captured at construction, matching how
    // Auth.js uses the global). Patch the global to the mock OP BEFORE building the provider, so the
    // token request hits the in-process fake instead of the network.
    const realFetch = globalThis.fetch;
    globalThis.fetch = op.fetch as typeof fetch;
    try {
      const p = await Solid({ issuer: ISSUER, clientId: CLIENT_ID });
      const cf = p[customFetch] as (url: string, init?: RequestInit) => Promise<Response>;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: "https://app.example/callback",
        code_verifier: "verifier",
      });
      const res = await cf(op.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      expect(res.status).toBe(200);
      const tokenSet = (await res.json()) as { access_token: string; token_type: string };
      expect(tokenSet.token_type).toBe("DPoP");
      expect(tokenSet.access_token).toMatch(/^access-token-/);
      // §8: the token endpoint was hit exactly twice (initial 400 use_dpop_nonce + the retry).
      expect(op.tokenCallCount()).toBe(2);
      // The token-leg proof carries NO ath and IS bound to the provider's key (matching thumbprint).
      const proof = op.lastTokenDpop();
      expect(proof?.payload.ath).toBeUndefined();
      expect(proof?.payload.nonce).toBe("srv-token-nonce-abc");
      const headerJkt = await calculateJwkThumbprint(proof?.header.jwk as never);
      expect(headerJkt).toBe(p.dpopKeyPair.thumbprint);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("@auth/core peer contract (github-install regression)", () => {
  // REGRESSION (caught on a clean github: install): the `customFetch` symbol this package imports
  // is a NAMED export of @auth/core only from 0.37.0 — and npm's `latest` dist-tag lagged at 0.34.3
  // (no such export), so a bare `npm install @auth/core` pulled an export-less version and the
  // import failed at load. The peer floor MUST stay >=0.37 so the declared contract matches the
  // symbol's actual availability.
  it("the imported `customFetch` symbol is present (the export exists in the installed @auth/core)", () => {
    expect(typeof customFetch).toBe("symbol");
  });

  it("the declared @auth/core peer range is exactly >=0.37.0 <1 (no compound clause re-admits <0.37)", () => {
    // Assert the EXACT intended range string rather than the first x.y.z substring: a regex that
    // only reads the first version would let a compound range like `>=0.37.0 || >=0.34.0` pass while
    // still admitting unsupported (<0.37) @auth/core versions (a roborev finding). Pinning the exact
    // string is the strongest check that needs no `semver` dependency in the test.
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.peerDependencies?.["@auth/core"]).toBe(">=0.37.0 <1");
  });
});
