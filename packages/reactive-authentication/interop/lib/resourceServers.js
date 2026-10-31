// Local HTTP resource servers for provider tests that have no public read-only API of their own.
// `introspectingApi` validates real provider tokens the way a production API would (JWKS signature, issuer,
// audience, expiry) and additionally asks the provider's introspection endpoint, so revoked tokens are refused.
// `decoy` challenges every request and records only whether credentials arrived.

import { once } from "node:events";
import { createServer } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

async function listen(handler) {
  const server = createServer(async (req, res) => {
    try {
      const { status, headers = {}, body } = await handler(req);
      res
        .writeHead(status, { "cache-control": "no-store", ...headers })
        .end(body === undefined ? undefined : JSON.stringify(body));
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" }).end(error.name);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/**
 * @param {object} options
 * @param {string} options.issuer
 * @param {string} options.audience required `aud` value
 * @param {{endpoint: string, clientId: string, clientSecret: string}} options.introspection
 */
export async function introspectingApi({ issuer, audience, introspection, jwksUri }) {
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  const seen = [];
  const challenge = (error) => ({
    status: 401,
    headers: {
      "www-authenticate": `Bearer realm="interop-api"${error ? `, error="${error}"` : ""}`,
      "content-type": "application/json",
    },
    body: { error: error ?? "unauthorized" },
  });
  const server = await listen(async (req) => {
    const authorization = req.headers.authorization;
    seen.push({
      path: new URL(req.url, "http://x").pathname,
      scheme: authorization?.split(" ", 1)[0],
      dpop: req.headers.dpop !== undefined,
    });
    if (authorization === undefined) return challenge();
    const [scheme, token] = authorization.split(" ");
    if (scheme.toLowerCase() !== "bearer" || !token) return challenge("invalid_request");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
    } catch {
      return challenge("invalid_token");
    }
    if (!(await introspect(introspection, token, "access_token")))
      return challenge("invalid_token");
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { sub: payload.sub, azp: payload.azp, scope: payload.scope },
    };
  });
  return { ...server, seen };
}

/** Answers 401 Bearer to everything; `seen` records whether any request carried credentials. */
export async function decoy() {
  const seen = [];
  const server = await listen(async (req) => {
    seen.push({
      credentials: req.headers.authorization !== undefined || req.headers.dpop !== undefined,
    });
    return { status: 401, headers: { "www-authenticate": 'Bearer realm="decoy"' } };
  });
  return { ...server, seen };
}

/** Asks the provider whether a token is still active (for revocation checks; the token is never output). */
export async function introspect({ endpoint, clientId, clientSecret }, token, hint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({ token, ...(hint === undefined ? {} : { token_type_hint: hint }) }),
  });
  if (!response.ok) throw new Error(`introspection answered ${response.status}`);
  return (await response.json()).active === true;
}
