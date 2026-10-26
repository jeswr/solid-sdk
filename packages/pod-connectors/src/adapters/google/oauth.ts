// AUTHORED-BY Codex GPT-6.1-Sol
import type { OAuthAppConfig } from "../../core/types.js";

/** Request only the scopes for the product the user is connecting. */
export const GOOGLE_SCOPES = {
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  contacts: ["https://www.googleapis.com/auth/contacts.readonly"],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
} as const;

/** Products supported by the shared Google authorization configuration. */
export type GoogleProduct = keyof typeof GOOGLE_SCOPES;

/** Web clients keep their secret at the proxy; Desktop clients inject it locally. */
export type GoogleOAuthOptions =
  | { readonly clientType?: "web"; readonly clientId?: string; readonly tokenProxyUrl?: string }
  | { readonly clientType: "desktop"; readonly clientId: string; readonly clientSecret?: string };

/** Google auth-code + S256 PKCE configuration, with no environment or token storage. */
export function createGoogleOAuthConfig(
  product: GoogleProduct,
  options: GoogleOAuthOptions = {},
): OAuthAppConfig {
  return {
    clientId: options.clientId,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: GOOGLE_SCOPES[product],
    tokenExchange: options.clientType === "desktop" ? "public" : "proxy",
    tokenProxyUrl: options.clientType === "desktop" ? undefined : options.tokenProxyUrl,
    clientSecret: options.clientType === "desktop" ? options.clientSecret : undefined,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  };
}
