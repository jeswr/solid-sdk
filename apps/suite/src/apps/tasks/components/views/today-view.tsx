// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { Sun } from "lucide-react";
import { useRef, useState } from "react";
import { localDayKey } from "../../lib/views/days";
import { todayGroups } from "../../lib/views/today";
import type { TaskView } from "../../lib/views/types";
import { openAddTask } from "../../state/add-focus";
import { useNow } from "../../state/clock";
import { useTasks } from "../../state/tasks-context";
import { rescheduleTasks } from "../../state/view-actions";
import { CrossProjectView } from "./cross-project-view";
import { GroupedTasks } from "./grouped-tasks";
import { ReschedulePopover } from "./reschedule-popover";
import { ViewGroup } from "./view-group";

export function TodayView() {
  const tasks = useTasks();
  const now = useNow();
  const groups = todayGroups(tasks.views, now);
  const heading = useRef<HTMLHeadingElement>(null);
  const rescheduleButton = useRef<HTMLButtonElement>(null);
  const [reschedule, setReschedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<TaskView[]>([]);
  const rows = [...groups.overdue, ...groups.today];
  return (
    <CrossProjectView
      title="Today"
      headingRef={heading}
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
      <GroupedTasks rows={rows}>
        {groups.overdue.length > 0 && (
          <ViewGroup
            title="Overdue"
            rows={groups.overdue}
            collapsible
            destructive
            container={{ kind: "day" }}
            actions={
              <ReschedulePopover
                open={reschedule}
                onOpenChange={setReschedule}
                onCloseFocus={() => {
                  (rescheduleButton.current?.isConnected && !rescheduleButton.current.disabled
                    ? rescheduleButton.current
                    : heading.current
                  )?.focus();
                }}
                onSelect={(dayKey) => {
                  setBusy(true);
                  void rescheduleTasks(groups.overdue, dayKey, tasks)
                    .then((result) => {
                      setFailures(result.failed.map(({ item }) => item));
                    })
                    .finally(() => setBusy(false));
                }}
                trigger={
                  <Button
                    ref={rescheduleButton}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                  >
                    Reschedule all
                  </Button>
                }
              />
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
        {rows.length > 0 && (
          <ViewGroup
            title="Today"
            rows={groups.today}
            container={{ kind: "day", dayKey: localDayKey(now) }}
          />
        )}
      </GroupedTasks>
    </CrossProjectView>
  );
}
