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
  DialogTrigger,
  Input,
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import {
  GoogleTasksImportError,
  type GoogleTasksImportErrorCode,
  type ProjectImportDraft,
} from "../../lib/google-tasks";
import { parseTaskImport } from "../../lib/import/file";
import { type ImportWarning, importWarnings } from "../../lib/import/mapping";
import {
  MAX_TODOIST_CSV_BYTES,
  TodoistImportError,
  type TodoistImportErrorCode,
} from "../../lib/todoist";
import { importProject } from "../../state/import-project";
import { useTasks } from "../../state/tasks-context";
import "./import.css";

const errors: Record<TodoistImportErrorCode, string> = {
  INVALID_CSV: "This file is not a valid Todoist CSV. Choose another file.",
  CSV_TOO_LARGE: "This CSV has too many rows or is larger than 4 MiB. Choose a smaller file.",
  INVALID_INDENT: "The sub-task indentation is invalid. Check the file and try again.",
  INVALID_PRIORITY: "A task priority is invalid. Use priorities from 1 to 4.",
  INVALID_DURATION: "A task duration is invalid. Check the file and try again.",
  INVALID_DATE: "A date is invalid or ambiguous. Check the dates and try again.",
  INVALID_TIMEZONE:
    "A time zone is invalid or there are too many time zones. Check the file and try again.",
};
const googleErrors: Record<GoogleTasksImportErrorCode, string> = {
  INVALID_JSON: "This file is not valid Google Tasks JSON. Choose another file.",
  INVALID_DATA:
    "This file is not a supported Google Tasks export. Choose Tasks.json from Google Takeout.",
  INVALID_DATE: "A Google task date is invalid. Check the dates and try again.",
  INVALID_HIERARCHY: "The Google task hierarchy is invalid. Check the file and try again.",
  JSON_TOO_LARGE: "This JSON is larger than 4 MiB. Choose a smaller file.",
  JSON_TOO_DEEP: "This JSON is nested too deeply. Choose another file.",
  TOO_MANY_LISTS: "This export has too many task lists. Choose a smaller file.",
  TOO_MANY_TASKS: "This export has too many tasks. Choose a smaller file.",
};
const warnings: Record<ImportWarning["code"], string> = {
  UNKNOWN_TYPE: "An unrecognised row was skipped.",
  ORPHAN_NOTE: "A note without a task was skipped.",
  UNPARSED_DATE:
    "A date could not be interpreted. Its text will be kept in the task description; no due date or repeat will be set.",
  UNRESOLVED_AUTHOR:
    "A task author could not be matched to an account. The name will be kept as labelled text in the task description.",
  UNRESOLVED_RESPONSIBLE:
    "A responsible person could not be matched to an account. The name will be kept as labelled text in the task description; no assignee will be set.",
  DURATION_TEXT: "Durations will be kept as labelled text in the task description.",
  DATE_LANGUAGE_TEXT: "Date language will be kept as labelled text in the task description.",
  NOTE_AUTHOR_TEXT:
    "Note authors will be kept as labelled text beside their notes in the task description.",
  SECTION_DESCRIPTION:
    "Section descriptions will be kept as labelled text in the project description.",
  DELETED_TASK: "A deleted task was skipped.",
  HIDDEN_COMPLETED: "A hidden completed task will be imported as completed.",
  UNKNOWN_PARENT: "A task with an unknown parent will be imported as a top-level task.",
  DEPTH_FLATTENED: "A nested sub-task will be imported under its top-level parent.",
};

interface ImportSelection {
  id: string;
  draft: ProjectImportDraft;
  name: string;
  checked: boolean;
}

