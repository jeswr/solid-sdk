// AUTHORED-BY Claude Opus 4.8
/**
 * app-origin.ts — the single source of truth for the deployment ORIGIN that the
 * Solid-OIDC Client Identifier Document (`client_id`, `redirect_uris`,
 * `client_uri`) is built against.
 *
 * In a server / dynamic build the origin is the request's own origin (correct
 * across `localhost` in dev and the deployed host in prod). In a STATIC export
 * (`output: "export"`, Caddy `file_server`) there is no request at build time,
 * so the origin MUST be baked in via the `APP_ORIGIN` build env var, e.g.
 *   APP_ORIGIN=https://issues.solid-test.jeswr.org APP_STATIC_EXPORT=1 next build
 *
 * `client_id` MUST equal the served document URL byte-for-byte (scheme, host,
 * port, no trailing slash on the origin), so this helper normalises `APP_ORIGIN`
 * to a bare origin and rejects a malformed value rather than silently shipping a
 * client-id document the IdP will reject.
 */

/** Default dev origin — the app's dev server port (see scripts/dev.mjs). */
export const DEFAULT_APP_ORIGIN = "http://localhost:3200";

/**
 * Normalise a configured origin to `scheme://host[:port]` (no path, no trailing
 * slash). Throws on a non-absolute / malformed value so a bad `APP_ORIGIN` fails
 * the build instead of producing an unusable client-id document.
 */
export function normaliseOrigin(value: string): string {
  const url = new URL(value); // throws if not absolute
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`APP_ORIGIN must be an http(s) origin, got: ${value}`);
  }
  return url.origin;
}

/**
 * The build-time deployment origin, from `APP_ORIGIN` (preferred) falling back
 * to `DEFAULT_APP_ORIGIN` for local dev. Used by the clientid.jsonld route so a
 * static export bakes the correct origin into `client_id` / `redirect_uris` /
 * `client_uri`. (At runtime the browser still recomputes the same values from
 * `location.href` — see session-context.tsx — so the two never drift on a
 * correctly-configured deploy.)
 */
export function buildOrigin(): string {
  return normaliseOrigin(process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN);
}
