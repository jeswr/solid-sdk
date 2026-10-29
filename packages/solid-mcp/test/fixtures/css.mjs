// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Entirely in-process fixture transport: never contacts a network service.
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { serialize } from "@jeswr/rdf-serialize";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";

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
  const chats = new Map();
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
    // Persist chat RDF behind the same credential and DPoP checks as pod tools.
    if (request.url.startsWith(`${POD}private/chats/`)) {
      const resource = chats.get(request.url);
      if (request.method === "HEAD")
        return new Response(null, {
          status: resource === undefined ? 404 : 200,
          headers: { link: `<${request.url}.acl>; rel="acl"` },
        });
      if (request.method === "PUT") {
        stats.writes++;
        if (request.headers.get("if-none-match") === "*" && resource !== undefined)
          return new Response(null, { status: 412 });
        assert.equal(request.headers.get("content-type"), "text/turtle");
        chats.set(request.url, await request.text());
        return new Response(null, { status: 201 });
      }
      if (resource === undefined) return new Response(null, { status: 404 });
      let body = resource;
      if (request.url.endsWith("/")) {
        const store = new Store();
        const container = new Container(request.url, store, DataFactory);
        container.type.add("http://www.w3.org/ns/ldp#Container");
        for (const childUrl of chats.keys()) {
          if (
            childUrl === request.url ||
            !childUrl.startsWith(request.url) ||
            childUrl.slice(request.url.length).replace(/\/$/, "").includes("/")
          )
            continue;
          const child = new Resource(childUrl, store, DataFactory);
          child.type.add(
            `http://www.w3.org/ns/ldp#${childUrl.endsWith("/") ? "Container" : "Resource"}`,
          );
          container.contains.add(child);
        }
        body = await serialize([...store], { format: "text/turtle" });
      }
      return new Response(body, { headers: { "content-type": "text/turtle" } });
    }
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
