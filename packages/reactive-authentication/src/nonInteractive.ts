// AUTHORED-BY Claude Opus 5.5
import { InteractionRequiredError } from "./oauth/AccessTokenSource.js";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

/**
 * The error a session-backed provider throws for a non-interactive upgrade it cannot complete from cached
 * or refreshed credentials. Its `authorize` cannot start a sign-in by itself: the application signs in
 * through its own interactive login (or an interactive fetch) and retries the request.
 */
export function interactionRequired(source: string): InteractionRequiredError {
  return new InteractionRequiredError(source, async () => {
    throw new ReactiveAuthenticationError(
      `Sign in interactively, then retry the request (${source})`,
    );
  });
}
