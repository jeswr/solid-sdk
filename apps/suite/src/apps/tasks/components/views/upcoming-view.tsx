// AUTHORED-BY Codex GPT-6
"use client";
import { CalendarRange } from "lucide-react";
import { usePathname } from "next/navigation";
import { dueDate, localDay } from "../../lib/format/due";
import { compareTasks } from "../../lib/views/project-groups";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { CrossProjectView } from "./cross-project-view";
export function UpcomingView() {
  const { views } = useTasks();
  const { preferences } = useTasksPreferences();
  const path = usePathname();
  const today = localDay(useNow());
  const rows = views
    .filter((task) => {
      const due = dueDate(task);
      return task.state === "open" && due && localDay(due) > today;
    })
    .sort(compareTasks(preferences.sort[path] ?? "due"));
  return (
    <CrossProjectView
      title="Upcoming"
      rows={rows}
      emptyTitle="Nothing upcoming"
      emptyIcon={<CalendarRange size={24} strokeWidth={1.5} aria-hidden="true" />}
      emptyBody="Tasks with a future due date will show up here"
    />
  );
}
