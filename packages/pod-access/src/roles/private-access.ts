// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { readGrants, setGrants } from "./client.js";

export interface PrivateAccessSession {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  webId: string;
  mode: string;
}
/** Verify the isolated demo backend. Real storage must use its effective access model. */
export async function verifyPrivateDemoAccess(
  session: PrivateAccessSession,
  target: string,
  owner: string,
): Promise<boolean> {
  if (session.mode !== "demo" || owner !== session.webId) return false;
  try {
    const root = new URL(session.storageUrl);
    let url = new URL(target);
    url = new URL(assertWithinPodScope(root.href, url.href));
    if (url.search || url.hash) return false;
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
/** Provision an empty container before writing private contents; verify the resulting grants. */
export async function ensurePrivateContainerAccess(
  session: PrivateAccessSession,
  target: string,
): Promise<boolean> {
  if (session.mode === "demo") return verifyPrivateDemoAccess(session, target, session.webId);
  assertWithinPodScope(session.storageUrl, target);
  const options = {
    fetch: session.fetch,
    root: session.storageUrl,
    webId: session.webId,
    kind: "folder" as const,
    ownOnly: true,
  };
  const result = await setGrants(
    [target],
    [
      {
        agent: { type: "webid", id: session.webId },
        role: "manager",
        inherited: false,
        source: target,
      },
    ],
    options,
  );
  if (result.failed.length) return false;
  const { grants } = await readGrants(target, options);
  return (
    grants.length > 0 &&
    grants.every(
      (grant) =>
        !grant.inherited &&
        grant.role === "manager" &&
        grant.agent.type === "webid" &&
        grant.agent.id === session.webId,
    )
  );
}
