#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
//
// Live protocol check for every Solid identity provider the suite advertises
// (scripts/sign-in-live/providers.json). For each provider it checks what a browser app needs
// before a person can type a password, from each listed app's point of view:
//
//   discovery   /.well-known/openid-configuration answers, names the configured issuer and allows
//               the app's origin (CORS)
//   metadata    authorization, token and JWKS endpoints exist; PKCE S256 and the webid scope are
//               offered when the provider lists them
//   jwks        the key set is readable from the app's origin and holds public signing keys
//   authorize   the app's real authorization request (its Client Identifier Document, redirect
//               URI, PKCE) reaches the provider's interactive login page: the page must match the
//               provider's `loginPage` expectation (where it is served and a marker in its HTML),
//               so an error or maintenance page never passes
//   token-cors  the token endpoint's CORS preflight allows the app's origin and the DPoP header
//
// It never signs in and never creates accounts. Exit code 1 when any check fails; a Markdown
// table goes to $GITHUB_STEP_SUMMARY when set. Dependency-free: Node 24 built-ins only.
//
//   node scripts/sign-in-live/check.mjs                       # every provider, every app
//   SIGN_IN_PROVIDERS=test-idp,teamid node scripts/sign-in-live/check.mjs
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 20_000;
const MAX_HOPS = 10;

