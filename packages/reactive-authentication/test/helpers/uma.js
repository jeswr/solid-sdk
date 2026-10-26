// A mock Solid-OIDC §9 / UMA 2.0 authorization server and resource server on one origin. The AS validates
// the pushed ID token independently (jose against the OpenID provider's JWKS; webid claim; audience "solid";
// cnf.jkt equal to the DPoP proof key), the permission ticket (single use) and claim_token_format.

import { randomUUID } from "node:crypto";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import { serve } from "./http.js";
import { verifyDPoP } from "./openid.js";

export const PROFILE = "http://openid.net/specs/openid-connect-core-1_0.html#IDToken";

/**
 * @param {object} op OpenID provider from startOpenIdProvider
 * @param {object} [options]
 * @param {boolean} [options.nonce] demand a DPoP nonce at the token endpoint first
 * @param {boolean} [options.resourceNonce] demand a resource nonce without repeating the UMA challenge
 * @param {boolean} [options.needInfo] answer need_info with a claims interaction hint
 * @param {(base: string) => string} [options.asUri] as_uri the resource server announces
 */
export async function startUma(op, options = {}) {
  const keys = await generateKeyPair("ES256");
  const tickets = new Set();
  const revoked = new Set();
  const seen = new Set();
  const stats = {
    exchanges: [],
    rejected: [],
    accepted: [],
    nonceChallenges: 0,
    resourceNonceChallenges: 0,
  };
  const nonce = options.nonce ? "uma-nonce" : undefined;

  const server = await serve(async (request, { url: base }) => {
    const url = new URL(request.url);
    const json = (body, status = 200, headers = {}) =>
      Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

    if (url.pathname === "/.well-known/uma2-configuration") {
      return json({
        issuer: base, // origin-only issuer, as deployed UMA servers use
        token_endpoint: `${base}/token`,
        grant_types_supported: ["urn:ietf:params:oauth:grant-type:uma-ticket"],
        uma_profiles_supported: [PROFILE],
        dpop_signing_alg_values_supported: ["ES256"],
      });
    }

    if (url.pathname === "/token") {
      const form = new URLSearchParams(await request.text());
      stats.exchanges.push(Object.fromEntries(form));
      let jkt;
      try {
        jkt = await verifyDPoP(request.headers.get("dpop"), {
          method: "POST",
          url: `${base}/token`,
          nonce,
          seen,
        });
      } catch (e) {
        if (e.nonce) {
          stats.nonceChallenges++;
          return json({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": nonce });
        }
        stats.rejected.push(e.message);
        return json({ error: "invalid_dpop_proof" }, 400);
      }
      try {
        if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:uma-ticket")
          throw new Error("grant_type");
        if (!tickets.delete(form.get("ticket")))
          return json({ error: "invalid_grant", error_description: "unknown or used ticket" }, 400);
        if (form.get("claim_token_format") !== PROFILE) throw new Error("claim_token_format");
        const { payload } = await jwtVerify(form.get("claim_token"), op.jwks, {
          issuer: op.issuer,
          audience: "solid",
        });
        if (typeof payload.webid !== "string" || !payload.webid.startsWith("https://"))
          throw new Error("webid claim");
        if (payload.cnf?.jkt !== jkt) throw new Error("DPoP key does not match the ID token cnf");
        if (options.needInfo) {
          const ticket = issueTicket();
          return json(
            { error: "need_info", ticket, redirect_user: `${base}/claims?ticket=${ticket}` },
            403,
          );
        }
        const now = Math.floor(Date.now() / 1000);
        const rpt = await new SignJWT({ webid: payload.webid, cnf: { jkt } })
          .setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
          .setIssuer(base)
          .setAudience(base)
          .setSubject(payload.webid)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .setJti(randomUUID())
          .sign(keys.privateKey);
        return json({ access_token: rpt, token_type: "DPoP", expires_in: 300 });
      } catch (e) {
        stats.rejected.push(e.message);
        return json({ error: "invalid_grant", error_description: e.message }, 400);
      }
    }

    if (url.pathname.startsWith("/uma/")) {
      const challenge = (error) =>
        new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `UMA realm="storage", as_uri="${options.asUri?.(base) ?? base}", ticket="${issueTicket()}"${error ? `, error="${error}"` : ""}`,
          },
        });
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("DPoP ")) return challenge();
      const token = authorization.slice(5);
      try {
        const { payload } = await jwtVerify(token, keys.publicKey, {
          issuer: base,
          audience: base,
          typ: "at+jwt",
        });
        const proofKey = await verifyDPoP(request.headers.get("dpop"), {
          method: request.method,
          url: request.url,
          accessToken: token,
          nonce: options.resourceNonce ? "uma-resource-nonce" : undefined,
          seen,
        });
        if (revoked.has(token) || proofKey !== payload.cnf.jkt) return challenge("invalid_token");
        stats.accepted.push({ url: request.url, webid: payload.webid, token });
        return new Response(`hello ${payload.webid}`);
      } catch (e) {
        if (e.nonce) {
          stats.resourceNonceChallenges++;
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate": 'DPoP error="use_dpop_nonce"',
              "dpop-nonce": "uma-resource-nonce",
            },
          });
        }
        return challenge("invalid_token");
      }
    }
    return new Response(null, { status: 404 });
  });

  function issueTicket() {
    const ticket = randomUUID();
    tickets.add(ticket);
    return ticket;
  }

  return {
    server,
    stats,
    get url() {
      return server.url;
    },
    revoke: (token) => revoked.add(token),
    setNeedInfo: (value) => {
      options.needInfo = value;
    },
    close: () => server.close(),
  };
}
