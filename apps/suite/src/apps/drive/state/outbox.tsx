// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * Drive's adoption of the shell outbox (sst-8xm.74.1). Drive queues only guarded
 * changes, and registers, for exactly the active session, the policy that requires
 * that guard inside Drive's root and the delegate that replays it through Drive's own client.
 */
import type { QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import { useEffect } from "react";
import { useOutboxSession } from "@/shell/sync/outbox-session";
import type { PodSession } from "../../../lib/session/pod-session";
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

/** Run a registration that throws once the session has ended; the next session registers again. */
function register(run: () => () => void): () => void {
  try {
    return run();
  } catch {
    return () => {};
  }
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
    return register(() => outbox.registerGuardPolicy(DRIVE_TAG, driveGuardPolicy(driveRoot)));
  }, [outbox, matches, driveRoot]);
  const storage = outbox?.storage;
  useEffect(() => {
    if (!outbox || !matches || !storage) return;
    const off = register(() => outbox.registerReplayDelegate(DRIVE_TAG, driveReplayDelegate()));
    // Items queued while Drive was closed waited for this delegate; replay them now.
    if (navigator.onLine !== false)
      void outbox.adapter.reconnected().catch(() => {
        // Durable failures stay visible in the sync sheet.
      });
    return off;
  }, [outbox, matches, storage]);
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
