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
  Breadcrumbs,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { encodeRef } from "@/lib/refs";
import { useRoutePathname } from "@/lib/route-params";
import type { StoredProject } from "../lib/model/store";
import { canMoveProject, projectBreadcrumb } from "../lib/projects/tree";
import { useTasks } from "../state/tasks-context";

/** Kept outside individual rows, which may unmount during an optimistic cascade. */
export function ProjectFamilyConfirmationDialog() {
  const tasks = useTasks();
  const router = useRouter();
  const path = useRoutePathname();
  const confirmation = tasks.projectFamilyConfirmation;
  if (!confirmation) return null;
  const { project, kind, children, projects } = confirmation;
  const action = kind === "archive" ? "Archive" : "Delete";
  const affected = [project, ...projects];
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) tasks.cache.dismissProjectFamilyConfirmation();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action} {project.tracker.title ?? "Untitled"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The sub-projects changed. Review the updated scope before continuing. {affected.length}{" "}
            {affected.length === 1 ? "project" : "projects"}:{" "}
            {affected.map((item) => item.tracker.title ?? "Untitled").join(", ")}.
            {children === "promote" && " Sub-projects will be moved to top level."}
            {kind === "delete" && " This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              tasks.cache.dismissProjectFamilyConfirmation();
              const scope = projects.map((item) => item.url);
              const operation =
                kind === "archive"
                  ? tasks.cache.archiveProject(project, children, scope)
                  : tasks.cache.deleteProject(project, children, scope);
              void operation.then((removed) => {
                if (
                  removed &&
                  (children === "cascade" ? affected : [project]).some((item) => {
                    const href = `/tasks/p/${encodeRef(item.url)}`;
                    return path === href || path === `${href}/board`;
                  })
                )
                  router.push("/tasks/inbox");
              });
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProjectMoveDialog({
  project,
  onClose,
  returnFocus,
}: {
  project: StoredProject;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { cache } = useTasks();
  const tree = cache.projectTree;
  const [parentUrl, setParentUrl] = useState("");
  const eligible = tree.filter((node) => canMoveProject(tree, project.url, node.project.url));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Move under…</DialogTitle>
          <DialogDescription>
            Choose a parent for {project.tracker.title}. Projects can have up to three levels.
          </DialogDescription>
        </DialogHeader>
        <label className="tsk-project-parent">
          Parent project
          <select value={parentUrl} onChange={(event) => setParentUrl(event.target.value)}>
            <option value="">Choose a project</option>
            {eligible.map(({ project: parent }) => (
              <option key={parent.url} value={parent.url}>
                {projectBreadcrumb(tree, parent.url)
                  .map((project) => project.tracker.title)
                  .join(" › ")}
              </option>
            ))}
          </select>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!eligible.some((node) => node.project.url === parentUrl)}
            onClick={() => {
              void cache.setProjectParent(project, parentUrl);
              onClose();
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectChildrenChoice({
  kind,
  value,
  onChange,
}: {
  kind: "archive" | "delete";
  value: "cascade" | "promote";
  onChange: (value: "cascade" | "promote") => void;
}) {
  return (
    <fieldset className="tsk-project-child-choice">
      <legend>Sub-projects</legend>
      {(["promote", "cascade"] as const).map((choice) => (
        <label key={choice}>
          <input
            type="radio"
            name="sub-projects"
            checked={value === choice}
            onChange={() => onChange(choice)}
          />
          {choice === "promote"
            ? "Move sub-projects to top level"
            : kind === "archive"
              ? "Also archive sub-projects"
              : "Also delete sub-projects"}
        </label>
      ))}
    </fieldset>
  );
}

export function ProjectBreadcrumb({ project }: { project: StoredProject }) {
  const { cache } = useTasks();
  const chain = projectBreadcrumb(cache.projectTree, project.url);
  if (chain.length < 2) return null;
  return (
    <Breadcrumbs
      label="Project breadcrumb"
      items={chain.map((project) => ({
        id: project.url,
        label: project.tracker.title ?? "Untitled",
        href: `/tasks/p/${encodeRef(project.url)}`,
      }))}
    />
  );
}
