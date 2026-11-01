// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { Sun } from "lucide-react";
import { useState } from "react";
import { todayGroups } from "../../lib/views/today";
import type { TaskView } from "../../lib/views/types";
import { openAddTask } from "../../state/add-focus";
import { useNow } from "../../state/clock";
import { useTasks } from "../../state/tasks-context";
import { rescheduleTasks } from "../../state/view-actions";
import { CrossProjectView } from "./cross-project-view";
import { ReschedulePopover } from "./reschedule-popover";
import { ViewGroup } from "./view-group";

export function TodayView() {
  const tasks = useTasks();
  const now = useNow();
  const groups = todayGroups(tasks.views, now);
  const [reschedule, setReschedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<TaskView[]>([]);
  const rows = [...groups.overdue, ...groups.today];
  return (
    <CrossProjectView
      title="Today"
      rows={rows}
      subtitle={`${now.toLocaleDateString("en-GB", { weekday: "long" })}, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
      emptyTitle="Nothing due today"
      emptyBody="Enjoy the quiet, or add a task for today"
      emptyIcon={<Sun size={24} strokeWidth={1.5} aria-hidden="true" />}
      emptyAction={
        <Button className="tsk-empty-add" onClick={() => openAddTask()}>
          Add task
        </Button>
      }
    >
      {groups.overdue.length > 0 && (
        <ViewGroup
          title="Overdue"
          rows={groups.overdue}
          collapsible
          destructive
          actions={
            <ReschedulePopover
              open={reschedule}
              onOpenChange={setReschedule}
              onSelect={(dayKey) => {
                setBusy(true);
                void rescheduleTasks(groups.overdue, dayKey, tasks)
                  .then((result) => {
                    setFailures(result.failed.map(({ item }) => item));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-haspopup="dialog"
                aria-expanded={reschedule}
                onClick={() => setReschedule(true)}
              >
                Reschedule all
              </Button>
            </ReschedulePopover>
          }
        />
      )}
      {failures.length > 0 && (
        <div role="alert">
          <p>Couldn't reschedule these tasks:</p>
          <ul>
            {failures.map((task) => (
              <li key={task.url}>{task.title}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 && <ViewGroup title="Today" rows={groups.today} />}
    </CrossProjectView>
  );
}
