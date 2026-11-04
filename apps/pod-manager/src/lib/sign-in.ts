// AUTHORED-BY Codex GPT-6.1-Sol
import { AmbiguousIssuerError, IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import {
  InvalidLoginAddressError,
  NotALoginAddressError,
  classifyLoginInput,
} from "@jeswr/pod-auth/directory";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import { allowInsecureLoopback } from "./auth-environment";
import { PopupBlockedError, PopupTimeoutError } from "./popup-login";

/** A WebID lists several providers: the session provider offers them, keeping the WebID. */
export class IssuerChoiceRequiredError extends AmbiguousIssuerError {
  constructor(readonly issuers: readonly string[]) {
    super();
  }
}

/** Never display protocol error text, callback codes or credentials. */
export function signInError(error: unknown): string {
  if (error instanceof InvalidLoginAddressError || error instanceof NotALoginAddressError)
    return "That address isn't a WebID or a sign-in provider.";
  if (error instanceof IssuerNotAuthorizedError)
    return "That account doesn't trust this provider. Try your own provider or your WebID.";
  if (error instanceof AmbiguousIssuerError)
    return "Your WebID lists more than one provider. Choose yours below.";
  if (error instanceof PopupBlockedError)
    return "Your browser blocked the sign-in window. Allow popups for this site and try again.";
  if (
    error instanceof CodeRequestCancelledError ||
    (error instanceof Error && error.name === "AbortError")
  )
    return "Sign-in was cancelled.";
  if (error instanceof PopupTimeoutError) return "The sign-in window was open too long. Try again.";
  if (error instanceof Error && error.name === "TimeoutError")
    return "That address didn't respond. Check it, or choose your provider.";
  return "We couldn't sign you in. Try again.";
}

/** Deep links suggest an account and always require a click. Also retain the existing ?webid link. */
export function consumeSuggestedAccount(): string | undefined {
  const url = new URL(location.href);
  let input = url.searchParams.get("webid");
  if (url.hash.startsWith("#autologin/")) {
    const encoded = url.hash.slice("#autologin/".length);
    url.hash = "";
    history.replaceState(history.state, "", url.href);
    try {
      input = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }
  if (
    !input ||
    input.length > 2048 ||
    classifyLoginInput(input, {
      allowInsecureLoopback: allowInsecureLoopback(),
    }) === "invalid"
  )
    return undefined;
  return new URL(input.trim()).href;
}
