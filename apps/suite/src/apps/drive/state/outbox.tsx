// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * Drive's adoption of the shell outbox (sst-8xm.74.1). Drive queues only guarded
 * changes, and registers, for exactly the active session, the policy that requires
 * that guard inside Drive's root and the delegate that replays it through Drive's own client.
 */
import type { QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import { toast } from "@jeswr/suite-ui";
import { useEffect } from "react";
import { useOutboxSession } from "@/shell/sync/outbox-session";
import type { PodSession } from "../../../lib/session/pod-session";
import { nameOf } from "../lib/client/client";
import { DRIVE_TAG, driveGuardPolicy } from "../lib/offline/guards";
import { driveReplayDelegate } from "../lib/offline/replay";

/** The queueing storage for this Drive session's own account, or none. */
export function useDriveOutbox(session: PodSession): QueueingStorageClient | null {
  const outbox = useOutboxSession();
  if (
    !outbox?.storage ||
    session.mode === "demo" ||
    outbox.account.webId !== session.webId ||
    outbox.account.storageUrl !== session.storageUrl
  )
    return null;
  return outbox.storage;
}

/** A queued folder synced onto a folder that already had its name; that folder is used. */
function existingFolder(url: string) {
  toast.info(`A folder named "${nameOf(url)}" already existed, so Drive used it.`);
}

const registrations = new WeakMap<object, Map<string, { count: number; off: () => void }>>();

/**
 * Share one registration per outbox between Drive's mounted providers (Drive and its share
 * screen each mount one). The outbox refuses a second registration of a tag, and the first
 * provider's cleanup must not remove what the other still relies on, so the last one out
 * unregisters. A registration refused because the session ended is a no-op; the next
 * session registers again.
 */
function register(outbox: object, key: string, run: () => () => void): () => void {
  const entries = registrations.get(outbox) ?? new Map();
  registrations.set(outbox, entries);
  let entry = entries.get(key);
  if (!entry) {
    try {
      entry = { count: 0, off: run() };
    } catch {
      return () => {};
    }
    entries.set(key, entry);
  }
  const held = entry;
  held.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0) return;
    entries.delete(key);
    held.off();
  };
}

/** Register Drive's guard policy and replay delegate; refresh listings after replay. */
export function useDriveReplay(
  session: PodSession,
  driveRoot: string | undefined,
  invalidate: (url: string) => void,
) {
  const outbox = useOutboxSession();
  const matches =
    !!outbox &&
    session.mode !== "demo" &&
    outbox.account.webId === session.webId &&
    outbox.account.storageUrl === session.storageUrl;
  // The policy applies as soon as Drive's root is known, including while storage opens.
  useEffect(() => {
    if (!outbox || !matches || !driveRoot) return;
    return register(outbox, `policy ${driveRoot}`, () =>
      outbox.registerGuardPolicy(DRIVE_TAG, driveGuardPolicy(driveRoot)),
    );
  }, [outbox, matches, driveRoot]);
  const storage = outbox?.storage;
  useEffect(() => {
    // The delegate is confined to Drive's root, so it waits for the root too.
    if (!outbox || !matches || !storage || !driveRoot) return;
    const off = register(outbox, `delegate ${driveRoot}`, () =>
      outbox.registerReplayDelegate(
        DRIVE_TAG,
        driveReplayDelegate({ root: driveRoot, onExistingFolder: existingFolder }),
      ),
    );
    // Items queued while Drive was closed waited for this delegate; replay them now.
    if (navigator.onLine !== false)
      void outbox.adapter.reconnected().catch(() => {
        // Durable failures stay visible in the sync sheet.
      });
    return off;
  }, [outbox, matches, storage, driveRoot]);
  const adapter = matches ? outbox?.adapter : undefined;
  useEffect(() => {
    if (!adapter) return;
    let synced = adapter.getSnapshot().lastSyncedAt;
    return adapter.subscribe(() => {
      const next = adapter.getSnapshot().lastSyncedAt;
      if (next === synced) return;
      synced = next;
      // Queueing or retrying alone must not disturb an offline listing.
      invalidate(session.storageUrl);
    });
  }, [adapter, invalidate, session.storageUrl]);
}
