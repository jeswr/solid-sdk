// AUTHORED-BY Codex GPT-6.1-Sol
/** Redact before truncating, so a cut-off URL cannot escape the scrubber. */
export function redact(text: string): string {
  return (
    text
      .replace(/\b(?:https?|wss?|file):[^\s<>"'`]+/giu, "<redacted>")
      .replace(
        /(?:"(?:[^"\\\r\n]|\\.)+"|[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+)@(?:[\p{L}\p{N}.-]+|\[[^\]\s]+\])/giu,
        "<redacted>",
      )
      .replace(/#[\p{L}\p{N}_-]+/gu, "<redacted>")
      // Credentials: bearer/DPoP headers, token-like key=value pairs and JWT-shaped strings.
      .replace(/\b(Bearer|DPoP|Basic)\s+\S+/giu, "$1 <redacted>")
      .replace(
        /\b([\w-]*(?:token|secret|password|code|key|session|cookie|authorization)[\w-]*)\s*[:=]\s*\S+/giu,
        "$1=<redacted>",
      )
      .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]*)?/gu, "<redacted>")
      // Percent-encoded identifiers (an encoded WebID or URL) and long opaque strings.
      .replace(/\S*%[0-9a-f]{2}\S*/giu, "<redacted>")
      .replace(/[\w+/=-]{32,}/gu, "<redacted>")
  );
}

/** Only a fixed-shape error type reaches the report; messages may carry private data. */
function errorType(error: string | Error | undefined): string {
  const name = error instanceof Error ? error.name : undefined;
  return name && /^[A-Za-z]{1,40}$/u.test(name) ? name : "Not available";
}
export function routePattern(route: string): string {
  const path = route.split(/[?#]/u, 1).join("");
  return path.replace(/\/(f|p|d|i|a)\/[^/]+/gu, "/$1/[ref]");
}
export function reportProblemUrl({
  app,
  route,
  error,
  errorId,
}: {
  app: string;
  route: string;
  error?: string | Error;
  errorId?: string;
}): string {
  const url = new URL("https://github.com/jeswr/solid-sdk/issues/new");
  // Allowlisted fields only (no error message, URL, query or account data), then redacted again.
  const id = errorId && /^[\w-]{1,64}$/u.test(errorId) ? errorId : "Not available";
  const context = redact(
    `App: ${app}\nRoute: ${routePattern(route)}\nError ID: ${id}\nError type: ${errorType(error)}\n\nWhat were you doing when this happened?\n`,
  );
  url.searchParams.set("labels", "suite");
  url.searchParams.set("title", redact(`Solid Suite: problem in ${app}`).slice(0, 160));
  url.searchParams.set("body", context.slice(0, 2000));
  return url.href;
}
