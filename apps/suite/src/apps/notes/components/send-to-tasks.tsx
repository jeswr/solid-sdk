// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  toast,
} from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { classifyError } from "@/apps/tasks/lib/model/errors";
import { TaskStore } from "@/apps/tasks/lib/model/store";
import { ensurePrivateIndexAccess, ensurePrivateTasksAccess } from "@/apps/tasks/state/access";
import type { PodSession } from "@/lib/session/pod-session";
import type { ChecklistItem } from "../lib/capture";
import { type PlannedTask, plannedTasks, sendToTasks } from "../lib/tasks-handoff";

const count = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

function tasksStore(session: PodSession) {
  return new TaskStore({
    storage: session.storageUrl,
    webId: session.webId,
    fetch: session.fetch,
    ensurePrivateTasksAccess: (url, owner) => ensurePrivateTasksAccess(session, url, owner),
    ensurePrivateIndexAccess: (url, owner) => ensurePrivateIndexAccess(session, url, owner),
  });
}

type Failure = { kind: "retry"; partial: number } | { kind: "blocked"; message: string };

/**
 * Add a checklist's unchecked items to the Tasks Inbox. Task ids come from the note and
 * the item, so sending again or trying again never duplicates a task already added.
 */
export function SendToTasksDialog({
  items,
  noteKey,
  session,
  close,
  createStore = tasksStore,
}: {
  items: readonly ChecklistItem[];
  /** Stable across archive and restore: the note's file name, not its container. */
  noteKey: string;
  session: PodSession;
  close: () => void;
  createStore?: typeof tasksStore;
}) {
  const router = useRouter();
  const [store] = useState(() => createStore(session));
  const [pending, setPending] = useState<PlannedTask[]>(() => plannedTasks(items, noteKey));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [totals, setTotals] = useState({ created: 0, existing: 0 });
  const send = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await sendToTasks(store, pending, session.webId);
      const next = {
        created: totals.created + result.created,
        existing: totals.existing + result.existing,
      };
      setTotals(next);
      if (result.failed.length) {
        setPending(result.failed);
        setFailure({ kind: "retry", partial: next.created + next.existing });
        return;
      }
      close();
      toast.success(
        next.created
          ? `Added ${count(next.created)} to your Tasks Inbox${next.existing ? ` (${next.existing} already there)` : ""}`
          : "These items are already in your Tasks Inbox",
        { action: { label: "Open Tasks", onClick: () => router.push("/tasks") } },
      );
    } catch (error) {
      const category = classifyError(error, navigator.onLine);
      setFailure(
        category === "forbidden"
          ? {
              kind: "blocked",
              message: "Tasks isn't available for this account, so nothing was added.",
            }
          : category === "reauth"
            ? {
                kind: "blocked",
                message: "Your sign-in has expired. Sign in again, then try again.",
              }
            : { kind: "retry", partial: totals.created + totals.existing },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="notes-send-tasks">
        <DialogTitle>Add to Tasks</DialogTitle>
        <DialogDescription>
          Each unchecked item becomes a task in your Tasks Inbox. The note stays in Notes.
        </DialogDescription>
        <ul className="notes-send-tasks-list">
          {pending.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ul>
        {failure && (
          <p role="alert">
            {failure.kind === "blocked"
              ? failure.message
              : `${failure.partial > 0 ? `Added ${count(failure.partial)}, but ` : ""}${count(pending.length)} couldn't be added. Check your connection and try again.`}
          </p>
        )}
        <div className="notes-confirm-actions">
          <Button variant="outline" disabled={busy} onClick={close}>
            {failure?.kind === "blocked" ? "Close" : "Cancel"}
          </Button>
          {failure?.kind !== "blocked" && (
            <Button disabled={busy} onClick={() => void send()}>
              {busy ? "Adding…" : failure ? "Try again" : `Add ${count(pending.length)}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Whether a note body has any unchecked item to send. */
export const hasOpenItems = (items: readonly ChecklistItem[]) =>
  items.some((item) => !item.checked && item.text.trim());