/** Issuer comparison with the trailing-slash normalisation Solid-OIDC servers disagree on. */
export function sameIssuer(a, b) {
  const norm = (value) => {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

/** Whether a CORS response lets `origin` read it. */
export function corsAllows(headers, origin) {
  const allowed = headers.get("access-control-allow-origin");
  return allowed === "*" || allowed === origin;
}

/** Whether a preflight's Access-Control-Allow-Headers covers every header in `needed`. */
export function preflightAllowsHeaders(headers, needed) {
  const raw = (headers.get("access-control-allow-headers") ?? "").toLowerCase();
  const list = raw.split(",").map((h) => h.trim());
  return list.includes("*") || needed.every((h) => list.includes(h.toLowerCase()));
}

/** Plain-text excerpt of an HTML or JSON body for a failure message. */
export function excerpt(body, length = 200) {
  return body
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

/** The text of an HTML page's <title>, or "" when it has none. */
export function pageTitle(body) {
  return excerpt(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 80);
}

/**
 * Classify where an authorization request ended. `final` is the last response's status, location
 * (absolute, or null), content type, body and `where` (host + path); `redirectUri` is the app's
 * redirect URI; `loginPage` is the provider's expectation: `marker`, a regular expression the login
 * page's HTML must match, and optionally `at`, one its host + path must match. A page that does not
 * meet it fails, so an error, maintenance or holding page is never taken for a working login.
 */
export function classifyAuthorizeEnd(final, redirectUri, loginPage) {
  if (final.location?.startsWith(redirectUri)) {
    const params = new URL(final.location).searchParams;
    const error = params.get("error");
    if (error) {
      const description = params.get("error_description");
      return {
        ok: false,
        detail: `redirected back with error=${error}${description ? ` (${description})` : ""}`,
      };
    }
    return { ok: true, detail: "redirected straight back to the app" };
  }
  if (final.location) return { ok: false, detail: `more than ${MAX_HOPS} redirects` };
  const html = /html/i.test(final.contentType ?? "");
  if (!(final.status >= 200 && final.status < 300 && html)) {
    return {
      ok: false,
      detail: `${final.status} at ${final.where}: ${excerpt(final.body) || "(empty body)"}`,
    };
  }
  if (
    /\b(invalid_request|invalid_client|unauthorized_client|invalid_redirect_uri|redirect_uri_mismatch)\b/i.test(
      final.body,
    )
  ) {
    return { ok: false, detail: `error page: ${excerpt(final.body)}` };
  }
  if (!loginPage?.marker || !loginPage?.at) {
    return { ok: false, detail: `no loginPage expectation configured; ended at ${final.where}` };
  }
  const title = pageTitle(final.body);
  const seen = `${final.where}${title ? ` ("${title}")` : ""}`;
  if (!new RegExp(loginPage.at).test(final.where)) {
    return { ok: false, detail: `ended at ${seen}, not the login page (${loginPage.at})` };
  }
  if (!new RegExp(loginPage.marker, "i").test(final.body)) {
    return {
      ok: false,
      detail: `${seen} is not the login page (no ${loginPage.marker}): ${excerpt(final.body, 120)}`,
    };
  }
  return { ok: true, detail: `login page at ${seen}` };
}

const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"];

const SIGNING_CURVES = { EC: ["P-256", "P-384", "P-521"], OKP: ["Ed25519", "Ed448"] };

/** A complete public key that may verify signatures (RFC 7517 §4.2-4.3, RFC 7518 §6, RFC 8037). */
function isPublicVerificationKey(key) {
  if (!key || typeof key !== "object") return false;
  if (key.use !== undefined && key.use !== "sig") return false;
  if (key.key_ops !== undefined && !(Array.isArray(key.key_ops) && key.key_ops.includes("verify")))
    return false;
  const str = (value) => typeof value === "string" && value.length > 0;
  switch (key.kty) {
    case "RSA":
      return str(key.n) && str(key.e);
    case "EC":
      return SIGNING_CURVES.EC.includes(key.crv) && str(key.x) && str(key.y);
    case "OKP":
      return SIGNING_CURVES.OKP.includes(key.crv) && str(key.x);
    default:
      return false;
  }
}

/** Check a JWKS response body: JSON, public keys only, and at least one usable signing key. */
export function checkJwks(body) {
  let jwks;
  try {
    jwks = JSON.parse(body);
  } catch {
    return { ok: false, detail: `not JSON: ${excerpt(body, 80) || "(empty body)"}` };
  }
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : null;
  if (!keys?.length) return { ok: false, detail: "no keys" };
  if (keys.some((key) => PRIVATE_JWK_MEMBERS.some((member) => key && member in key))) {
    return { ok: false, detail: "publishes private or symmetric key material" };
  }
  const signing = keys.filter(isPublicVerificationKey);
  if (!signing.length) return { ok: false, detail: "no public signing keys" };
  return { ok: true, detail: `${signing.length} signing key(s)` };
}

async function timedFetch(fetchImpl, url, init = {}) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function pkceChallenge() {
  const verifier = randomBytes(32).toString("base64url");
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Follow the app's authorization request like a browser would (per-host cookies, manual redirects). */
async function followAuthorize(fetchImpl, metadata, app) {
  const start = new URL(metadata.authorization_endpoint);
  start.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: "openid webid offline_access",
    state: randomBytes(8).toString("base64url"),
    nonce: randomBytes(8).toString("base64url"),
    code_challenge: pkceChallenge(),
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  const jars = new Map();
  let url = start.href;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const host = new URL(url).host;
    const jar = jars.get(host) ?? new Map();
    jars.set(host, jar);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await timedFetch(fetchImpl, url, {
      redirect: "manual",
      headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
    });
    for (const set of res.headers.getSetCookie?.() ?? []) {
      const pair = set.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = res.headers.get("location");
    const where = `${host}${new URL(url).pathname}`;
    if (!location) {
      return {
        status: res.status,
        location: null,
        contentType: res.headers.get("content-type"),
        body: await res.text(),
        where,
      };
    }
    await res.body?.cancel();
    const next = new URL(location, url).href;
    if (next.startsWith(app.redirectUri)) {
      return { status: res.status, location: next, contentType: null, body: "", where };
    }
    url = next;
  }
  return { status: 0, location: url, contentType: null, body: "", where: new URL(url).host };
}

/** Run every check for one provider against every app. Never throws. */
export async function checkProvider(provider, apps, fetchImpl = fetch) {
  const results = [];
  const record = (check, app, ok, detail, warn = false) =>
    results.push({ provider: provider.id, check, app: app?.id ?? "-", ok, warn, detail });
  const guard = async (check, app, fn) => {
    try {
      await fn();
    } catch (error) {
      const cause = error?.cause?.code ?? error?.cause?.message;
      record(
        check,
        app,
        false,
        `${error?.name === "TimeoutError" ? "timed out" : error?.message}${cause ? ` (${cause})` : ""}`,
      );
    }
  };

  let metadata;
  for (const app of apps) {
    const origin = new URL(app.url).origin;
    await guard("discovery", app, async () => {
      const url = `${provider.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
      const res = await timedFetch(fetchImpl, url, {
        headers: { accept: "application/json", origin },
      });
      if (!res.ok) return record("discovery", app, false, `HTTP ${res.status}`);
      const body = await res.json();
      if (!sameIssuer(body.issuer, provider.issuer)) {
        return record(
          "discovery",
          app,
          false,
          `issuer is ${body.issuer}, expected ${provider.issuer}`,
        );
      }
      if (!corsAllows(res.headers, origin)) {
        return record("discovery", app, false, `CORS does not allow ${origin}`);
      }
      metadata ??= body;
      record("discovery", app, true, `issuer ${body.issuer}`);
    });
  }
  if (!metadata) return results;

  const missing = ["authorization_endpoint", "token_endpoint", "jwks_uri"].filter(
    (k) => !metadata[k],
  );
  if (missing.length) record("metadata", null, false, `missing ${missing.join(", ")}`);
  else record("metadata", null, true, "endpoints present");
  const pkce = metadata.code_challenge_methods_supported;
  if (pkce && !pkce.includes("S256")) record("metadata", null, false, "PKCE S256 not supported");
  else if (!pkce) record("metadata", null, true, "PKCE methods not advertised", true);
  const scopes = metadata.scopes_supported;
  if (scopes && !scopes.includes("webid"))
    record("metadata", null, false, "webid scope not offered");
  const dpop = metadata.dpop_signing_alg_values_supported;
  if (!dpop) record("metadata", null, true, "DPoP algorithms not advertised", true);
  else if (!dpop.includes("ES256")) record("metadata", null, false, "DPoP ES256 not supported");
  if (missing.length) return results;

  for (const app of apps) {
    const origin = new URL(app.url).origin;
    await guard("jwks", app, async () => {
      const res = await timedFetch(fetchImpl, metadata.jwks_uri, {
        headers: { accept: "application/json", origin },
      });
      const body = await res.text();
      if (!res.ok) return record("jwks", app, false, `HTTP ${res.status}`);
      if (!corsAllows(res.headers, origin))
        return record("jwks", app, false, `CORS does not allow ${origin}`);
      const verdict = checkJwks(body);
      record("jwks", app, verdict.ok, verdict.detail);
    });
    await guard("authorize", app, async () => {
      const end = await followAuthorize(fetchImpl, metadata, app);
      const verdict = classifyAuthorizeEnd(end, app.redirectUri, provider.loginPage);
      record("authorize", app, verdict.ok, verdict.detail);
    });
    await guard("token-cors", app, async () => {
      const res = await timedFetch(fetchImpl, metadata.token_endpoint, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,dpop",
        },
      });
      await res.body?.cancel();
      if (res.status < 200 || res.status >= 300)
        return record("token-cors", app, false, `preflight HTTP ${res.status}`);
      if (!corsAllows(res.headers, origin))
        return record("token-cors", app, false, `CORS does not allow ${origin}`);
      if (!preflightAllowsHeaders(res.headers, ["content-type", "dpop"])) {
        return record("token-cors", app, false, "preflight does not allow the DPoP header");
      }
      record("token-cors", app, true, "DPoP allowed");
    });
  }
  return results;
}

/** Render results as a Markdown table. */
export function toMarkdown(results) {
  const mark = (r) => (r.ok ? (r.warn ? "⚠️" : "✅") : "❌");
  const rows = results.map(
    (r) =>
      `| ${mark(r)} | ${r.provider} | ${r.check} | ${r.app} | ${r.detail.replace(/\|/g, "\\|")} |`,
  );
  return ["| | Provider | Check | App | Detail |", "|---|---|---|---|---|", ...rows].join("\n");
}

async function main() {
  // A standalone CLI run by the sign-in-live workflow, outside Turbo's task graph.
  const env = process.env;
  const matrix = JSON.parse(readFileSync(new URL("./providers.json", import.meta.url), "utf8"));
  const only = (env.SIGN_IN_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const providers = only.length
    ? matrix.providers.filter((p) => only.includes(p.id))
    : matrix.providers;
  if (only.length && providers.length !== only.length) {
    throw new Error(`unknown provider id in SIGN_IN_PROVIDERS: ${only.join(",")}`);
  }
  const results = [];
  for (const provider of providers) results.push(...(await checkProvider(provider, matrix.apps)));
  for (const r of results) {
    console.log(
      `${r.ok ? (r.warn ? "WARN" : "PASS") : "FAIL"}  ${r.provider.padEnd(15)} ${r.check.padEnd(11)} ${r.app.padEnd(6)} ${r.detail}`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  const summary = `## Sign-in protocol check\n\n${failed.length ? `**${failed.length} failing check(s).**` : "All checks passed."}\n\n${toMarkdown(results)}\n`;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
