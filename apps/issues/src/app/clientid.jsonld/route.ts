// Solid-OIDC Client Identifier Document. Its URL IS the app's client_id, so the
// IdP dereferences this during login and matches the redirect against it (no
// dynamic registration → the consent screen shows the app name). A route handler
// (not public/*.jsonld, which next dev 404s) lets us set the JSON-LD content type
// and derive client_id from the request origin. See the solid-client-id skill.
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const origin = new URL(request.url);
  const at = (path: string) => new URL(path, origin).toString();
  const document = {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: at("/clientid.jsonld"), // MUST equal this document's own URL
    client_name: "Solid Issues",
    redirect_uris: [at("/callback.html")],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_uri: at("/"),
  };
  return new Response(JSON.stringify(document, null, 2), {
    status: 200,
    headers: { "content-type": "application/ld+json", "cache-control": "public, max-age=300" },
  });
}
