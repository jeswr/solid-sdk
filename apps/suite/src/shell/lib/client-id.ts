// AUTHORED-BY Codex GPT-6.1-Sol
export function buildClientId(requestUrl: string, configuredOrigin?: string) {
  const request = new URL(requestUrl);
  const origin = new URL(configuredOrigin ?? request.origin).origin;
  return {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: origin + request.pathname,
    client_name: "Solid Suite",
    logo_uri: `${origin}/icon.svg`,
    redirect_uris: [`${origin}/auth/callback.html`],
    post_logout_redirect_uris: [`${origin}/welcome`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile offline_access webid",
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the suite says it lives: configured origin first, then the host Vercel
 * assigns the deployment (trusted environment, not request input), then a
 * loopback request URL for local development only.
 */
export function trustedClientOrigin(
  env: Partial<Record<string, string | undefined>>,
  requestUrl: string,
): { origin?: string; cacheable: boolean } {
  const parse = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      return url.protocol === "https:" || LOOPBACK.has(url.hostname) ? url.origin : undefined;
    } catch {
      return undefined;
    }
  };
  const configured =
    parse(env.NEXT_PUBLIC_SUITE_ORIGIN) ??
    (env.VERCEL_ENV === "production" ? parse(env.VERCEL_PROJECT_PRODUCTION_URL) : undefined) ??
    parse(env.VERCEL_BRANCH_URL) ??
    parse(env.VERCEL_URL);
  if (configured) return { origin: configured, cacheable: true };
  const request = new URL(requestUrl);
  return LOOPBACK.has(request.hostname)
    ? { origin: request.origin, cacheable: false }
    : { cacheable: false };
}
