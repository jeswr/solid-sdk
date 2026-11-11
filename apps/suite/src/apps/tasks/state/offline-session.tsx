// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useOutbox as useDurableOutbox } from "@jeswr/suite-sdk/offline";
import { toast } from "@jeswr/suite-ui";
import { ConflictDialog } from "@jeswr/suite-ui/sync";
import { useEffect, useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { useOptionalAccounts } from "../../../shell/session/accounts-context";
import { useConnectionState } from "../../../shell/sync/connection-state";
import { useOutboxSession } from "../../../shell/sync/outbox-session";
import { TASKS_REPLAY, TasksOffline } from "./offline";
import type { TasksCache } from "./tasks-cache";

export function useTasksOffline(session: PodSession) {
  const connection = useConnectionState();
  const accounts = useOptionalAccounts();
  const shell = useOutboxSession();
  const current = useRef({ connection, shell });
  current.current = { connection, shell };
  const [offline] = useState(() => {
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {
      /* Private browsing may block it. */
    }
    return new TasksOffline({
      webId: session.webId,
      storageUrl: session.storageUrl,
      fetch: session.fetch,
      online: () => current.current.connection === "online",
      outbox: () =>
        current.current.shell?.account.webId === session.webId
          ? current.current.shell.outbox
          : null,
      storage,
    });
  });
  useEffect(
    () => () => {
      if (accounts?.active && !accounts.isActiveAccount(accounts.active.id)) offline.clear();
    },
    [accounts, offline],
  );
  useEffect(() => {
    if (!shell || shell.account.webId !== session.webId || !shell.storage) return;
    const unregister = shell.registerReplayDelegate(
      TASKS_REPLAY,
      ({ fetch }) =>
        async (delivery, ctx) => {
          const replay = new TasksOffline({
            webId: session.webId,
            storageUrl: session.storageUrl,
            fetch: (input, init) => fetch(input, { ...init, signal: ctx.signal }),
            online: () => true,
            outbox: () => shell.outbox,
            onCreate: offline.confirm,
          });
          return replay.replay(delivery, ctx);
        },
    );
    if (connection === "online") void shell.adapter.reconnected().catch(() => {});
    return unregister;
  }, [offline, shell, session, connection]);
  return offline;
}

/** Tasks conflicts open on reconnect; the same records remain available in the shell sync sheet. */
export function TasksConflicts({ cache, offline }: { cache: TasksCache; offline?: TasksOffline }) {
  const shell = useOutboxSession();
  const { pending, conflicts } = useDurableOutbox(shell?.outbox ?? null);
  const [dismissed, setDismissed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ id: string; text: string }>();
  const previous = useRef(pending);
  useEffect(() => {
    const urls = previous.current
      .filter(
        (item) => item.guard?.tag === TASKS_REPLAY && !pending.some((next) => next.id === item.id),
      )
      .map((item) => item.url);
    previous.current = pending;
    for (const url of new Set(urls)) void cache.invalidate(url);
  }, [cache, pending]);
  const conflict = conflicts.find((conflict) =>
    pending.some((item) => item.id === conflict.itemId && item.guard?.tag === TASKS_REPLAY),
  );
  const item = pending.find((item) => item.id === conflict?.itemId);
  const conflictId = conflict?.id;
  useEffect(() => {
    if (!offline || !conflictId) return;
    let active = true;
    void offline
      .conflictSummary(conflictId)
      .then((text) => {
        if (active) setSummary({ id: conflictId, text });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [offline, conflictId]);
  return (
    <ConflictDialog
      open={!!conflict && dismissed !== conflict.id && !busy}
      onOpenChange={(open) => {
        if (!open) setDismissed(conflict?.id);
      }}
      conflict={
        conflict
          ? {
              id: conflict.id,
              name: item?.label ?? "Task",
              where: "Tasks",
              summary:
                summary?.id === conflict.id
                  ? summary.text
                  : "Title, due date or completion changed elsewhere",
              changedAt: new Date(item?.createdAt ?? 0),
            }
          : null
      }
      onChoose={(choice) => {
        if (!shell || !conflict || busy) return;
        setBusy(true);
        void shell.adapter
          .resolve(conflict.id, choice)
          .catch(() => toast.error("Couldn't sync this change. It is still saved on this device."))
          .finally(() => setBusy(false));
      }}
    />
  );
}
