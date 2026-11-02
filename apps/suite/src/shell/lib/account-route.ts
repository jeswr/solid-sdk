// AUTHORED-BY Codex GPT-6.1-Sol
import { appForPath } from "./registry";

/** Resource references belong to their resource, rather than to the active account. */
export function routeAfterSwitch(pathname: string): string {
  const path = pathname.split(/[?#]/u)[0] as string;
  if (
    /^\/(?:drive\/(?:f|p)|docs\/d|home\/[^/]+\/i|permissions\/a|tasks\/p)\/[^/]+(?:\/|$)/u.test(
      path,
    ) ||
    path === "/search" ||
    path === "/settings" ||
    path.startsWith("/settings/")
  )
    return pathname;
  return appForPath(path)?.basePath ?? "/home";
}
