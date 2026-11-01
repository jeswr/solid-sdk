// AUTHORED-BY Claude Opus 5.5
/** The basePath this app is served under (see next.config.ts). */
const BASE_PATH = "/__CSD_APP_SLUG__";

/**
 * Next.js strips the basePath from `request.url`, but callers mint DPoP proofs
 * against the full public URL. Re-add it so the guard's `htu` check matches.
 */
export function publicRequestUrl(request: Request): string {
  const url = new URL(request.url);
  if (url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) {
    url.pathname = `${BASE_PATH}${url.pathname}`;
  }
  return url.href;
}
