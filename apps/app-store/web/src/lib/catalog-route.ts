// AUTHORED-BY Codex GPT-6
import { appUrl } from "../auth/app-url";

/** Both the hash route and the catalog document path render the catalog view. */
export function isCatalogRoute(
  url = typeof window === "undefined" ? undefined : new URL(window.location.href),
): boolean {
  if (!url) return false;
  if (url.hash === "#/catalog") return true;
  const catalogPath = new URL(appUrl("catalog", url.origin)).pathname;
  return [catalogPath, `${catalogPath}/`].includes(url.pathname);
}
