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

/**
 * Add a checklist's unchecked items to the Tasks Inbox. The plan (and each task's id)
 * is fixed when the dialog opens, so Try again never duplicates a task that was created.
 */
export function SendToTasksDialog({
  items,
  session,
  close,
  createStore = tasksStore,
}: {
  items: readonly ChecklistItem[];
  session: PodSession;
  close: () => void;
  createStore?: typeof tasksStore;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PlannedTask[]>(() => plannedTasks(items));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(0);
  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await sendToTasks(createStore(session), pending, session.webId);
      const total = done + result.created;
      setDone(total);
      if (result.failed.length) {
        setPending(result.failed);
        setFailed(true);
        return;
      }
      close();
      toast.success(`Added ${count(total)} to your Tasks Inbox`, {
        action: { label: "Open Tasks", onClick: () => router.push("/tasks") },
      });
    } catch {
      setFailed(true);
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
        {failed && (
          <p role="alert">
            {done > 0 ? `Added ${count(done)}, but ` : ""}
            {count(pending.length)} couldn't be added. Check your connection and try again.
          </p>
        )}
        <div className="notes-confirm-actions">
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void send()}>
            {busy ? "Adding…" : failed ? "Try again" : `Add ${count(pending.length)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Whether a note body has any unchecked item to send. */
export const hasOpenItems = (items: readonly ChecklistItem[]) =>
  plannedTasks(items, () => "").length > 0;
