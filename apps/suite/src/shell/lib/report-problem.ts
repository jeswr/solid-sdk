// AUTHORED-BY Codex GPT-6.1-Sol
/** Redact before truncating, so a cut-off URL cannot escape the scrubber. */
export function redact(text: string): string {
  return text
    .replace(/\b(?:https?|wss?|file):[^\s<>"'`]+/giu, "<redacted>")
    .replace(
      /(?:"(?:[^"\\\r\n]|\\.)+"|[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+)@(?:[\p{L}\p{N}.-]+|\[[^\]\s]+\])/giu,
      "<redacted>",
    )
    .replace(/#[\p{L}\p{N}_-]+/gu, "<redacted>");
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
  const details = error instanceof Error ? error.message : error;
  const context = redact(
    `App: ${app}\nRoute: ${routePattern(route)}\nError ID: ${errorId ?? "Not available"}\n${details ?? ""}`,
  );
  url.searchParams.set("labels", "suite");
  url.searchParams.set("title", redact(`Solid Suite: problem in ${app}`).slice(0, 160));
  url.searchParams.set("body", context.slice(0, 2000));
  return url.href;
}
