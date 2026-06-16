// Solid-OIDC Client Identifier Document. Its URL IS the app's client_id, so the
// IdP dereferences this during login and matches the redirect against it (no
// dynamic registration → the consent screen shows the app name). A route handler
// (not public/*.jsonld, which next dev 404s) lets us set the JSON-LD content type
// and bake client_id from the deploy origin. See the solid-client-id skill.
//
// `force-static`: the document is the SAME for every request (it describes the
// deployment, not the caller), so it is pre-rendered once at build. This is what
// lets the route survive a static export (`output: "export"`, Caddy file_server)
// — a static file has no request to read the origin from. The origin is therefore
// taken from the build-time `APP_ORIGIN` env var (see src/lib/app-origin.ts), and
// the byte-for-byte `client_id` MUST match the deploy origin:
//   APP_ORIGIN=https://issues.solid-test.jeswr.org APP_STATIC_EXPORT=1 next build
// For local dev / a localhost build it defaults to http://localhost:3200. (Next
// requires `dynamic` to be a static literal, so this is not conditional.)
import { buildOrigin } from "@/lib/app-origin";

export const dynamic = "force-static";

export function GET(): Response {
  const origin = buildOrigin();
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
