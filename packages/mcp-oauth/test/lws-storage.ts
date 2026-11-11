// AUTHORED-BY Codex GPT-6.1-Sol
import { createPublicKey, verify } from "node:crypto";
import { expect } from "vitest";
import { POD_CLIENT, POD_ISSUER, POD_ROOT, POD_WEBID, podIssuer } from "./pod-issuer.js";

export const LWS_STORAGE = "https://pod.example/storage";
const issuer = "https://lws.example/";
export const LWS_AUTHORIZATION_SERVER = issuer;
/** An authorization server no session vouches for; it answers anything it is sent. */
export const FOREIGN_AUTHORIZATION_SERVER = "https://attacker.example/";
const metadataPrefix = "https://pod.example/.well-known/oauth-protected-resource";

/** Private offline LWS storage, with independently verified OIDC subject credentials. */
export function lwsStorage(op = podIssuer()) {
  op.controls.idSubject = POD_WEBID;
  op.controls.idAuthorizedParty = POD_CLIENT;
  const exchanges: URLSearchParams[] = [];
  const requests: Request[] = [];
  const rejected = new Set<string>();
  const controls = {
    wrongResource: false,
    authorizationServers: [issuer],
    tokenEndpoint: `${issuer}exchange`,
    /** The root the storage description advertises. */
    storageRoot: POD_ROOT,
    /** Answer with a pre-RFC 9728 `as_uri`/`realm` challenge for this realm instead. */
    legacyRealm: undefined as string | undefined,
    onDiscovery: undefined as (() => Promise<void>) | undefined,
    onExchange: undefined as (() => Promise<void>) | undefined,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const url = new URL(request.url);
    if (request.url === `${FOREIGN_AUTHORIZATION_SERVER}.well-known/lws-configuration`)
      return Response.json({
        issuer: FOREIGN_AUTHORIZATION_SERVER,
        token_endpoint: `${FOREIGN_AUTHORIZATION_SERVER}exchange`,
      });
    if (request.url.startsWith(FOREIGN_AUTHORIZATION_SERVER))
      return Response.json({ access_token: "stolen", token_type: "Bearer", expires_in: 300 });
    if (request.url.startsWith(metadataPrefix)) {
      expect(request.headers.has("authorization")).toBe(false);
      return Response.json({
        resource: controls.wrongResource
          ? `${POD_ROOT}other`
          : `https://pod.example${url.pathname.slice(new URL(metadataPrefix).pathname.length)}${url.search}`,
        authorization_servers: controls.authorizationServers,
      });
    }
    if (request.url === LWS_STORAGE)
      return Response.json({
        "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
        id: LWS_STORAGE,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: controls.storageRoot }],
      });
    if (request.url === `${issuer}.well-known/lws-configuration`) {
      await controls.onDiscovery?.();
      return Response.json({ issuer, token_endpoint: controls.tokenEndpoint });
    }
    if (request.url === `${issuer}exchange`) {
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("dpop")).toBe(false);
      const params = new URLSearchParams(await request.text());
      expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(params.get("resource")).toBe(LWS_STORAGE);
      expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:id_token");
      expect(params.get("client_id")).toBe(POD_CLIENT);
      const [header, payload, signature] = (params.get("subject_token") as string).split(".") as [
        string,
        string,
        string,
      ];
      const jwks = await (await op.fetch(`${POD_ISSUER}jwks`)).json();
      expect(JSON.parse(Buffer.from(header, "base64url").toString()).alg).toBe("ES256");
      expect(
        verify(
          "sha256",
          Buffer.from(`${header}.${payload}`),
          { key: createPublicKey({ key: jwks.keys[0], format: "jwk" }), dsaEncoding: "ieee-p1363" },
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(claims).toMatchObject({
        iss: POD_ISSUER,
        sub: op.controls.idSubject,
        aud: POD_CLIENT,
        azp: POD_CLIENT,
      });
      expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
      exchanges.push(params);
      await controls.onExchange?.();
      return Response.json({
        access_token: `fixture-lws-${exchanges.length}`,
        token_type: "Bearer",
        expires_in: 300,
      });
    }
    if (!request.url.startsWith(POD_ROOT)) return op.fetch(request);
    const headers = new Headers({
      link: `<${LWS_STORAGE}>; rel="https://www.w3.org/ns/lws#storage", <https://www.w3.org/ns/lws#${request.url === POD_ROOT ? "Container" : "DataResource"}>; rel="type"`,
      etag: '"fixture-lws"',
    });
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer fixture-lws-") || rejected.has(authorization)) {
      headers.set(
        "www-authenticate",
        controls.legacyRealm === undefined
          ? `Bearer resource_metadata="${metadataPrefix}${url.pathname}${url.search}"`
          : `Bearer as_uri="${issuer}", realm="${controls.legacyRealm}"`,
      );
      return new Response(null, { status: 401, headers });
    }
    expect(request.headers.has("dpop")).toBe(false);
    if (request.method === "HEAD") return new Response(null, { headers });
    if (request.url === POD_ROOT) {
      headers.set("content-type", "application/lws+json");
      return Response.json(
        {
          id: POD_ROOT,
          type: "Container",
          totalItems: 1,
          items: [{ id: `${POD_ROOT}note.txt`, type: "DataResource", format: "text/plain" }],
        },
        { headers },
      );
    }
    headers.set("content-type", "text/plain");
    return new Response("private LWS content", { headers });
  };
  return { op, fetch: fetcher, requests, exchanges, rejected, controls };
}
