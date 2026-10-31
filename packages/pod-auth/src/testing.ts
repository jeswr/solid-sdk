// AUTHORED-BY Codex GPT-6.1-Sol
/** Node test helpers ported from reactive-authentication/test/helpers/openid.js.
 * No listening sockets: inject `fetch` as the pristine global transport before creating PodAuth.
 */
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { KvStore } from "./types.js";

export function createMemoryStore<T extends {} = {}>(): KvStore<T> {
  const values = new Map<string, T>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

/** Real signature, PKCE, nonce, DPoP binding and replay checks, without mocking the protocol engine. */
export function createMockOp(
  options: {
    issuer?: string;
    subject?: string;
    webId?: string | null;
    issuers?: string[];
    requireInteraction?: boolean;
    omitAzp?: boolean;
  } = {},
) {
  const issuer = options.issuer ?? "https://op.example/";
  const webId =
    options.webId === null ? undefined : (options.webId ?? "https://id.example/alice#me");
  const subject = options.subject ?? "https://id.example/alice";
  const clientId = "https://app.example/clientid.jsonld";
  const redirectUri = "https://app.example/auth/callback.html";
  const root = "https://pod.example/alice/";
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = {
    ...keys.publicKey.export({ format: "jwk" }),
    kid: "op-key",
    alg: "ES256",
    use: "sig",
  };
  const codes = new Map<string, URLSearchParams>();
  const tokens = new Map<string, string>();
  const seen = new Set<string>();
  const requests: Request[] = [];
  const stats = { authorizations: 0, tokens: 0, registrations: 0, accepted: 0, exchanges: 0 };
  const jwt = (payload: Record<string, unknown>) => {
    const data = encoded({ alg: "ES256", kid: "op-key" }) + "." + encoded(payload);
    return (
      data +
      "." +
      sign("sha256", Buffer.from(data), {
        key: keys.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    );
  };
  const proofKey = (request: Request, accessToken?: string) => {
    const proof = request.headers.get("dpop")!;
    const [head, body, signature] = proof.split(".");
    const header = JSON.parse(Buffer.from(head!, "base64url").toString());
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    const url = new URL(request.url);
    url.search = "";
    url.hash = "";
    if (
      header.typ !== "dpop+jwt" ||
      header.alg !== "ES256" ||
      header.jwk.d !== undefined ||
      !verify(
        "sha256",
        Buffer.from(head + "." + body),
        { key: createPublicKey({ key: header.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ) ||
      claims.htm !== request.method ||
      claims.htu !== url.href ||
      Math.abs(Date.now() / 1000 - claims.iat) > 60 ||
      typeof claims.jti !== "string" ||
      seen.has(claims.jti) ||
      (accessToken !== undefined && claims.ath !== hash(accessToken))
    )
      throw new Error("Invalid DPoP proof");
    seen.add(claims.jti);
    const { crv, kty, x, y } = header.jwk;
    return hash(JSON.stringify({ crv, kty, x, y }));
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const url = new URL(request.url);
    if (request.url === new URL(".well-known/openid-configuration", issuer).href)
      return Response.json({
        issuer,
        authorization_endpoint: new URL("authorize", issuer).href,
        token_endpoint: new URL("token", issuer).href,
        registration_endpoint: new URL("register", issuer).href,
        jwks_uri: new URL("jwks", issuer).href,
        scopes_supported: ["openid", "webid", "offline_access"],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["ES256"],
        authorization_response_iss_parameter_supported: true,
      });
    if (request.url === new URL("jwks", issuer).href) return Response.json({ keys: [jwk] });
    if (request.url === clientId)
      return Response.json({
        client_id: clientId,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        id_token_signed_response_alg: "ES256",
      });
    if (url.origin === "https://id.example") {
      const subjects = new Set([webId ?? "https://id.example/alice#me", request.url]);
      const dataset = new Store();
      for (const subject of subjects) {
        const term = new TermWrapper(subject, dataset, DataFactory);
        const issuers = SetFrom.subjectPredicate(
          term,
          "http://www.w3.org/ns/solid/terms#oidcIssuer",
          TermAs.term,
          TermFrom.itself,
        );
        for (const value of options.issuers ?? [issuer]) issuers.add(DataFactory.namedNode(value));
      }
      const turtle = new Writer().quadsToString([...dataset]);
      return new Response(turtle, { headers: { "content-type": "text/turtle" } });
    }
    if (request.url === new URL("register", issuer).href) {
      stats.registrations++;
      return Response.json(
        {
          ...(await request.json()),
          client_id: "dynamic-client",
          id_token_signed_response_alg: "ES256",
        },
        { status: 201 },
      );
    }
    if (
      url.pathname === new URL("authorize", issuer).pathname &&
      url.origin === new URL(issuer).origin
    ) {
      stats.authorizations++;
      const p = url.searchParams;
      const callback = new URL(p.get("redirect_uri")!);
      callback.searchParams.set("state", p.get("state")!);
      callback.searchParams.set("iss", issuer);
      if (options.requireInteraction && p.get("prompt") === "none")
        callback.searchParams.set("error", "interaction_required");
      else {
        const code = randomUUID();
        codes.set(code, p);
        callback.searchParams.set("code", code);
      }
      return new Response(null, { status: 302, headers: { location: callback.href } });
    }
    if (request.url === new URL("token", issuer).href) {
      const form = new URLSearchParams(await request.text());
      const params = codes.get(form.get("code")!);
      codes.delete(form.get("code")!);
      let jkt: string;
      try {
        jkt = proofKey(request);
      } catch {
        return Response.json({ error: "invalid_dpop_proof" }, { status: 400 });
      }
      if (
        params === undefined ||
        hash(form.get("code_verifier")!) !== params.get("code_challenge") ||
        form.get("redirect_uri") !== params.get("redirect_uri") ||
        form.get("client_id") !== params.get("client_id")
      )
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      stats.tokens++;
      const now = Math.floor(Date.now() / 1000);
      const access = randomUUID();
      tokens.set(access, jkt);
      const idToken = jwt({
        iss: issuer,
        sub: subject,
        aud: options.omitAzp ? [params.get("client_id")] : [params.get("client_id"), "solid"],
        ...(options.omitAzp ? {} : { azp: params.get("client_id") }),
        nonce: params.get("nonce"),
        iat: now,
        exp: now + 300,
        ...(webId === undefined ? {} : { webid: webId }),
        cnf: { jkt },
      });
      return Response.json({
        access_token: access,
        token_type: "DPoP",
        expires_in: 300,
        id_token: idToken,
      });
    }
    const prefix = "/.well-known/oauth-protected-resource";
    if (url.origin === "https://pod.example" && url.pathname.startsWith(prefix))
      return Response.json({
        resource: url.origin + url.pathname.slice(prefix.length) + url.search,
        authorization_servers: ["https://pod.example/"],
      });
    if (request.url === "https://pod.example/storage")
      return Response.json({
        id: request.url,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: root }],
      });
    if (request.url === "https://pod.example/.well-known/lws-configuration")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: "https://pod.example/exchange",
      });
    if (request.url === "https://pod.example/exchange") {
      const form = new URLSearchParams(await request.text());
      const token = form.get("subject_token")!;
      const [head, body, signature] = token.split(".");
      const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
      if (
        !verify(
          "sha256",
          Buffer.from(head + "." + body),
          { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(signature!, "base64url"),
        ) ||
        claims.iss !== issuer ||
        form.get("subject_token_type") !== "urn:ietf:params:oauth:token-type:id_token"
      )
        throw new Error("Invalid subject token");
      stats.exchanges++;
      return Response.json({ access_token: "lws-access", token_type: "Bearer", expires_in: 300 });
    }
    const lws = url.pathname.includes("/lws");
    const lwsLink = '<https://pod.example/storage>; rel="https://www.w3.org/ns/lws#storage"';
    const link =
      url.href === root
        ? lwsLink + ', <http://www.w3.org/ns/pim/space#Storage>; rel="type"'
        : lws
          ? lwsLink
          : "";

    if (url.href.startsWith(root)) {
      const authorization = request.headers.get("authorization");
      if (lws && authorization === "Bearer lws-access") {
        stats.accepted++;
        return new Response("protected LWS");
      }
      if (authorization?.startsWith("DPoP ")) {
        try {
          const token = authorization.slice(5);
          if (proofKey(request, token) !== tokens.get(token))
            throw new Error("Token binding mismatch");
          stats.accepted++;
          return new Response("protected Solid");
        } catch {
          /* Return a challenge for invalid or replayed credentials. */
        }
      }
    }
    return new Response(null, {
      status: 401,
      headers: {
        "www-authenticate": lws
          ? `Bearer resource_metadata="${url.origin}${prefix}${url.pathname}${url.search}"`
          : 'DPoP algs="ES256"',
        ...(url.href.startsWith(root) ? { link } : {}),
      },
    });
  };
  return {
    issuer,
    webId,
    subject,
    clientId,
    redirectUri,
    root,
    requests,
    stats,
    fetch,
    getCode: async (url: URL, signal: AbortSignal) => {
      const response = await fetch(url, { redirect: "manual", signal });
      return response.headers.get("location")!;
    },
  };
}
