// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The stable Solid-OIDC **Client Identifier Document** (solid-client-id skill,
 * Next/Vercel recipe). Served at `/clientid.jsonld` with `application/ld+json`;
 * `client_id` is derived from the request origin so it equals this document's own
 * URL byte-for-byte in every environment (localhost dev + the Vercel deploy). The
 * app's `SessionProvider` uses `new URL("/clientid.jsonld", origin)` as its
 * `clientId`, so the consent screen shows "Coeliac Diary", not a random
 * registration. A route handler (NOT `public/*.jsonld`, which `next dev` 404s).
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const clientId = new URL("/clientid.jsonld", request.url).toString();
  const callback = new URL("/callback.html", request.url).toString();
  const home = new URL("/", request.url).toString();
  const document = {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: clientId,
    client_name: "Coeliac Diary",
    redirect_uris: [callback],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_uri: home,
  };
  return new Response(JSON.stringify(document, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/ld+json",
      "cache-control": "public, max-age=300",
    },
  });
}
