// @vitest-environment node
// AUTHORED-BY Claude Opus 4.8
/**
 * next.test.ts — the `@jeswr/solid-api-auth/next` route-handler adapter: error→Response mapping
 * (status + WWW-Authenticate; generic 500 for non-ApiAuthError), the `withOwnerAuth` wrapper
 * (short-circuits to the challenge on failure, passes verified credentials on success), and the
 * cross-bundle `instanceof ApiAuthError` correctness a core-thrown error must satisfy inside the
 * adapter.
 */
import { describe, expect, it } from "vitest";
import { ApiAuthError } from "../src/index.js";
import { apiAuthErrorToResponse, verifyNextRequest, withOwnerAuth } from "../src/next.js";
import { createHarness, OWNER } from "./harness.js";

describe("apiAuthErrorToResponse", () => {
  it("maps a 401 ApiAuthError to a 401 Response carrying the WWW-Authenticate challenge", async () => {
    const res = apiAuthErrorToResponse(new ApiAuthError("nope", 401, 'DPoP error="invalid_token"'));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('DPoP error="invalid_token"');
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("maps a 403 ApiAuthError to a 403 Response with no challenge", async () => {
    const res = apiAuthErrorToResponse(new ApiAuthError("forbidden", 403));
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("maps an unexpected (non-ApiAuthError) error to a generic 500 that leaks no detail", async () => {
    const res = apiAuthErrorToResponse(new Error("secret internal detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error." });
    expect(JSON.stringify(body)).not.toMatch(/secret internal detail/);
  });
});

describe("verifyNextRequest", () => {
  it("verifies a web Request (as a Next route handler receives it)", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const request = h.mkRequest({ authorization: `DPoP ${token}`, dpop: proof });
    const creds = await verifyNextRequest(request, { verifier });
    expect(creds.webId).toBe(OWNER);
  });
});

describe("withOwnerAuth", () => {
  it("runs the handler with verified credentials on success", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });

    const Post = withOwnerAuth(
      async (_request, credentials) => Response.json({ ok: true, webId: credentials.webId }),
      { verifier },
    );
    const res = await Post(h.mkRequest({ authorization: `DPoP ${token}`, dpop: proof }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, webId: OWNER });
  });

  it("short-circuits to a 401 challenge Response when unauthenticated (handler never runs)", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    let handlerRan = false;
    const Post = withOwnerAuth(
      async () => {
        handlerRan = true;
        return Response.json({ ok: true });
      },
      { verifier },
    );
    const res = await Post(h.mkRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^DPoP /);
    expect(handlerRan).toBe(false);
  });

  it("short-circuits to 403 for a valid non-owner token — a core-thrown ApiAuthError maps correctly", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken({ webid: "https://intruder.example/card#me" });
    const proof = await h.mintProof({ accessToken: token });
    const Post = withOwnerAuth(async () => Response.json({ ok: true }), { verifier });
    const res = await Post(h.mkRequest({ authorization: `DPoP ${token}`, dpop: proof }));
    expect(res.status).toBe(403);
  });

  it("forwards extra Next route context (e.g. { params }) to the handler", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const Post = withOwnerAuth(
      async (_request, _credentials, ctx: { params: { id: string } }) =>
        Response.json({ id: ctx.params.id }),
      { verifier },
    );
    const res = await Post(h.mkRequest({ authorization: `DPoP ${token}`, dpop: proof }), {
      params: { id: "abc" },
    });
    expect(await res.json()).toEqual({ id: "abc" });
  });
});
