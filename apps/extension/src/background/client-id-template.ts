// AUTHORED-BY GPT-6.1-Sol (Codex)
/** The single template used to render the public Solid-OIDC Client Identifier Document. */
export const PUBLISHED_CLIENT_ID_URL =
  'https://jeswr.github.io/solid-browser-extension/clientid.jsonld';
export const SOLID_OIDC_CONTEXT = 'https://www.w3.org/ns/solid/oidc-context.jsonld';
export const CLIENT_ID_SCOPE = 'openid webid offline_access';

export function renderClientIdDocument(extensionId: string) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chromium extension ID.');
  return {
    '@context': SOLID_OIDC_CONTEXT,
    client_id: PUBLISHED_CLIENT_ID_URL,
    client_name: 'Solid Browser Extension',
    client_uri: 'https://github.com/jeswr/solid-browser-extension',
    logo_uri: new URL('icon128.png', PUBLISHED_CLIENT_ID_URL).href,
    redirect_uris: [`https://${extensionId}.chromiumapp.org/`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: CLIENT_ID_SCOPE,
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  };
}
