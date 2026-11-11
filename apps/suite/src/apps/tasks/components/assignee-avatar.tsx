// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Avatar, AvatarFallback } from "@jeswr/suite-ui";
import type { TaskView } from "../lib/views/types";
import { useTasks } from "../state/tasks-context";
export function AssigneeAvatar({ task }: { task: TaskView }) {
  const tasks = useTasks();
  const members =
    tasks.projects.find((project) => project.url === task.projectUrl)?.tracker.groupMembers ?? [];
  if (!task.assignee || members.length < 2) return null;
  let name = task.assignee;
  try {
    name = new URL(task.assignee).hostname.split(".")[0] as string;
  } catch {
    /* Use the raw IRI for foreign RDF. */
  }
  return (
    <Avatar
      className="tsk-assignee-avatar"
      title={task.assignee}
      aria-label={`Assigned to ${name}`}
    >
      <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
