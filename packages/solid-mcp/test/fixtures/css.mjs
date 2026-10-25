// AUTHORED-BY Codex GPT-6.1-Sol
// Entirely in-process fixture transport: never contacts a network service.
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";

export const POD = "https://pod.example/alice/";
export const ISSUER = "https://issuer.example/";
export const TOKEN = `${ISSUER}token`;
export function proofOf(request, token) {
  const parts = request.headers.get("dpop")?.split(".");
  assert.equal(parts?.length, 3);
  const [header, payload, signature] = parts;
  const { jwk, alg, typ } = JSON.parse(Buffer.from(header, "base64url").toString());
  assert.equal(alg, "ES256");
  assert.equal(typ, "dpop+jwt");
  assert.equal(jwk.d, undefined);
  assert(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const url = new URL(request.url);
  url.hash = "";
  url.search = "";
  assert.equal(claims.htu, url.href);
  assert.equal(claims.htm, request.method);
  assert(Math.abs(claims.iat - Date.now() / 1000) < 5);
  assert.equal(typeof claims.jti, "string");
  assert.equal(
    claims.ath,
    token ? createHash("sha256").update(token).digest("base64url") : undefined,
  );
  return { ...claims, jwk };
}

export function mockCss() {
  const stats = { tokens: 0, discoveries: 0, reads: 0, writes: 0 };
  const proofs = [];
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.redirect, "manual");
    assert.equal(request.credentials, "omit");
    if (request.url === `${ISSUER}.well-known/openid-configuration`) {
      stats.discoveries++;
      assert.equal(request.headers.get("authorization"), null);
      return Response.json({ issuer: ISSUER, token_endpoint: TOKEN });
    }
    if (request.url === TOKEN) {
      proofs.push(proofOf(request));
      assert.equal(
        request.headers.get("authorization"),
        `Basic ${Buffer.from("fixture-id:fixture-secret").toString("base64")}`,
      );
      assert.equal(await request.text(), "grant_type=client_credentials&scope=webid");
      stats.tokens++;
      return Response.json({
        access_token: `fixture-token-${stats.tokens}`,
        token_type: "DPoP",
        expires_in: 60,
      });
    }
    if (!request.url.startsWith(POD)) {
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("dpop"), null);
      return new Response("public-profile");
    }
    const token = `fixture-token-${stats.tokens}`;
    assert.equal(request.headers.get("authorization"), `DPoP ${token}`);
    proofs.push(proofOf(request, token));
    stats.reads++;
    if (request.method === "PUT") {
      stats.writes++;
      assert.equal(await request.text(), "hello fixture");
      return new Response(null, { status: 201 });
    }
    if (request.url === `${POD}stats`) return Response.json(stats);
    if (request.url === `${POD}redirect`)
      return new Response(null, {
        status: 302,
        headers: { location: "https://foreign.example/secret" },
      });
    if (request.url === POD)
      return new Response(
        `@prefix ldp: <http://www.w3.org/ns/ldp#>. <${POD}> a ldp:Container; ldp:contains <${POD}note>.`,
        { headers: { "content-type": "text/turtle" } },
      );
    return new Response("hello fixture", { headers: { "content-type": "text/plain" } });
  };
  return { fetch, stats, proofs };
}
