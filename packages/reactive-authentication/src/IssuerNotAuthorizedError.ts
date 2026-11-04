// AUTHORED-BY Codex GPT-6.1-Sol
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

/** The WebID profile does not list the issuer that returned this identity. */
export class IssuerNotAuthorizedError extends ReactiveAuthenticationError {
  readonly webId: string;
  readonly issuer: string;

  constructor(webId: string, issuer: string) {
    super(`${issuer} is not listed as a sign-in provider for ${webId}`);
    this.name = "IssuerNotAuthorizedError";
    this.webId = webId;
    this.issuer = issuer;
  }
}
