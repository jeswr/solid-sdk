// AUTHORED-BY Claude Opus 5.5
/** Drive's outbox guard tags and the session policy that requires them (sst-8xm.74.1). */
import type { GuardPolicy, OutboxGuard } from "@jeswr/suite-sdk/offline";
import type { EndpointCapture } from "../client/access";

export const DRIVE_FOLDER_TAG = "drive.folder";
export const DRIVE_TEXT_TAG = "drive.text";

/** The guard a queued text save carries: its validator's access discovery, as JSON. */
export function textGuard(discovery: EndpointCapture): OutboxGuard {
  const { endpoint, wacHeaders, mode } = discovery;
  return {
    tag: DRIVE_TEXT_TAG,
    assertions: { discovery: { endpoint, wacHeaders: [...wacHeaders], mode } },
  };
}
export const folderGuard: OutboxGuard = { tag: DRIVE_FOLDER_TAG };

function inside(storageUrl: string, url: string | undefined): url is string {
  if (!url) return false;
  try {
    const root = new URL(storageUrl);
    const target = new URL(url);
    const base = root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`;
    return (
      target.origin === root.origin &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash &&
      target.pathname.startsWith(base) &&
      !/%2f|%5c/i.test(target.pathname) &&
      !target.pathname.split("/").some((segment) => segment === "." || segment === "..")
    );
  } catch {
    return false;
  }
}
const isPolicyDocument = (url: string) => /\.(acl|acr|meta)$/i.test(new URL(url).pathname);

/**
 * Which queued operations must carry a Drive guard. Registered for the session, it makes
 * the outbox refuse an unguarded Drive-shaped write and refuse a guarded one outside
 * what Drive queues: text writes to files and folder creates, inside this storage.
 */
export function driveGuardPolicy(tag: string, storageUrl: string): GuardPolicy {
  return ({ op, url, container }) => {
    if (tag === DRIVE_TEXT_TAG) {
      if (op === "write")
        return inside(storageUrl, url) && !url.endsWith("/") && !isPolicyDocument(url);
      // "Keep both" stores the queued text as a sibling file.
      return op === "create" && inside(storageUrl, container) && container.endsWith("/");
    }
    if (tag === DRIVE_FOLDER_TAG)
      return op === "create" && inside(storageUrl, container) && container.endsWith("/");
    return false;
  };
}
