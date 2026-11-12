// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * Drive's adoption of the shell outbox (sst-8xm.74.1). Drive queues only guarded
 * changes, and registers, for exactly the active session, the policy that requires
 * those guards and the delegates that replay them through Drive's own client.
 */
import type { QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import { useEffect } from "react";
import { useOutboxSession } from "@/shell/sync/outbox-session";
import type { PodSession } from "../../../lib/session/pod-session";
import { DRIVE_FOLDER_TAG, DRIVE_TEXT_TAG, driveGuardPolicy } from "../lib/offline/guards";
import { driveReplayDelegate } from "../lib/offline/replay";

const TAGS = [DRIVE_FOLDER_TAG, DRIVE_TEXT_TAG] as const;

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

/** Register Drive's guard policies and replay delegates; refresh listings after replay. */
export function useDriveReplay(session: PodSession, invalidate: (url: string) => void) {
  const outbox = useOutboxSession();
  const matches =
    !!outbox &&
    session.mode !== "demo" &&
    outbox.account.webId === session.webId &&
    outbox.account.storageUrl === session.storageUrl;
  // Policies apply as soon as the session exists, including while its storage opens.
  useEffect(() => {
    if (!outbox || !matches) return;
    const offs = TAGS.map((tag) =>
      outbox.registerGuardPolicy(tag, driveGuardPolicy(tag, outbox.account.storageUrl)),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [outbox, matches]);
  const storage = outbox?.storage;
  useEffect(() => {
    if (!outbox || !matches || !storage) return;
    const offs = TAGS.map((tag) => outbox.registerReplayDelegate(tag, driveReplayDelegate(tag)));
    return () => {
      for (const off of offs) off();
    };
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
