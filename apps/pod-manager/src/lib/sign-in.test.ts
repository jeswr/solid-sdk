// AUTHORED-BY Codex GPT-6.1-Sol
import { AmbiguousIssuerError, IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import { InvalidLoginAddressError, NotALoginAddressError } from "@jeswr/pod-auth/directory";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import { describe, expect, it } from "vitest";
import { PopupBlockedError, PopupTimeoutError } from "./popup-login";
import { signInError } from "./sign-in";

describe("safe sign-in error copy", () => {
  it.each([
    [new InvalidLoginAddressError("secret"), "That address isn't a WebID or a sign-in provider."],
    [new NotALoginAddressError("secret"), "That address isn't a WebID or a sign-in provider."],
    [
      new IssuerNotAuthorizedError("https://account.example/#me", "https://provider.example/"),
      "That account doesn't trust this provider. Try your own provider or your WebID.",
    ],
    [new AmbiguousIssuerError(), "Your WebID lists more than one provider. Choose yours below."],
    [
      new CodeRequestCancelledError(new URL("https://provider.example/authorize?code=secret")),
      "Sign-in was cancelled.",
    ],
    [new DOMException("secret", "AbortError"), "Sign-in was cancelled."],
    [
      new DOMException("secret", "TimeoutError"),
      "That address didn't respond. Check it, or choose your provider.",
    ],
    [new PopupTimeoutError(), "The sign-in window was open too long. Try again."],
    [
      new PopupBlockedError(),
      "Your browser blocked the sign-in window. Allow popups for this site and try again.",
    ],
    [new Error("secret"), "We couldn't sign you in. Try again."],
    ["secret", "We couldn't sign you in. Try again."],
    [null, "We couldn't sign you in. Try again."],
  ])("maps %s without revealing the error text", (error, message) => {
    expect(signInError(error)).toBe(message);
    expect(signInError(error)).not.toContain("secret");
  });
});
