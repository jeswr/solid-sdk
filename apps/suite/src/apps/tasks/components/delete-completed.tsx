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
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import { type ReactNode, useRef, useState } from "react";
import type { StoredProject } from "../lib/model/store";
import { deleteCompletedTasks } from "../state/bulk-actions";
import { useTasks } from "../state/tasks-context";

function useCompleted(project: StoredProject) {
  const tasks = useTasks();
  const count = tasks.views.filter(
    (view) => view.projectUrl === project.url && view.state === "closed",
  ).length;
  const load = tasks.tasks[project.url];
  const ready = load?.status === "ready" && !load.refreshing;
  return {
    count,
    enabled: ready && count > 0,
    reason: ready ? "No completed tasks" : "Loading tasks",
  };
}

function DisabledReason({
  reason,
  children,
}: {
  reason?: string | undefined;
  children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        {reason && <TooltipContent>{reason}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  );
}

/** aria-disabled keeps the explanation reachable through the menu's keyboard navigation. */
export function DeleteCompletedMenuItem({
  project,
  onSelect,
}: {
  project: StoredProject;
  onSelect: () => void;
}) {
  const { enabled, reason } = useCompleted(project);
  return (
    <DisabledReason reason={enabled ? undefined : reason}>
      <DropdownMenuItem
        aria-disabled={!enabled}
        className={enabled ? undefined : "text-muted-foreground"}
        onSelect={(event) => {
          if (enabled) onSelect();
          else event.preventDefault();
        }}
      >
        Delete completed tasks
      </DropdownMenuItem>
    </DisabledReason>
  );
}

export function DeleteCompletedDialog({
  project,
  open,
  onOpenChange,
  returnFocus,
}: {
  project: StoredProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: () => void;
}) {
  const tasks = useTasks();
  const { count, enabled } = useCompleted(project);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocus) {
            event.preventDefault();
            returnFocus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} completed tasks?</AlertDialogTitle>
          <AlertDialogDescription>
            They'll be removed from {project.tracker.title ?? "Project"}. You can undo this for a
            few seconds.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!enabled}
            onClick={() => deleteCompletedTasks(project, tasks)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteCompletedButton({ project }: { project: StoredProject }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { enabled, reason } = useCompleted(project);
  return (
    <>
      <DisabledReason reason={enabled ? undefined : reason}>
        <span tabIndex={enabled ? undefined : 0}>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            disabled={!enabled}
            onClick={() => setOpen(true)}
          >
            Delete completed tasks
          </Button>
        </span>
      </DisabledReason>
      <DeleteCompletedDialog
        project={project}
        open={open}
        onOpenChange={setOpen}
        returnFocus={() => {
          const button = trigger.current;
          if (button?.disabled) button.parentElement?.focus();
          else button?.focus();
        }}
      />
    </>
  );
}
