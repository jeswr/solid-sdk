// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Sun } from "lucide-react";
import { useRoutePathname } from "@/lib/route-params";
import { dueDate, localDay } from "../../lib/format/due";
import { compareTasks } from "../../lib/views/project-groups";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { CrossProjectView } from "./cross-project-view";
export function TodayView() {
  const { views } = useTasks();
  const { preferences } = useTasksPreferences();
  const path = useRoutePathname();
  const today = localDay(useNow());
  const rows = views
    .filter((task) => {
      const due = dueDate(task);
      return task.state === "open" && due && localDay(due) <= today;
    })
    .sort(compareTasks(preferences.sort[path] ?? "due"));
  return (
    <CrossProjectView
      title="Today"
      rows={rows}
      emptyTitle="Nothing due today"
      emptyIcon={<Sun size={24} strokeWidth={1.5} aria-hidden="true" />}
      emptyBody="Enjoy the quiet, or add a task for today"
    />
  );
}
