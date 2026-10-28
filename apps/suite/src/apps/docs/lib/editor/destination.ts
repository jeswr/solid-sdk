// AUTHORED-BY Codex
import { validLink } from "./logic";

/** CommonMark URL encoding: preserve URI delimiters and existing percent escapes. */
export function normaliseDestination(input: string): string | null {
  try {
    // encodeURI predates IPv6 URI syntax and would escape its host brackets.
    // Preserve that authority; the validator still rejects malformed hosts.
    const authority = /^https?:\/\/\[[^\]]+\]/i.exec(input)?.[0] ?? "";
    const destination = (authority + encodeURI(input.slice(authority.length))).replace(
      /%25([0-9a-f]{2})/gi,
      "%$1",
    );
    return validLink(destination) ? destination : null;
  } catch {
    // encodeURI rejects unpaired UTF-16 surrogates.
    return null;
  }
}
