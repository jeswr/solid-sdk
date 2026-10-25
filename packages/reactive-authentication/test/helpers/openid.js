// A mock OpenID provider and Solid storage that verify what the client sends: PKCE, state/nonce echo,
// DPoP proofs (signature, htm/htu, ath, jti replay, nonce), refresh-token rotation with reuse detection.

import { createHash, randomUUID } from "node:crypto";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from "jose";
import { serve } from "./http.js";

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

/** Verifies a DPoP proof JWT (RFC 9449 §4.3) and returns the key thumbprint. */
export async function verifyDPoP(proof, { method, url, accessToken, nonce, seen }) {
  if (proof === null) throw new Error("missing DPoP proof");
  const header = decodeProtectedHeader(proof);
  if (header.typ !== "dpop+jwt" || header.jwk === undefined) throw new Error("bad DPoP header");
  const key = await importJWK(header.jwk, header.alg);
  const { payload } = await jwtVerify(proof, key, { typ: "dpop+jwt", maxTokenAge: 60 });
  const target = new URL(url);
  target.search = target.hash = "";
  if (payload.htm !== method) throw new Error(`htm ${payload.htm} != ${method}`);
  if (payload.htu !== target.href) throw new Error(`htu ${payload.htu} != ${target.href}`);
  if (seen.has(payload.jti)) throw new Error("DPoP proof replayed");
  seen.add(payload.jti);
  if (nonce !== undefined && payload.nonce !== nonce)
    throw Object.assign(new Error("nonce"), { nonce: true });
  if (
    accessToken !== undefined &&
    payload.ath !== b64url(createHash("sha256").update(accessToken).digest())
  )
    throw new Error("bad ath");
  return await calculateJwkThumbprint(header.jwk);
}

/**
 * @param {object} options
 * @param {boolean} [options.requireInteraction] answer prompt=none with interaction_required
 * @param {boolean} [options.tokenNonce] demand a DPoP nonce at the token endpoint first
 * @param {number} [options.expiresIn]
 * @param {boolean} [options.rotate] rotate refresh tokens (default true)
 * @param {boolean} [options.refreshIdToken] include an ID token in refresh responses
 */
