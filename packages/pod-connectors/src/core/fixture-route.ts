// AUTHORED-BY Codex GPT-6
/** Shared route selection for recording and replay: longest prefix wins.
 * Match the same origin and complete path segments; preserve explicit query prefixes.
 * Equal prefixes retain array order so repeated responses keep their sequence.
 */
export function matchingFixtureRoute<T extends { readonly url: string }>(
  url: URL,
  routes: readonly T[],
): T | undefined {
  let match: T | undefined;
  let specificity = -1;
  for (const route of routes) {
    const prefix = new URL(route.url);
    if (
      url.origin === prefix.origin &&
      url.href.startsWith(prefix.href) &&
      (url.pathname === prefix.pathname ||
        url.pathname.startsWith(
          prefix.pathname.endsWith("/") ? prefix.pathname : `${prefix.pathname}/`,
        )) &&
      prefix.href.length > specificity
    ) {
      match = route;
      specificity = prefix.href.length;
    }
  }
  return match;
}
