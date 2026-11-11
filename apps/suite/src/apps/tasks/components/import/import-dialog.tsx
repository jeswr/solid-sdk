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
import { useEffect, useId, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import {
  MAX_TODOIST_CSV_BYTES,
  parseTodoistCsv,
  TodoistImportError,
  type TodoistImportErrorCode,
  type TodoistProjectDraft,
  type TodoistWarning,
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
const warnings: Record<TodoistWarning["code"], string> = {
  UNKNOWN_TYPE: "An unrecognised row was skipped.",
  ORPHAN_NOTE: "A note without a task was skipped.",
  UNPARSED_DATE:
    "A date could not be interpreted. Its text will be kept in the task description; no due date or repeat will be set.",
};

export function TasksImportDialog() {
  const { cache } = useTasks();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TodoistProjectDraft>();
  const [name, setName] = useState("");
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
  function close(next: boolean) {
    if (!next && controller.current) {
      controller.current.abort();
      setCancelling(true);
      return;
    }
    ++generation.current;
    setOpen(next);
    setDraft(undefined);
    setError("");
    setReading(false);
  }
  async function pick(file: File) {
    if (controller.current) return;
    const request = ++generation.current;
    setDraft(undefined);
    setError("");
    setReading(true);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("file type");
      if (file.size > MAX_TODOIST_CSV_BYTES) throw new TodoistImportError("CSV_TOO_LARGE", 1);
      const text = await file.text();
      if (request !== generation.current) return;
      const parsed = parseTodoistCsv(text, {
        defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setDraft(parsed);
      setName(file.name.replace(/\.csv$/i, ""));
    } catch (cause) {
      if (request === generation.current)
        setError(
          cause instanceof TodoistImportError
            ? errors[cause.code]
            : "Could not read this CSV. Choose another .csv file.",
        );
    } finally {
      if (request === generation.current) setReading(false);
    }
  }
  async function start() {
    if (!draft || !name.trim() || controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setProgress(0);
    setCancelling(false);
    const title = name.trim();
    try {
      const result = await importProject(cache, draft, title, job.signal, (done) => {
        if (controller.current === job) setProgress(done);
      });
      const href = result.project ? `/tasks/p/${encodeRef(result.project.url)}` : undefined;
      const description = href ? <Link href={href}>Open {title}</Link> : undefined;
      if (result.failed)
        toast.error(
          `Imported ${result.imported} tasks into ${title}. ${result.failed} tasks failed.`,
          { description },
        );
      else if (job.signal.aborted)
        toast.info(
          `Import cancelled. Imported ${result.imported} tasks into ${title}. Already-created tasks stay.`,
          { description },
        );
      else toast.success(`Imported ${result.imported} tasks into ${title}`, { description });
      if (controller.current !== job) return;
      setOpen(false);
      setDraft(undefined);
      if (href) router.push(href);
    } catch {
      if (controller.current === job)
        setError("Could not finish the import. Already-created tasks stay in the new project.");
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
          <DialogTitle>Import from Todoist CSV</DialogTitle>
          <DialogDescription>
            Choose a CSV or drop it here. Tasks will be added to a new project.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={`${id}-file`}>CSV file</label>
        <Input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void pick(file);
          }}
        />
        {reading && <p role="status">Reading CSV…</p>}
        {error && <p role="alert">{error}</p>}
        {draft && (
          <>
            <label htmlFor={`${id}-name`}>Project name</label>
            <Input
              id={`${id}-name`}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <p>
              {draft.sections.length} sections · {draft.tasks.length} tasks ·{" "}
              {draft.tasks.filter((task) => task.parentId !== null).length} sub-tasks
            </p>
            {draft.warnings.length > 0 && (
              <section className="tsk-import-warnings" aria-label="Import warnings">
                <p>Import warnings</p>
                <ul>
                  {draft.warnings.map((warning) => (
                    <li key={`${warning.line}-${warning.code}`}>
                      Line {warning.line}: {warnings[warning.code]}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {busy && (
          <div role="status" aria-live="polite">
            <p>
              {cancelling
                ? "Cancelling import…"
                : `Importing ${progress} of ${draft?.tasks.length}…`}
            </p>
            <p>Cancel stops further writes. Already-created tasks stay.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={cancelling && busy} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={!draft?.tasks.length || !name.trim() || busy || reading}
            onClick={() => void start()}
          >
            Import {draft?.tasks.length ?? 0} tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
