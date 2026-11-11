// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Where the suite opens after sign-in (02-suite-shell §1).
 */
export const START_PAGE = "/home";
/** The start page's app name, for "Go to …" links (server components cannot read the registry). */
export const START_PAGE_NAME = "Home";

/** Validate both the supplied path and its decoded form before handing it to the router. */
export function safeNext(next: string | null | undefined): string {
  if (!next) return START_PAGE;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return START_PAGE;
  }
  for (const value of [next, decoded]) {
    // Encoded delimiters and dot segments can become a network-path reference after normalisation.
    if (
      !value.startsWith("/") ||
      value.includes("//") ||
      /[\\\p{Cc}]/u.test(value) ||
      /%/u.test(decoded)
    )
      return START_PAGE;
  }
  return next;
}
