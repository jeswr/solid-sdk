// AUTHORED-BY Codex GPT-6.1-Sol
import { requireTitle, uniqueSlug } from "../model/rdf";
import type { Category } from "../model/tracker";
import type { TaskView } from "./types";

export interface LabelProject {
  url: string;
  title: string;
  labels: readonly Category[];
}

export interface UnionLabel {
  key: string;
  name: string;
  count: number;
  members: { projectUrl: string; labelId: string }[];
}

function carries(task: TaskView, members: UnionLabel["members"]): boolean {
  return (
    task.state === "open" &&
    members.some(
      (member) => member.projectUrl === task.projectUrl && task.labelIds.includes(member.labelId),
    )
  );
}

/** Keep the first display spelling and every tracker-local class identity. */
export function labelUnion(
  projects: readonly LabelProject[],
  tasks: readonly TaskView[],
): UnionLabel[] {
  const union = new Map<string, UnionLabel>();
  for (const project of projects)
    for (const label of project.labels) {
      const key = label.name.toLowerCase();
      let entry = union.get(key);
      if (!entry) {
        entry = { key, name: label.name, count: 0, members: [] };
        union.set(key, entry);
      }
      entry.members.push({ projectUrl: project.url, labelId: label.id });
    }
  return [...union.values()]
    .map((entry) => ({
      ...entry,
      count: tasks.filter((task) => carries(task, entry.members)).length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Preserve project/sidebar order; empty projects are omitted and task order is manual. */
export function labelViewGroups(
  key: string,
  tasks: readonly TaskView[],
  projects: readonly LabelProject[],
): { projectUrl: string; projectTitle: string; tasks: TaskView[] }[] {
  const label = labelUnion(projects, tasks).find((entry) => entry.key === key.toLowerCase());
  if (!label) return [];
  return projects.flatMap((project) => {
    const rows = tasks
      .filter((task) => task.projectUrl === project.url && carries(task, label.members))
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
    return rows.length
      ? [{ projectUrl: project.url, projectTitle: project.title, tasks: rows }]
      : [];
  });
}

/** Fragment suffix for #label-<slug>; pass occupied suffixes (including foreign subjects). */
export function labelSlug(name: string, occupied: Iterable<string> = []): string {
  requireTitle(name);
  return uniqueSlug(name, occupied);
}
