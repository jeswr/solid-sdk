// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { accessTokenHash } from "@jeswr/solid-dpop";
import { expect } from "vitest";

export const POD_ISSUER = "https://issuer.example/";
export const POD_WEBID = "https://alice.example/profile#me";
export const POD_ROOT = "https://pod.example/alice/";
export const POD_CLIENT = "https://mcp.example/client-id.jsonld";
export const POD_CALLBACK = "https://mcp.example/auth/callback";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

/** Offline issuer that checks real PKCE, key possession, code binding and refresh rotation. */
export function podIssuer() {
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = {
    ...keys.publicKey.export({ format: "jwk" }),
    kid: "issuer-key",
    alg: "ES256",
    use: "sig",
  };
  const codes = new Map<string, URLSearchParams>();
  const refreshes = new Map<string, string>();
  const accessKeys = new Map<string, string>();
  const seenJti = new Set<string>();
  const captured: { url: string; method: string; headers: Headers; body: string }[] = [];
  const controls = {
    discoveryStatus: 200,
    discoveryIssuer: POD_ISSUER,
    discoveryType: "application/json",
    webId: POD_WEBID,
    profileIssuer: POD_ISSUER,
    profileIssuers: 1,
    profileStatus: 200,
    tokenType: "DPoP",
    issueRefresh: true,
    expiresIn: 600 as number | undefined,
    idNonce: undefined as string | undefined,
    idSubject: "alice",
    idIssuer: POD_ISSUER,
    tokenError: false,
    tokenNonce: false,
    resourceNonce: false,
    alwaysResourceNonce: false,
    refreshWebId: undefined as string | undefined,
    refreshNonce: undefined as string | undefined,
    refreshIdToken: true,
    rotateRefresh: true,
    onToken: undefined as (() => Promise<void>) | undefined,
  };
  let counter = 0;
  let tokenNonceRequired = false;
  const mint = (nonce?: string, webId = controls.webId) => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: "ES256", kid: "issuer-key", typ: "JWT" });
    const payload = b64({
      iss: controls.idIssuer,
      aud: POD_CLIENT,
      sub: controls.idSubject,
      webid: webId,
      iat: now,
      exp: now + 600,
      ...(nonce === undefined ? {} : { nonce: controls.idNonce ?? nonce }),
    });
    const input = `${header}.${payload}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const proof = (request: Request, accessToken?: string) => {
    const jwt = request.headers.get("dpop") as string;
    expect(jwt).toBeTruthy();
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toMatchObject({ typ: "dpop+jwt", alg: "ES256" });
    expect(header.jwk.d).toBeUndefined();
    const key = createPublicKey({ key: header.jwk, format: "jwk" });
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(s, "base64url"),
      ),
    ).toBe(true);
    const target = new URL(request.url);
    target.search = "";
    target.hash = "";
    expect(payload.htm).toBe(request.method);
    expect(payload.htu).toBe(target.href);
    expect(Math.abs(payload.iat - Date.now() / 1000)).toBeLessThan(60);
    expect(seenJti.has(payload.jti)).toBe(false);
    seenJti.add(payload.jti);
    if (accessToken === undefined) expect(payload.ath).toBeUndefined();
    else expect(payload.ath).toBe(accessTokenHash(accessToken));
    const { crv, kty, x, y } = header.jwk;
    return { payload, jkt: hash(JSON.stringify({ crv, kty, x, y })) };
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.clone().text();
    captured.push({
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body,
    });
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      if (url.origin !== new URL(POD_ISSUER).origin) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({
          issuer: controls.discoveryIssuer,
          authorization_endpoint: `${POD_ISSUER}authorize`,
          token_endpoint: `${POD_ISSUER}token`,
          jwks_uri: `${POD_ISSUER}jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["ES256"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          dpop_signing_alg_values_supported: ["ES256"],
          authorization_response_iss_parameter_supported: true,
        }),
        { status: controls.discoveryStatus, headers: { "content-type": controls.discoveryType } },
      );
    }
    if (url.href === `${POD_ISSUER}jwks`) return Response.json({ keys: [publicJwk] });
    if (
      url.href === "https://alice.example/profile" ||
      url.href === "https://other.example/profile"
    ) {
      const issuers =
        controls.profileIssuers === 0
          ? ""
          : `<${POD_WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${controls.profileIssuer}> .`;
      return new Response(
        `${issuers}\n${controls.profileIssuers > 1 ? `<${POD_WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://other-issuer.example/> .` : ""}\n<${POD_WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD_ROOT}> .`,
        { status: controls.profileStatus, headers: { "content-type": "text/turtle" } },
      );
    }
    if (url.href === `${POD_ISSUER}token`) {
      const checked = proof(request);
      if (controls.tokenNonce) {
        controls.tokenNonce = false;
        tokenNonceRequired = true;
        return Response.json(
          { error: "use_dpop_nonce" },
          { status: 400, headers: { "dpop-nonce": "fixture-token-nonce" } },
        );
      }
      if (tokenNonceRequired) expect(checked.payload.nonce).toBe("fixture-token-nonce");
      tokenNonceRequired = false;
      if (controls.onToken) await controls.onToken();
      if (controls.tokenError) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const params = new URLSearchParams(body);
      expect(params.get("client_id")).toBe(POD_CLIENT);
      expect(params.has("client_secret")).toBe(false);
      let nonce: string | undefined;
      if (params.get("grant_type") === "authorization_code") {
        const code = params.get("code") as string;
        const auth = codes.get(code);
        expect(auth).toBeDefined();
        codes.delete(code);
        expect(hash(params.get("code_verifier") as string)).toBe(auth?.get("code_challenge"));
        expect(params.get("redirect_uri")).toBe(auth?.get("redirect_uri"));
        expect(checked.jkt).toBe(auth?.get("dpop_jkt"));
        nonce = auth?.get("nonce") as string;
      } else {
        expect(params.get("grant_type")).toBe("refresh_token");
        const refresh = params.get("refresh_token") as string;
        expect(refreshes.get(refresh)).toBe(checked.jkt);
        if (controls.rotateRefresh) refreshes.delete(refresh);
      }
      counter++;
      const accessToken = `fixture-pod-access-${counter}`;
      accessKeys.set(accessToken, checked.jkt);
      const refreshToken = `fixture-pod-refresh-${counter}`;
      refreshes.set(refreshToken, checked.jkt);
      return Response.json({
        access_token: accessToken,
        token_type: controls.tokenType,
        ...(nonce !== undefined || controls.refreshIdToken
          ? {
              id_token: mint(
                nonce ?? controls.refreshNonce,
                nonce === undefined ? controls.refreshWebId : controls.webId,
              ),
            }
          : {}),
        ...(controls.expiresIn === undefined ? {} : { expires_in: controls.expiresIn }),
        ...(controls.issueRefresh && (nonce !== undefined || controls.rotateRefresh)
          ? { refresh_token: refreshToken }
          : {}),
        scope: "openid webid offline_access",
      });
    }
    if (url.href.startsWith(POD_ROOT)) {
      const accessToken = (request.headers.get("authorization") as string).slice("DPoP ".length);
      const checked = proof(request, accessToken);
      expect(accessKeys.get(accessToken)).toBe(checked.jkt);
      if (controls.resourceNonce || controls.alwaysResourceNonce) {
        controls.resourceNonce = false;
        return new Response(null, {
          status: 401,
          headers: { "dpop-nonce": "fixture-resource-nonce" },
        });
      }
      return Response.json({ ok: true, nonce: checked.payload.nonce });
    }
    throw new Error("Unexpected fixture network request");
  };
  return {
    fetch: fetcher,
    controls,
    captured,
    callback(authorizeUrl: string) {
      const auth = new URL(authorizeUrl).searchParams;
      expect(auth.get("code_challenge_method")).toBe("S256");
      expect(auth.get("client_id")).toBe(POD_CLIENT);
      expect(auth.get("scope")).toBe("openid webid offline_access");
      expect(auth.get("prompt")).toBe("consent");
      const code = randomUUID();
      codes.set(code, auth);
      return `${POD_CALLBACK}?${new URLSearchParams({ code, state: auth.get("state") as string, iss: POD_ISSUER })}`;
    },
  };
}
