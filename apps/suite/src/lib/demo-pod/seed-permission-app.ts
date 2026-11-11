// AUTHORED-BY Codex GPT-6.1-Sol
import { DEMO_ROOT } from "./constants";
import type { DemoSeedFile } from "./pod";

export const DEMO_APP_CLIENT_ID = `${DEMO_ROOT}apps/notenest/client-id.jsonld`;
export const DEMO_APP_LOGO = `${DEMO_ROOT}apps/notenest/logo.svg`;

/** Public app metadata, served as JSON by the in-browser pod. */
export function seedPermissionApp(now: number): DemoSeedFile[] {
  return [
    {
      path: "apps/notenest/client-id.jsonld",
      // Client metadata is consumed as JSON, without expanding its remote context.
      contentType: "application/json",
      modified: now,
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/solid/oidc-context.jsonld",
        client_id: DEMO_APP_CLIENT_ID,
        client_name: "NoteNest",
        client_uri: `${DEMO_ROOT}apps/notenest/`,
        logo_uri: DEMO_APP_LOGO,
        redirect_uris: [`${DEMO_ROOT}apps/notenest/callback`],
        scope: "openid webid",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    },
    {
      path: "apps/notenest/logo.svg",
      contentType: "image/svg+xml",
      modified: now,
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" rx="12" fill="#176b59"/><path d="M16 39V17h6l12 15V17h6v22h-6L22 24v15z" fill="white"/></svg>',
    },
  ];
}
