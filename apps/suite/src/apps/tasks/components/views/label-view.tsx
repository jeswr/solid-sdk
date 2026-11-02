// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  toast,
} from "@jeswr/suite-ui";
import { Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { labelUnion, labelViewGroups } from "../../lib/views/labels";
import { useTasks } from "../../state/tasks-context";
import { deleteLabel, labelTargets, renameLabel } from "../../state/view-actions";
import { CrossProjectView } from "./cross-project-view";
import { ViewGroup } from "./view-group";

export function LabelView({ label }: { label: string }) {
  const tasks = useTasks();
  const router = useRouter();
  const projects = tasks.projects.map((project) => ({
    url: project.url,
    title: project.tracker.title ?? "Project",
    labels: project.tracker.labels,
  }));
  const union = labelUnion(projects, tasks.views).find(
    (entry) => entry.key === label.toLowerCase(),
  );
  const name = union?.name ?? label;
  const groups = labelViewGroups(label, tasks.views, projects);
  const rows = groups.flatMap((group) => group.tasks);
  const targets = labelTargets(label, tasks.projects);
  const [action, setAction] = useState<"rename" | "delete">();
  const [nextName, setNextName] = useState(name);
  const nameId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const confirm = async () => {
    const selected = action;
    if (!selected || (selected === "rename" && !nextName.trim())) return;
    setBusy(true);
    setFailures([]);
    try {
      const result =
        selected === "rename"
          ? await renameLabel(label, nextName, tasks)
          : await deleteLabel(label, tasks);
      setFailures(
        result.failed.map(
          ({ item, error }) =>
            `${item.project.tracker.title ?? "Project"}: ${error instanceof Error ? error.message : "Couldn't save your changes"}`,
        ),
      );
      if (result.done.length)
        toast.success(
          `${selected === "rename" ? "Renamed" : "Deleted"} @${name} in ${result.done.length} projects`,
        );
      if (!result.failed.length) {
        setAction(undefined);
        router.replace(
          selected === "rename"
            ? `/tasks/l/${encodeURIComponent(nextName.trim().toLowerCase())}`
            : "/tasks/inbox",
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <CrossProjectView
      title={`@${name}`}
      rows={rows}
      emptyTitle={`No tasks with @${name}`}
      emptyIcon={<Tag size={24} strokeWidth={1.5} aria-hidden="true" />}
      actions={
        <div className="tsk-label-actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!targets.length || busy}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setNextName(name);
              setAction("rename");
              setFailures([]);
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!targets.length || busy}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setAction("delete");
              setFailures([]);
            }}
          >
            Delete
          </Button>
        </div>
      }
    >
      {groups.map((group) => (
        <ViewGroup
          key={group.projectUrl}
          title={group.projectTitle}
          rows={group.tasks}
          collapsible
        />
      ))}
      <AlertDialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(undefined);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "rename"
                ? `Rename @${name} in ${targets.length} projects?`
                : `Delete @${name} in ${targets.length} projects?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "rename"
                ? "This renames the label in each project listed below."
                : "This removes the label from all tasks in these projects. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="tsk-label-projects">
            {targets.map(({ project }) => (
              <li key={project.url}>{project.tracker.title ?? "Project"}</li>
            ))}
          </ul>
          {action === "rename" && (
            <label className="tsk-label-name" htmlFor={nameId}>
              Label name
              <Input
                id={nameId}
                value={nextName}
                disabled={busy}
                onChange={(event) => setNextName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && nextName.trim() && !busy) {
                    event.preventDefault();
                    void confirm();
                  }
                }}
              />
            </label>
          )}
          {failures.length > 0 && (
            <div role="alert">
              <p>Couldn't update these projects:</p>
              <ul>
                {failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (action === "rename" && !nextName.trim())}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {action === "rename" ? "Rename" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrossProjectView>
  );
}
