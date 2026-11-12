// AUTHORED-BY Claude Opus 5.5
// Access Manager now lives in Solid Suite Permissions (requests, history and sharing). The old
// entry point sends people there. `VITE_SUITE_URL` points it at another suite deployment; the
// default is the public suite. `public/clientid.jsonld` is still served, so existing Client ID
// references keep resolving.

export const DEFAULT_SUITE_URL = "https://solid-suite.vercel.app";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The suite's Permissions route; a missing, malformed or non-HTTPS setting uses the default. */
export function suitePermissionsUrl(
  configured: string | undefined = import.meta.env.VITE_SUITE_URL,
): string {
  let base: URL;
  try {
    base = new URL(configured?.trim() || DEFAULT_SUITE_URL);
  } catch {
    base = new URL(DEFAULT_SUITE_URL);
  }
  const secure =
    base.protocol === "https:" || (base.protocol === "http:" && LOOPBACK.has(base.hostname));
  if (!secure || base.username || base.password) base = new URL(DEFAULT_SUITE_URL);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  return new URL("permissions", base).href;
}

/** Replace this page in history, so Back doesn't return to the redirect. */
export function goToSuite(url: string): void {
  window.location.replace(url);
}
