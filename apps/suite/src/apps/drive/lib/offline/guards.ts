// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
/** Drive's outbox guard and the session policy that requires it (sst-8xm.74.1). */
import type { GuardPolicy, OutboxGuard } from "@jeswr/suite-sdk/offline";
import type { EndpointCapture } from "../client/access";

/**
 * One tag for every Drive change. The outbox lets a policy require only tags other than its
 * own, so two Drive tags would each refuse the other's creates. The kind travels in the
 * assertions instead, and the replay delegate dispatches on it.
 */
export const DRIVE_TAG = "drive";
export type DriveGuardKind = "text" | "folder";

/**
 * The guard a queued text save carries: its validator's access discovery and the file it
 * saves, as JSON. A conflict's "keep both" copy is created with that file's own access, so
 * the delegate must know which file it copies; the outbox's create delivery names only the
 * folder.
 */
export function textGuard(discovery: EndpointCapture, source: string): OutboxGuard {
  const { endpoint, wacHeaders, mode } = discovery;
  return {
    tag: DRIVE_TAG,
    assertions: {
      kind: "text",
      source,
      discovery: { endpoint, wacHeaders: [...wacHeaders], mode },
    },
  };
}
export const folderGuard: OutboxGuard = { tag: DRIVE_TAG, assertions: { kind: "folder" } };

/** Whether `url` is a plain, canonical path inside `base` (a container URL). */
export function inside(base: string, url: string | undefined): url is string {
  if (!url) return false;
  try {
    const root = new URL(base);
    const target = new URL(url);
    const prefix = root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`;
    return (
      target.origin === root.origin &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash &&
      target.pathname.startsWith(prefix) &&
      !/%2f|%5c/i.test(target.pathname) &&
      !target.pathname.split("/").some((segment) => segment === "." || segment === "..")
    );
  } catch {
    return false;
  }
}

/** Replay only visible content. The guard policy still claims every path inside Drive. */
export function isDriveContent(root: string, url: string | undefined): url is string {
  if (!inside(root, url)) return false;
  // URL removes whole dot segments (including %2E) before exposing the pathname.
  if (/\/(?:\.|%2e){1,2}(?:\/|$)/i.test(url)) return false;
  try {
    const path = decodeURIComponent(new URL(url).pathname.slice(new URL(root).pathname.length));
    return (
      !path.split("/").some((segment) => segment.startsWith(".")) &&
      !/\.(acl|acr|meta)$/i.test(path)
    );
  } catch {
    return false;
  }
}

/**
 * Inside Drive's own root, every queued change must carry Drive's guard, so nothing there
 * replays through a bare storage client. Outside that root the policy claims nothing, and
 * other apps' queued changes are unaffected. The outbox never applies a policy to items with
 * its own tag: the replay delegate's re-check is what confines Drive-tagged items.
 */
export function driveGuardPolicy(driveRoot: string): GuardPolicy {
  return ({ url, container }) => inside(driveRoot, container ?? url) || inside(driveRoot, url);
}
