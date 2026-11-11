// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenuItem,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  toast,
} from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import { slug } from "../../lib/model/rdf";
import type { StoredProject } from "../../lib/model/store";
import { parseVTodo, type VTodoCalendar } from "../../lib/vtodo";
import { calendarError } from "../../lib/vtodo-adapter";
import { calendarImport, exportCalendar, previewCalendar } from "../../state/calendar-exchange";
import { useTasks } from "../../state/tasks-context";

export function useCalendarExchange(project: StoredProject) {
  const { cache } = useTasks();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const download = async () => {
    setExporting(true);
    try {
      const text = await exportCalendar(cache, project);
      const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      const projectSlug = new URL(project.url).pathname
        .split("/")
        .pop()
        ?.replace(/\.ttl$/u, "");
      link.download = `${slug(projectSlug ?? "project")}.ics`;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error) {
      toast.error(calendarError(error));
    } finally {
      setExporting(false);
    }
  };
  return {
    items: (
      <>
        <DropdownMenuItem
          disabled={exporting}
          onSelect={() => {
            void download();
          }}
        >
          Export to calendar (.ics)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!project.etag}
          onSelect={() => {
            trigger.current =
              [...document.querySelectorAll<HTMLButtonElement>("button")].find(
                (button) =>
                  button.getAttribute("aria-label") ===
                  `Project actions for ${project.tracker.title ?? "Untitled"}`,
              ) ?? null;
            setOpen(true);
          }}
        >
          Import from calendar (.ics)…
        </DropdownMenuItem>
      </>
    ),
    dialog: open ? (
      <CalendarImportDialog
        project={project}
        onClose={() => {
          setOpen(false);
          requestAnimationFrame(() => trigger.current?.focus());
        }}
      />
    ) : null,
  };
}

function CalendarImportDialog({
  project,
  onClose,
}: {
  project: StoredProject;
  onClose: () => void;
}) {
  const { cache } = useTasks();
  const [mobile, setMobile] = useState(false);
  const [calendar, setCalendar] = useState<VTodoCalendar>();
  const [preview, setPreview] = useState<ReturnType<typeof previewCalendar>>();
  const [result, setResult] = useState<{ added: number; skipped: number; failed: number }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const operation = useRef<ReturnType<typeof calendarImport> | undefined>(undefined);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const inputId = useId();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      generation.current++;
    };
  }, []);
  const pick = async (file: File | undefined) => {
    const version = ++generation.current;
    setCalendar(undefined);
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    operation.current = undefined;
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseVTodo(await file.text());
      await cache.loadTasks(project, true);
      const load = cache.getSnapshot().tasks[project.url];
      if (load?.status !== "ready" || load.refreshing || load.warningCount) throw new Error();
      const nextPreview = previewCalendar(parsed, load.items);
      if (version !== generation.current) return;
      setCalendar(parsed);
      setPreview(nextPreview);
      operation.current = calendarImport(cache, project, parsed);
    } catch (failure) {
      if (version === generation.current) setError(calendarError(failure));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  const add = async () => {
    if (inFlight.current || !operation.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await operation.current());
    } catch (failure) {
      setError(calendarError(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const fields = (
    <div className="tsk-calendar-fields">
      <label htmlFor={inputId}>Calendar file (.ics)</label>
      <Input
        id={inputId}
        type="file"
        accept=".ics,text/calendar"
        disabled={busy || Boolean(result?.added)}
        onChange={(event) => {
          void pick(event.target.files?.[0]);
        }}
      />
      {preview && (
        <p role="status">
          {preview.count} tasks, {preview.completed} completed. {preview.skipped} skipped.
        </p>
      )}
      {calendar && (
        <ul className="tsk-calendar-preview" aria-label="Tasks to import">
          {calendar.tasks.map((task) => (
            <li key={task.uid}>{task.title}</li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Added {result.added} tasks. {result.skipped} skipped.
          {result.failed > 0 ? ` ${result.failed} couldn't be added. Try again.` : ""}
        </p>
      )}
      <div className="tsk-calendar-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {result && !result.failed ? "Close" : "Cancel"}
        </Button>
        {(!result || result.failed > 0) && (
          <Button
            disabled={busy || !calendar}
            onClick={() => {
              void add();
            }}
          >
            {busy ? "Working…" : result ? "Retry remaining tasks" : "Add tasks"}
          </Button>
        )}
      </div>
    </div>
  );
  const changeOpen = (open: boolean) => {
    if (!open && !busy) onClose();
  };
  const title = "Import from calendar (.ics)";
  const description = `Add tasks to ${project.tracker.title ?? "this project"}. Tasks already in this project will be skipped.`;
  return mobile ? (
    <Sheet open onOpenChange={changeOpen}>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
        {fields}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={changeOpen}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {fields}
      </DialogContent>
    </Dialog>
  );
}
