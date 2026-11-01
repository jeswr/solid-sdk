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
