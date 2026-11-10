// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";

type AccessSession = Pick<PodSession, "fetch" | "storageUrl" | "webId"> & { mode: string };
export const supportsTasksSharing = (session: Pick<AccessSession, "mode">): boolean =>
  session.mode === "demo";
/** Real sessions wait for pod-access (SDK-APP-04); an unverified policy fails closed. */
export async function ensurePrivateTasksAccess(
  session: AccessSession,
  target: string,
  owner: string,
): Promise<boolean> {
  if (!supportsTasksSharing(session) || owner !== session.webId) return false;
  try {
    const root = new URL(session.storageUrl);
    let url = new URL(target);
    if (
      url.origin !== root.origin ||
      !url.pathname.startsWith(root.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    for (;;) {
      let response = await session.fetch(url.href, { method: "HEAD", redirect: "manual" });
      if (response.status === 405 || response.status === 501)
        response = await session.fetch(url.href, { redirect: "manual" });
      if (response.ok) return response.headers.get("X-Solid-Demo-Access-Control") === "none";
      if (response.status !== 404 || url.href === root.href) return false;
      url = new URL(url.pathname.endsWith("/") ? "../" : "./", url);
      if (!url.pathname.startsWith(root.pathname)) return false;
    }
  } catch {
    return false;
  }
}
export const ensurePrivateIndexAccess = ensurePrivateTasksAccess;
