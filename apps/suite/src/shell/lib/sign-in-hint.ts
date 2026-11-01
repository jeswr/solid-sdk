// AUTHORED-BY Claude Opus 5.5
import type { SignInHint } from "../session/types";

/**
 * Until pod-auth's `resolveLoginTarget` lands: a URL with a path or fragment
 * names a profile document (WebID); a bare origin names a provider (issuer).
 * Anything else is passed through as an issuer for the backend to reject.
 */
export function hintFor(input: string): SignInHint {
  const value = input.trim();
  try {
    const url = new URL(value);
    if (url.hash || url.pathname !== "/") return { webId: value };
  } catch {
    /* Not a URL. */
  }
  return { issuer: value };
}
