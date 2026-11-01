// AUTHORED-BY Codex GPT-6
"use client";
import { usePathname } from "next/navigation";
import { compareTasks } from "../../lib/views/project-groups";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { CrossProjectView } from "./cross-project-view";
export function CompletedView() {
  const { views } = useTasks();
  const { preferences } = useTasksPreferences();
  const path = usePathname();
  const rows = views
    .filter((task) => task.state === "closed")
    .sort(
      preferences.sort[path] && preferences.sort[path] !== "manual"
        ? compareTasks(preferences.sort[path])
        : (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    );
  return (
    <CrossProjectView
      title="Completed"
      rows={rows}
      emptyTitle="Nothing completed yet"
      emptyBody="Completed tasks will show up here"
    />
  );
}
