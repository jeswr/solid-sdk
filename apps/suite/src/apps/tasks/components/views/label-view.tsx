// AUTHORED-BY Codex GPT-6
"use client";
import { usePathname } from "next/navigation";
import { unionLabels } from "../../lib/model/tracker";
import { compareTasks } from "../../lib/views/project-groups";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { CrossProjectView } from "./cross-project-view";
export function LabelView({ label }: { label: string }) {
  const { views, projects } = useTasks();
  const { preferences } = useTasksPreferences();
  const path = usePathname();
  const ids = new Set(
    (unionLabels(projects.map((project) => project.tracker)).get(label.toLowerCase()) ?? []).map(
      (category) => category.id,
    ),
  );
  const rows = views
    .filter((task) => task.state === "open" && task.labelIds.some((id) => ids.has(id)))
    .sort(compareTasks(preferences.sort[path] ?? "manual"));
  return (
    <CrossProjectView
      title={`@${label}`}
      rows={rows}
      emptyTitle={`No tasks with @${label}`}
      emptyBody="Tasks with this label will show up here"
    />
  );
}