export function TasksImportDialog() {
  const { cache } = useTasks();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ImportSelection[]>([]);
  const [kind, setKind] = useState<"todoist" | "google">("todoist");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [cancelling, setCancelling] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      ++generation.current;
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const busy = progress !== undefined;
  const previewWarnings = useMemo(
    () => projects.flatMap(({ draft }) => importWarnings(draft)),
    [projects],
  );
  const selected = projects.filter((project) => project.checked);
  const count = selected.reduce((total, { draft }) => total + draft.tasks.length, 0);
  function change(index: number, patch: Partial<Pick<ImportSelection, "name" | "checked">>) {
    setProjects((current) =>
      current.map((project, i) => (i === index ? { ...project, ...patch } : project)),
    );
  }
  function close(next: boolean) {
    if (!next && controller.current) {
      controller.current.abort();
      setCancelling(true);
      return;
    }
    ++generation.current;
    setOpen(next);
    setProjects([]);
    setKind("todoist");
    setError("");
    setReading(false);
  }
  async function pick(file: File) {
    if (controller.current) return;
    const request = ++generation.current;
    setProjects([]);
    setError("");
    setReading(true);
    try {
      if (file.size > MAX_TODOIST_CSV_BYTES) {
        setError("This file is larger than 4 MiB. Choose a smaller file.");
        return;
      }
      const text = await file.text();
      if (request !== generation.current) return;
      const parsed = parseTaskImport(text, {
        name: file.name,
        type: file.type,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setKind(parsed.kind);
      setProjects(
        parsed.projects.map((draft) => ({
          id: crypto.randomUUID(),
          draft,
          name: draft.name,
          checked: true,
        })),
      );
    } catch (cause) {
      if (request === generation.current)
        setError(
          cause instanceof TodoistImportError
            ? errors[cause.code]
            : cause instanceof GoogleTasksImportError
              ? googleErrors[cause.code]
              : "Could not read this file. Choose a Todoist .csv or Google Tasks .json file.",
        );
    } finally {
      if (request === generation.current) setReading(false);
    }
  }
  async function start() {
    if (!selected.length || selected.some(({ name }) => !name.trim()) || controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setProgress(0);
    setCancelling(false);
    try {
      const created: { title: string; href: string }[] = [];
      let imported = 0;
      let failed = 0;
      let offset = 0;
      for (const { draft, name } of selected) {
        if (job.signal.aborted) break;
        const result = await importProject(cache, draft, name.trim(), job.signal, (done) => {
          if (controller.current === job) setProgress(offset + done);
        });
        // An empty list still needs its project; zero task failures cannot signal setup failure.
        if (!result.project && !job.signal.aborted && !draft.tasks.length)
          throw new Error("Project creation failed");
        imported += result.imported;
        failed += result.failed;
        offset += draft.tasks.length;
        if (result.project)
          created.push({ title: name.trim(), href: `/tasks/p/${encodeRef(result.project.url)}` });
      }
      const title = selected.length === 1 ? selected[0]?.name.trim() : `${created.length} projects`;
      const links = created.map(({ title, href }) => (
        <Link key={href} href={href}>
          Open {title}
        </Link>
      ));
      const description =
        links.length > 1 ? <div className="tsk-import-links">{links}</div> : links[0];
      if (failed)
        toast.error(`Imported ${imported} tasks into ${title}. ${failed} tasks failed.`, {
          description,
        });
      else if (job.signal.aborted)
        toast.info(
          `Import cancelled. Imported ${imported} tasks into ${title}. Already-created tasks stay.`,
          { description },
        );
      else toast.success(`Imported ${imported} tasks into ${title}`, { description });
      if (controller.current !== job) return;
      setOpen(false);
      setProjects([]);
      if (created[0]) router.push(created[0].href);
    } catch {
      if (controller.current === job)
        setError("Could not finish the import. Already-created tasks stay in the new projects.");
    } finally {
      if (controller.current === job) {
        controller.current = null;
        setProgress(undefined);
      }
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <button type="button" className="tsk-ghost">
          Import…
        </button>
      </DialogTrigger>
      <DialogContent
        className="tsk-import"
        showCloseButton={!busy}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void pick(file);
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Import tasks</DialogTitle>
          <DialogDescription>
            From a Todoist CSV or a Google Tasks export (Tasks.json from Google Takeout)
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={`${id}-file`}>Task file (choose or drop here)</label>
        <Input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv,.json,application/json"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={!!error}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void pick(file);
          }}
        />
        {reading && <p role="status">Reading file…</p>}
        {error && (
          <p id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        {projects.map(({ id: projectId, draft, name, checked }, index) => (
          <fieldset key={projectId} className="tsk-import-project">
            {kind === "google" && (
              <>
                <legend>{draft.name}</legend>
                <label className="tsk-import-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => change(index, { checked: event.target.checked })}
                  />
                  Import {draft.name}
                </label>
              </>
            )}
            <label htmlFor={`${id}-name-${index}`}>Project name</label>
            <Input
              id={`${id}-name-${index}`}
              aria-label={kind === "google" ? `Project name for ${draft.name}` : undefined}
              value={name}
              disabled={busy || !checked}
              onChange={(event) => change(index, { name: event.target.value })}
            />
            <p>
              {kind === "todoist" && `${draft.sections.length} sections · `}
              {draft.tasks.length} tasks ·{" "}
              {draft.tasks.filter((task) => task.parentId !== null).length} sub-tasks
            </p>
          </fieldset>
        ))}
        {kind === "google" && !reading && !error && projects.length === 0 && (
          <p>No task lists to import.</p>
        )}
        {previewWarnings.length > 0 && (
          <section className="tsk-import-warnings" aria-label="Import warnings">
            <p>Import warnings</p>
            <ul>
              {previewWarnings.map((warning) => (
                <li
                  key={`${warning.code}-${"line" in warning ? warning.line : `${warning.list}-${warning.task}`}`}
                >
                  {"line" in warning
                    ? `Line ${warning.line}`
                    : `List ${warning.list}, task ${warning.task}`}
                  : {warnings[warning.code]}
                </li>
              ))}
            </ul>
          </section>
        )}
        {busy && (
          <div role="status" aria-live="polite">
            <p>{cancelling ? "Cancelling import…" : `Importing ${progress} of ${count}…`}</p>
            <p>Cancel stops further writes. Already-created tasks stay.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={cancelling && busy} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !selected.length ||
              (kind === "todoist" && !count) ||
              selected.some(({ name }) => !name.trim()) ||
              busy ||
              reading
            }
            onClick={() => void start()}
          >
            Import {count} tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
