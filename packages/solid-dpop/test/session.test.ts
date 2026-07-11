/**
 * Session-half unit tests with an injected transport (no CSS, no network). Cover the
 * client-credentials acquire flow's DPoP wiring, the §8 nonce challenge retry, authedFetch's
 * ath-bearing proof, and the rdfFetchFor adapter shape.
 */

import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import {
  acquireToken,
  authedFetch,
  type ClientCredentials,
  createSession,
  discoveryUrl,
  type FetchLike,
  generateSessionKeyPair,
  rdfFetchFor,
  type SolidSessionState,
} from "../src/index.js";

const creds: ClientCredentials = { issuer: "http://idp.example/", id: "cid", secret: "csec" };
const TOKEN_ENDPOINT = "http://idp.example/token";

function discoveryResponse(): Response {
  return new Response(JSON.stringify({ token_endpoint: TOKEN_ENDPOINT }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(access = "at-123"): Response {
  return new Response(
    JSON.stringify({ access_token: access, token_type: "DPoP", expires_in: 300 }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("discoveryUrl (OIDC Discovery 1.0 §4)", () => {
  it("appends the well-known suffix to a non-root issuer, preserving the path", () => {
    expect(discoveryUrl("https://host/realm")).toBe(
      "https://host/realm/.well-known/openid-configuration",
    );
    expect(discoveryUrl("https://host/realm/")).toBe(
      "https://host/realm/.well-known/openid-configuration",
    );
    expect(discoveryUrl("https://host/auth/realms/solid")).toBe(
      "https://host/auth/realms/solid/.well-known/openid-configuration",
    );
  });

  it("handles a root issuer", () => {
    expect(discoveryUrl("https://host/")).toBe("https://host/.well-known/openid-configuration");
    expect(discoveryUrl("https://host")).toBe("https://host/.well-known/openid-configuration");
  });
});

describe("acquireToken (client-credentials + DPoP)", () => {
  it("discovers the token endpoint and sends a DPoP-bound POST", async () => {
    const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.includes(".well-known")) return discoveryResponse();
      return tokenResponse();
    };
    const kp = await generateSessionKeyPair();
    const { accessToken, expiresAt } = await acquireToken(creds, kp, fetchImpl);
    expect(accessToken).toBe("at-123");
    expect(expiresAt).toBeGreaterThan(Date.now());

    const tokenCall = calls.find((c) => c.url === TOKEN_ENDPOINT);
    expect(tokenCall).toBeTruthy();
    const dpop = tokenCall?.init?.headers?.["dpop"];
    expect(dpop).toBeTruthy();
    const header = decodeProtectedHeader(dpop as string);
    expect(header.typ).toBe("dpop+jwt");
    const payload = decodeJwt(dpop as string);
    expect(payload["htm"]).toBe("POST");
    expect(payload["htu"]).toBe(TOKEN_ENDPOINT);
  });

  it("retries once with the server nonce on a 400 use_dpop_nonce challenge (RFC 9449 §8)", async () => {
    let tokenHits = 0;
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes(".well-known")) return discoveryResponse();
      tokenHits += 1;
      if (tokenHits === 1) {
        return new Response("{}", { status: 400, headers: { "DPoP-Nonce": "srv-nonce" } });
      }
      return tokenResponse();
    };
    const kp = await generateSessionKeyPair();
    const { accessToken, nonce } = await acquireToken(creds, kp, fetchImpl);
    expect(tokenHits).toBe(2);
    expect(accessToken).toBe("at-123");
    expect(nonce).toBe("srv-nonce");
  });
});

describe("authedFetch", () => {
  it("attaches Authorization: DPoP <token> and an ath-bound proof", async () => {
    const session: SolidSessionState = {
      keyPair: await generateSessionKeyPair(),
      accessToken: "live-token",
      expiresAt: Date.now() + 600_000,
    };
    let captured: { headers?: Record<string, string> } | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = init;
      return new Response("ok", { status: 200 });
    };
    const res = await authedFetch(session, creds, "GET", "https://pod.example/r", {}, fetchImpl);
    expect(res.status).toBe(200);
    expect(captured?.headers?.["authorization"]).toBe("DPoP live-token");
    const proof = captured?.headers?.["dpop"];
    const payload = decodeJwt(proof as string);
    expect(payload["ath"]).toBeTruthy();
    expect(payload["htu"]).toBe("https://pod.example/r");
  });
});

describe("createSession + rdfFetchFor", () => {
  it("createSession yields a session whose rdfFetchFor adapter issues DPoP requests", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes(".well-known")) return discoveryResponse();
      if (url === TOKEN_ENDPOINT) return tokenResponse("sess-token");
      return new Response("body", { status: 200 });
    };
    const session = await createSession(creds, fetchImpl);
    expect(session.accessToken).toBe("sess-token");

    const rdfFetch = rdfFetchFor(session, creds, fetchImpl);
    const res = await rdfFetch("https://pod.example/data.ttl");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body");
  });
});
