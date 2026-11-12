// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import type { StorageClient } from "@jeswr/storage-client";
import { checkOwnerOnly, type OwnerOnlyResult } from "../owner-only.js";
import { setGrants } from "./client.js";

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
export interface PrivateContainerOptions {
  /**
   * True only when the caller itself just created `target` and has written nothing into it.
   * Only then are owner-only grants provisioned; any other container is verified, never
   * rewritten, so a folder someone shared on purpose keeps its collaborators.
   */
  created: boolean;
  /** The session's storage client; the effective policy is read through checkOwnerOnly. */
  storage: StorageClient;
  /**
   * Trusted ACP dialect assertion, as for createAccessClient. Absent selects CSS semantics,
   * the role writer's default; an ESS pod then fails closed (ESS modes and ACR URLs refuse).
   */
  acpDialect?: "css" | "ess" | undefined;
}
const unverified: OwnerOnlyResult = {
  private: false,
  reasons: [{ subject: "unknown", modes: [], reason: "unknown" }],
};
/**
 * Establish (when just created) or verify owner-only access for a private app container.
 * The verdict is checkOwnerOnly's fail-closed reading of the effective WAC/ACP policy,
 * including inherited ACP member policies, never the lossy role projection. Members that
 * already carry their own ACL/ACR keep it, so callers write only new member names.
 */
export async function ensurePrivateContainerAccess(
  session: PrivateAccessSession,
  target: string,
  options: PrivateContainerOptions,
): Promise<OwnerOnlyResult> {
  const url = assertWithinPodScope(session.storageUrl, target);
  const parsed = new URL(url);
  if (
    url === normalizePodBase(session.storageUrl) ||
    !parsed.pathname.endsWith("/") ||
    parsed.search ||
    parsed.hash
  )
    throw new TypeError("A private app container must be a container below the storage root");
  if (session.mode === "demo")
    return (await verifyPrivateDemoAccess(session, url, session.webId))
      ? { private: true }
      : unverified;
  if (options.created) {
    const result = await setGrants(
      [url],
      [
        {
          agent: { type: "webid", id: session.webId },
          role: "manager",
          inherited: false,
          source: url,
        },
      ],
      {
        fetch: session.fetch,
        root: session.storageUrl,
        webId: session.webId,
        kind: "folder",
        ownOnly: true,
        implementation: options.acpDialect ?? "css",
      },
    );
    if (result.failed.length) return unverified;
  }
  return checkOwnerOnly({
    storage: options.storage,
    url,
    ownerWebId: session.webId,
    acpDialect: options.acpDialect ?? "css",
  });
}
