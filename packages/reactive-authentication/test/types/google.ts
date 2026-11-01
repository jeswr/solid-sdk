// Compile-time check (part of `npm test`): the community Google Identity Services declarations
// (@types/google.accounts, dev-only) satisfy the structural GoogleOAuth2 contract, so applications pass
// `google.accounts.oauth2` without casts.
/// <reference types="google.accounts" />
import { type GoogleOAuth2, GoogleTokenSource } from "../../src/oauth/GoogleTokenSource.js";

const oauth2: GoogleOAuth2 = google.accounts.oauth2;
export const source = new GoogleTokenSource(google.accounts.oauth2, {
  clientId: "id.apps.googleusercontent.com",
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
export { oauth2 };
