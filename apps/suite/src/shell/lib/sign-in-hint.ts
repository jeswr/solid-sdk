// AUTHORED-BY Claude Opus 5.5
import type { SignInHint } from "../session/types";

/**
 * The sign-in card's fields say what the person typed: the WebID field names a profile,
 * the provider field names an issuer. Never re-guess from the URL's shape: a provider
 * can live under a path (`/realms/solid`) and a WebID can be a bare origin.
 */
export function hintForField(field: "webid" | "provider", input: string): SignInHint {
  const value = input.trim();
  return field === "webid" ? { webId: value } : { issuer: value };
}

/** Only issuers belong in the remembered-provider list, never a person's WebID. */
export function rememberedIssuer(hint: SignInHint): string | null {
  return "issuer" in hint ? hint.issuer : null;
}
