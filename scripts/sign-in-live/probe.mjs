// AUTHORED-BY Claude Opus 5.5
// Protocol probe: for each advertised issuer, report discovery metadata, how the provider answers the
// suite's authorization request (login page or an error redirect), and CORS on the token endpoint.
const APP = process.env.APP_ORIGIN ?? "https://solid-suite.vercel.app";
const CLIENT_ID = `${APP}/.well-known/solid-client-id.jsonld`;
const REDIRECT = `${APP}/auth/callback.html`;
const issuers = (process.env.ISSUERS ??
  "https://idp.solid-test.jeswr.org,https://solidcommunity.net/,https://login.inrupt.com/,https://teamid.live/,https://solidweb.org/,https://solidweb.me/")
  .split(",").map((s) => s.trim()).filter(Boolean);
const webIds = (process.env.WEBIDS ?? "https://solid-test.jeswr.org/signup-smoke-3/profile/card#me").split(",").filter(Boolean);

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
async function pkce() {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return challenge;
}
for (const issuer of issuers) {
  console.log(`\n===== ${issuer}`);
  try {
    const disc = new URL(issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration");
    const r = await fetch(disc, { headers: { accept: "application/json", origin: APP }, redirect: "manual" });
    console.log("discovery", r.status, "ACAO", r.headers.get("access-control-allow-origin"));
    if (!r.ok) continue;
    const m = await r.json();
    const pick = ["issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint", "scopes_supported", "prompt_values_supported", "code_challenge_methods_supported", "dpop_signing_alg_values_supported", "token_endpoint_auth_methods_supported", "authorization_response_iss_parameter_supported", "response_types_supported", "grant_types_supported", "id_token_signing_alg_values_supported", "end_session_endpoint", "revocation_endpoint"];
    for (const k of pick) console.log(`  ${k}:`, JSON.stringify(m[k]));
    for (const scope of ["openid webid offline_access", "openid webid"]) {
      for (const prompt of ["consent", undefined]) {
        const u = new URL(m.authorization_endpoint);
        u.searchParams.set("client_id", CLIENT_ID);
        u.searchParams.set("redirect_uri", REDIRECT);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("scope", scope);
        u.searchParams.set("state", "s");
        u.searchParams.set("nonce", "n");
        u.searchParams.set("code_challenge_method", "S256");
        u.searchParams.set("code_challenge", await pkce());
        if (prompt) u.searchParams.set("prompt", prompt);
        let url = u.href;
        const trail = [];
        for (let i = 0; i < 8; i++) {
          const res = await fetch(url, { redirect: "manual", headers: { accept: "text/html" } });
          const loc = res.headers.get("location");
          trail.push(`${res.status} ${new URL(url).host}${new URL(url).pathname}`);
          if (!loc) {
            const body = (await res.text()).replace(/\s+/g, " ");
            const err = body.match(/(error[^<]{0,200})/i)?.[1];
            trail.push(`body-title=${body.match(/<title>([^<]*)/i)?.[1] ?? "?"}${err ? ` err=${err.slice(0, 200)}` : ""}`);
            break;
          }
          const next = new URL(loc, url);
          if (next.href.startsWith(REDIRECT)) {
            trail.push(`CALLBACK ${next.search}`);
            break;
          }
          url = next.href;
        }
        console.log(`  authorize scope="${scope}" prompt=${prompt ?? "-"}: ${trail.join(" -> ")}`);
      }
    }
    const pre = await fetch(m.token_endpoint, {
      method: "OPTIONS",
      headers: { origin: APP, "access-control-request-method": "POST", "access-control-request-headers": "content-type,dpop" },
    });
    console.log("  token preflight", pre.status, "ACAO", pre.headers.get("access-control-allow-origin"), "ACAH", pre.headers.get("access-control-allow-headers"), "ACEH", pre.headers.get("access-control-expose-headers"));
  } catch (e) {
    console.log("  ERROR", e?.message, e?.cause?.message ?? "");
  }
}
for (const webId of webIds) {
  console.log(`\n===== WebID ${webId}`);
  try {
    const r = await fetch(webId, { headers: { accept: "text/turtle", origin: APP } });
    console.log("status", r.status, r.headers.get("content-type"), "ACAO", r.headers.get("access-control-allow-origin"));
    const t = await r.text();
    console.log(t.split("\n").filter((l) => /oidcIssuer|storage|space#|solid#/.test(l)).join("\n"));
  } catch (e) {
    console.log("  ERROR", e?.message);
  }
}