export async function startOpenIdProvider(options = {}) {
  const keys = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "op-key", alg: "ES256", use: "sig" };
  const codes = new Map();
  const refreshTokens = new Map(); // token -> {state: "active"|"used", sub, client_id, jkt}
  const seen = new Set();
  const stats = {
    authorize: [],
    token: [],
    refresh: 0,
    reuse: 0,
    registrations: 0,
    revoked: [],
    nonceChallenges: 0,
  };
  let subject = options.subject ?? "alice";
  let webId = options.webId;
  let tokenNonce = options.tokenNonce ? "op-nonce-1" : undefined;
  let refreshError;

  const server = await serve(async (request, { url: base }) => {
    const url = new URL(request.url);
    const json = (body, status = 200, headers = {}) =>
      Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        return json({
          issuer: `${base}/`,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          revocation_endpoint: `${base}/revoke`,
          jwks_uri: `${base}/jwks`,
          scopes_supported: ["openid", "webid", "offline_access"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          dpop_signing_alg_values_supported: ["ES256"],
          id_token_signing_alg_values_supported: ["ES256"],
          authorization_response_iss_parameter_supported: true,
        });
      case "/jwks":
        return json({ keys: [jwk] });
      case "/register": {
        stats.registrations++;
        const metadata = await request.json();
        return json(
          {
            ...metadata,
            client_id: `client-${stats.registrations}`,
            id_token_signed_response_alg: "ES256",
          },
          201,
        );
      }
      case "/authorize": {
        const p = url.searchParams;
        stats.authorize.push(Object.fromEntries(p));
        const redirect = new URL(p.get("redirect_uri"));
        redirect.searchParams.set("state", p.get("state"));
        redirect.searchParams.set("iss", `${base}/`);
        if (p.get("prompt") === "none" && options.requireInteraction) {
          redirect.searchParams.set("error", "interaction_required");
        } else {
          const code = randomUUID();
          codes.set(code, {
            client_id: p.get("client_id"),
            redirect_uri: p.get("redirect_uri"),
            challenge: p.get("code_challenge"),
            nonce: p.get("nonce"),
            scope: p.get("scope"),
          });
          redirect.searchParams.set("code", code);
        }
        return new Response(null, { status: 302, headers: { location: redirect.href } });
      }
      case "/revoke": {
        stats.revoked.push(new URLSearchParams(await request.text()).get("token"));
        return new Response(null, { status: 200 });
      }
      case "/token": {
        const form = new URLSearchParams(await request.text());
        stats.token.push(Object.fromEntries(form));
        let jkt;
        try {
          jkt = await verifyDPoP(request.headers.get("dpop"), {
            method: "POST",
            url: `${base}/token`,
            nonce: tokenNonce,
            seen,
          });
        } catch (e) {
          if (e.nonce) {
            stats.nonceChallenges++;
            return json({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": tokenNonce });
          }
          return json({ error: "invalid_dpop_proof", error_description: e.message }, 400);
        }

        if (form.get("grant_type") === "authorization_code") {
          const code = codes.get(form.get("code"));
          codes.delete(form.get("code"));
          if (code === undefined) return json({ error: "invalid_grant" }, 400);
          const challenge = b64url(
            createHash("sha256")
              .update(form.get("code_verifier") ?? "")
              .digest(),
          );
          if (challenge !== code.challenge || form.get("redirect_uri") !== code.redirect_uri)
            return json({ error: "invalid_grant", error_description: "pkce" }, 400);
          return json(
            await issue(
              base,
              code.client_id,
              jkt,
              code.nonce,
              code.scope.includes("offline_access"),
              true,
            ),
          );
        }

        if (form.get("grant_type") === "refresh_token") {
          stats.refresh++;
          if (refreshError !== undefined) return json({ error: refreshError }, 400);
          const record = refreshTokens.get(form.get("refresh_token"));
          if (record === undefined || record.jkt !== jkt)
            return json({ error: "invalid_grant" }, 400);
          if (record.state === "used") {
            stats.reuse++;
            return json({ error: "invalid_grant", error_description: "refresh token reuse" }, 400);
          }
          if (options.rotate !== false) record.state = "used";
          const issued = await issue(
            base,
            record.client_id,
            jkt,
            undefined,
            options.rotate !== false,
            options.refreshIdToken === true,
          );
          if (options.rotate === false) delete issued.refresh_token;
          return json(issued);
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }
    }
    return new Response("not found", { status: 404 });
  });

  async function issue(base, clientId, jkt, nonce, withRefresh, withIdToken) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn ?? 300;
    const access = await new SignJWT({ webid: webId, client_id: clientId, cnf: { jkt } })
      .setProtectedHeader({ alg: "ES256", kid: "op-key", typ: "at+jwt" })
      .setIssuer(`${base}/`)
      .setSubject(subject)
      .setAudience("solid")
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(randomUUID())
      .sign(keys.privateKey);
    const result = { access_token: access, token_type: "DPoP", expires_in: expiresIn };
    if (withIdToken) {
      result.id_token = await new SignJWT({
        webid: webId,
        azp: clientId,
        ...(nonce === undefined ? {} : { nonce }),
        cnf: { jkt },
      })
        .setProtectedHeader({ alg: "ES256", kid: "op-key" })
        .setIssuer(`${base}/`)
        .setSubject(subject)
        .setAudience([clientId, "solid"])
        .setIssuedAt(now)
        .setExpirationTime(now + expiresIn)
        .sign(keys.privateKey);
    }
    if (withRefresh) {
      const token = randomUUID();
      refreshTokens.set(token, { state: "active", client_id: clientId, jkt });
      result.refresh_token = token;
    }
    return result;
  }

  return {
    server,
    stats,
    jwk,
    get issuer() {
      return `${server.url}/`;
    },
    jwks: createLocalJWKSet({ keys: [jwk] }),
    setSubject(value) {
      subject = value;
    },
    setWebId(value) {
      webId = value;
    },
    /** Make refresh grants fail with an OAuth error (e.g. invalid_grant), or succeed again with undefined. */
    failRefresh(error) {
      refreshError = error;
    },
    rotateTokenNonce() {
      tokenNonce = `op-nonce-${randomUUID()}`;
    },
    close: () => server.close(),
  };
}

/** A code provider acting as the user agent: follows the authorization redirect without UI. */
export function automaticCodeProvider(onRequest = () => {}) {
  return {
    calls: 0,
    async getCode(authorizationUrl, signal) {
      this.calls++;
      await onRequest(authorizationUrl, signal);
      signal?.throwIfAborted();
      const response = await fetch(authorizationUrl, { redirect: "manual", signal });
      const value = response.headers.get("location");
      let disposed = false;
      return {
        value,
        [Symbol.dispose]() {
          disposed = true;
        },
        get disposed() {
          return disposed;
        },
      };
    },
  };
}

/**
 * A Solid storage server: `/alice/` and `/bob/` storages (Solid storage description Link header), plus
 * `/alice-evil/` outside both. Verifies DPoP-bound access tokens from the provider.
 */
export async function startSolidStorage(op, options = {}) {
  const seen = new Set();
  const accepted = [];
  const revoked = new Set();
  const rsNonce = options.nonce ? "rs-nonce-1" : undefined;
  const writes = [];

  const server = await serve(async (request, { url: base }) => {
    const url = new URL(request.url);
    const storage = url.pathname.match(/^\/(alice|bob)\//)?.[1];
    // Server-generated metadata: every resource names its storage description; storage roots are typed pim:Storage.
    const description = `<${base}/${storage}/.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`;
    const root =
      url.pathname === `/${storage}/`
        ? `, <http://www.w3.org/ns/pim/space#Storage>; rel="type"`
        : "";
    const links = storage === undefined ? {} : { link: description + root };

    if (url.pathname.endsWith("/.well-known/solid")) {
      return new Response(`<${base}/${storage}/> a <http://www.w3.org/ns/pim/space#Storage> .`, {
        headers: { "content-type": "text/turtle", ...links },
      });
    }
    if (url.pathname.startsWith("/public")) return new Response("public");
    if (options.handle) {
      const handled = await options.handle(request, base);
      if (handled !== undefined) return handled;
    }

    const challenge = (error) =>
      new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": `DPoP algs="ES256"${error ? `, error="${error}"` : ""}`,
          ...(error === "use_dpop_nonce" ? { "DPoP-Nonce": rsNonce } : {}),
          ...links,
        },
      });

    const authorization = request.headers.get("authorization");
    if (authorization === null) return challenge();
    if (!authorization.startsWith("DPoP ")) return challenge("invalid_token");
    const token = authorization.slice(5);
    try {
      const { payload } = await jwtVerify(token, op.jwks, {
        issuer: op.issuer,
        audience: "solid",
        typ: "at+jwt",
      });
      if (revoked.has(token)) return challenge("invalid_token");
      const jkt = await verifyDPoP(request.headers.get("dpop"), {
        method: request.method,
        url: request.url,
        accessToken: token,
        nonce: rsNonce,
        seen,
      });
      if (jkt !== payload.cnf.jkt) return challenge("invalid_token");
      accepted.push({ url: request.url, sub: payload.sub, token });
      if (request.method !== "GET" && request.method !== "HEAD")
        writes.push({ url: request.url, body: await request.text() });
      if (options.after) {
        const after = await options.after(request, base);
        if (after !== undefined) return after;
      }
      return new Response(`hello ${payload.sub}`, { headers: { "content-type": "text/plain" } });
    } catch (e) {
      if (e.nonce) return challenge("use_dpop_nonce");
      return challenge("invalid_token");
    }
  });

  return {
    server,
    accepted,
    writes,
    get url() {
      return server.url;
    },
    revoke(token) {
      revoked.add(token);
    },
    close: () => server.close(),
  };
}
