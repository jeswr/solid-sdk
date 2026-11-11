// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from "@jeswr/suite-ui";
import { Ellipsis, Filter } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { unionLabels } from "../lib/model/tracker";
import {
  type FilterDue,
  type FilterQuery,
  type SavedFilter,
  savedFilters,
} from "../lib/views/filter-query";
import type { PriorityLevel } from "../lib/views/types";
import { useTasks } from "../state/tasks-context";
import "./filters.css";

export const filterHref = (iri: string) => `/tasks/filters/${iri.split("#view-")[1]}`;

/** Uncontrolled form values remain editable drafts until a validated conditional write. */
function FilterDialog({
  filter: initialFilter,
  renameOnly = false,
  onClose,
  returnFocus,
}: {
  filter?: SavedFilter;
  renameOnly?: boolean;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const tasks = useTasks();
  const [filter] = useState(initialFilter);
  const [original] = useState(() =>
    tasks.projects
      .find((project) => project.url === tasks.inboxUrl)
      ?.tracker.savedViews.find((view) => view.iri === filter?.iri),
  );
  const router = useRouter();
  const id = useId();
  const query = filter?.query ?? { v: 1 };
  const labels = new Map(
    [...unionLabels(tasks.projects.map((project) => project.tracker))].map(([key, categories]) => [
      key,
      categories[0]?.name ?? key,
    ]),
  );
  for (const name of query.labels ?? []) labels.set(name.toLowerCase(), name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const title = renameOnly ? "Rename filter" : filter ? "Edit filter" : "New filter";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="tsk-filter-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Name a query to reopen from Filters.</DialogDescription>
        </DialogHeader>
        <form
          className="tsk-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const data = new FormData(event.currentTarget);
            const name = String(data.get("name")).trim();
            if (!name) return;
            const next: FilterQuery = renameOnly
              ? query
              : {
                  v: 1,
                  projects: data.getAll("projects").map(String),
                  labels: data.getAll("labels").map(String),
                  priorities: data.getAll("priorities").map(Number) as PriorityLevel[],
                  due: String(data.get("due")) as FilterDue,
                  text: String(data.get("text")),
                  assignedToMe: data.has("assignedToMe"),
                  includeCompleted: data.has("includeCompleted"),
                };
            setBusy(true);
            setError(false);
            void tasks.cache
              .saveFilter(name, next, filter?.iri, original)
              .then((saved) => {
                if (!saved) {
                  setError(true);
                  return;
                }
                onClose();
                if (saved && !renameOnly) router.push(filterHref(saved.iri));
              })
              .finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy}>
            <label htmlFor={`${id}-name`}>
              Filter name
              <Input id={`${id}-name`} name="name" required defaultValue={filter?.name ?? ""} />
            </label>
            {!renameOnly && (
              <>
                <fieldset className="tsk-filter-projects">
                  <legend>Projects</legend>
                  <p>Leave all projects unticked to search every project.</p>
                  {tasks.projects.map((project) => (
                    <label key={project.url}>
                      <input
                        type="checkbox"
                        name="projects"
                        value={project.url}
                        defaultChecked={query.projects?.includes(project.url)}
                      />
                      {project.tracker.title ?? "Project"}
                    </label>
                  ))}
                  {query.projects
                    ?.filter((url) => !tasks.projects.some((project) => project.url === url))
                    .map((url) => (
                      <label key={url}>
                        <input type="checkbox" name="projects" value={url} defaultChecked />
                        {url}
                      </label>
                    ))}
                </fieldset>
                <fieldset className="tsk-filter-projects">
                  <legend>Labels</legend>
                  {[...labels].map(([key, name]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        name="labels"
                        value={name}
                        defaultChecked={query.labels?.some((label) => label.toLowerCase() === key)}
                      />
                      {name}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Priorities</legend>
                  <div className="tsk-filter-priorities">
                    {[1, 2, 3, 4].map((priority) => (
                      <label key={priority}>
                        <input
                          type="checkbox"
                          name="priorities"
                          value={priority}
                          defaultChecked={query.priorities?.some((value) => value === priority)}
                        />
                        P{priority}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Due
                  <select name="due" defaultValue={query.due ?? "any"}>
                    <option value="any">Any due date</option>
                    <option value="overdue">Overdue</option>
                    <option value="today">Today</option>
                    <option value="next7">Next 7 days</option>
                    <option value="none">No due date</option>
                  </select>
                </label>
                <label htmlFor={`${id}-text`}>
                  Text contains
                  <Input id={`${id}-text`} name="text" defaultValue={query.text ?? ""} />
                </label>
                <label className="tsk-filter-check">
                  <input type="checkbox" name="assignedToMe" defaultChecked={query.assignedToMe} />
                  Assigned to me
                </label>
                <label className="tsk-filter-check">
                  <input
                    type="checkbox"
                    name="includeCompleted"
                    defaultChecked={query.includeCompleted}
                  />
                  Include completed
                </label>
              </>
            )}
          </fieldset>
          {error && <p role="alert">Couldn't save your changes. Try again.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewFilterButton() {
  const tasks = useTasks();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const inbox = tasks.projects.find((project) => project.url === tasks.inboxUrl);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="tsk-ghost"
        disabled={!inbox?.etag}
        onClick={() => setOpen(true)}
      >
        <Filter size={16} aria-hidden="true" />
        New filter
      </button>
      {open && (
        <FilterDialog onClose={() => setOpen(false)} returnFocus={() => button.current?.focus()} />
      )}
    </>
  );
}

function FilterRow({ filter }: { filter: SavedFilter }) {
  const tasks = useTasks();
  const path = useRoutePathname();
  const router = useRouter();
  const [editing, setEditing] = useState<"rename" | "edit">();
  const button = useRef<HTMLButtonElement>(null);
  const href = filterHref(filter.iri);
  const writable = Boolean(tasks.projects.find((project) => project.url === tasks.inboxUrl)?.etag);
  return (
    <li className="tsk-project-row">
      <Link href={href} aria-current={path === href ? "page" : undefined}>
        <Filter size={18} aria-hidden="true" />
        <span>{filter.name}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={button}
            className="tsk-project-actions"
            label={`Filter actions for ${filter.name}`}
            variant="ghost"
          >
            <Ellipsis size={16} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={!writable} onSelect={() => setEditing("rename")}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!writable} onSelect={() => setEditing("edit")}>
            Edit filter
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!writable}
            onSelect={() => {
              void tasks.cache.removeFilter(filter.iri).then((result) => {
                if (result && path === href) router.push("/tasks/inbox");
              });
            }}
          >
            Delete filter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <FilterDialog
          filter={filter}
          renameOnly={editing === "rename"}
          onClose={() => setEditing(undefined)}
          returnFocus={() => button.current?.focus()}
        />
      )}
    </li>
  );
}

export function FiltersSection() {
  const tasks = useTasks();
  const filters = savedFilters(
    tasks.projects.find((project) => project.url === tasks.inboxUrl)?.tracker.savedViews ?? [],
  );
  if (!filters.length) return null;
  return (
    <section aria-label="Filters">
      <h2 className="tsk-nav-heading">Filters</h2>
      <ul className="tsk-nav-list">
        {filters.map((filter) => (
          <FilterRow key={filter.iri} filter={filter} />
        ))}
      </ul>
    </section>
  );
}
