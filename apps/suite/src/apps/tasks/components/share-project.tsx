// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import { encodeRef } from "@/lib/refs";
import { ShareDialog } from "../../../shell/share";
import type { StoredProject } from "../lib/model/store";
import { tasksShareCapabilities } from "../lib/share/adapter";
import { useTasks } from "../state/tasks-context";

export function ShareProject({
  project,
  onClose,
}: {
  project: StoredProject;
  onClose: () => void;
}) {
  const tasks = useTasks();
  const name = project.tracker.title ?? "Project";
  return (
    <ShareDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      url={project.url}
      name={name}
      kind="folder"
      adapter={tasks.shareAdapter(project)}
      caps={tasksShareCapabilities}
      suiteHref={new URL(`/tasks/p/${encodeRef(project.url)}`, window.location.href).href}
      onPeopleAdded={(count) => toast.success(`Shared ${name} with ${count} people`)}
    />
  );
}
