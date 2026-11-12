// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import { AmbiguousIssuerError, IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import { InvalidLoginAddressError, NotALoginAddressError } from "@jeswr/pod-auth/directory";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import { allowInsecureLoopback, isLoopbackHost } from "./pod-auth.js";

/** Deliberately exclude raw protocol errors, URLs, codes and token material from the UI. */
export function signInError(error: unknown): string {
  if (error instanceof InvalidLoginAddressError || error instanceof NotALoginAddressError)
    return "That address isn't a WebID or a sign-in provider.";
  if (error instanceof IssuerNotAuthorizedError)
    return "That account doesn't trust this provider. Try your own provider or your WebID.";
  if (error instanceof AmbiguousIssuerError)
    return "Your WebID lists more than one provider. Choose yours below.";
  if (
    error instanceof CodeRequestCancelledError ||
    ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError")
  )
    return "Sign-in was cancelled.";
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "That address didn't respond. Check it, or choose your provider.";
  return "We couldn't sign you in. Try again.";
}

/** Consume a deep link as a public account suggestion; it never starts login. */
export function consumeAutologinAccount(dev = false): string | null {
  const url = new URL(location.href);
  if (!url.hash.startsWith("#autologin/")) return null;
  const encoded = url.hash.slice("#autologin/".length);
  url.hash = "";
  history.replaceState(history.state, "", url.href);
  try {
    if (encoded.length > 2048) return null;
    const input = decodeURIComponent(encoded);
    if (/[\s\\]/u.test(input)) return null;
    const webId = new URL(input);
    return (webId.protocol === "https:" ||
      (webId.protocol === "http:" &&
        allowInsecureLoopback(dev) &&
        isLoopbackHost(webId.hostname))) &&
      !webId.username &&
      !webId.password
      ? webId.href
      : null;
  } catch {
    return null;
  }
}
