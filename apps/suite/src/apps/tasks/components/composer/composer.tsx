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
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  TagInput,
  toast,
} from "@jeswr/suite-ui";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { applyControls, type ComposeOverrides, rebaseKeepText } from "../../lib/compose/draft";
import { needsConfirm } from "../../lib/compose/paste";
import {
  composeContext,
  type PasteEntry,
  planPaste,
  taskSubmission,
} from "../../lib/compose/planning";
import {
  type Chip,
  type ChipId,
  type ComposeContext,
  type ComposeDue,
  type ComposeResult,
  parseQuickAdd,
  removeChip,
} from "../../lib/compose/quick-add";
import type { StoredProject, StoredTask } from "../../lib/model/store";
import { useTasks } from "../../state/tasks-context";
import { DueControl } from "./due-control";

export const TASK_PLACEHOLDER =
  "Add a task… e.g. Pay rent tomorrow 5pm #Home @bills p2 every month";
const mediaQuery = "(max-width: 767px)";
function subscribeMobile(callback: () => void) {
  const media = matchMedia(mediaQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
interface PasteBatch {
  entries: PasteEntry[];
  index: number;
  created: Map<number, { task: StoredTask; project: StoredProject }>;
}

export function Composer({
  project,
  sectionId,
  due,
  onClose,
  modal = false,
}: {
  project: StoredProject;
  sectionId?: string | undefined;
  due?: ComposeDue | undefined;
  onClose: () => void;
  modal?: boolean;
}) {
  const { cache, projects } = useTasks();
  const mobile = useSyncExternalStore(
    subscribeMobile,
    () => matchMedia(mediaQuery).matches,
    () => false,
  );
  const [now] = useState(() => new Date());
  const [defaults, setDefaults] = useState<ComposeContext["defaults"]>(() => ({
    projectUrl: project.url,
    ...(sectionId
      ? {
          sectionId,
          sectionName:
            project.tracker.sections.find((section) => section.id === sectionId)?.name ?? "Section",
        }
      : {}),
    ...(due ? { due } : {}),
  }));
  const [text, setText] = useState("");
  const [keepText, setKeepText] = useState(new Set<ChipId>());
  const [controls, setControls] = useState<ComposeOverrides>({});
  const [discard, setDiscard] = useState(false);
  const [batch, setBatch] = useState<PasteBatch>();
  const [confirmPaste, setConfirmPaste] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const requestCloseRef = useRef<() => void>(() => {});
  const id = useId();
  const [labelName, setLabelName] = useState("");
  const ctx = composeContext(
    projects,
    defaults,
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase() === "en-us" ? "en-US" : "en-GB",
  );
  ctx.keepText = keepText;
  const parsed = parseQuickAdd(text, ctx);
  const result = applyControls(parsed, controls, ctx, text);
  const projectValue =
    result.project?.kind === "existing"
      ? result.project.url
      : result.project?.kind === "create"
        ? "__create__"
        : project.url;
  const focus = () => requestAnimationFrame(() => input.current?.focus());
  useEffect(() => {
    input.current?.focus();
  }, []);
  const requestClose = () => {
    if (text.trim() || batch) setDiscard(true);
    else onClose();
  };
  requestCloseRef.current = requestClose;
  // The owning Dialog sees Escape before the input. Both paths use the same discard guard.
  const remove = (chip: Chip) => {
    const removed = removeChip(text, chip, keepText);
    setKeepText(removed.keepText);
    setControls((previous) => {
      const next = { ...previous };
      if (chip.kind === "due") next.due = null;
      if (chip.kind === "priority") delete next.priority;
      if (chip.kind === "project") delete next.projectUrl;
      if (chip.kind === "label" && next.labels)
        next.labels = next.labels.filter((name) => `@${name}` !== chip.label);
      if (chip.kind === "reminder") {
        // Preserve other reminders when one chip is removed.
        const index = result.chips
          .filter((item) => item.kind === "reminder")
          .findIndex((item) => item.id === chip.id);
        if (next.reminders) next.reminders = next.reminders.filter((_, at) => at !== index);
      }
      return next;
    });
    focus();
  };
  async function save(draft: ComposeResult, parent?: { task: StoredTask; project: StoredProject }) {
    if (!draft.canSubmit) throw new Error("Every task needs a title");
    const snapshot = cache.getSnapshot();
    let target = parent?.project;
    if (!target && draft.project?.kind === "create") {
      const name = draft.project.name;
      target =
        snapshot.projects.find(
          (item) => item.tracker.title?.toLowerCase() === name.toLowerCase(),
        ) ?? (await cache.createProject(name));
    } else if (!target) {
      const targetUrl =
        draft.project?.kind === "existing" ? draft.project.url : defaults?.projectUrl;
      target = snapshot.projects.find((item) => item.url === targetUrl);
    }
    if (!target) return undefined;
    target = await cache.ensureLabels(
      target,
      draft.labels.map((label) => label.name),
    );
    if (!target) return undefined;
    await cache.loadTasks(target, cache.getSnapshot().tasks[target.url]?.status === "error");
    if (cache.getSnapshot().tasks[target.url]?.status !== "ready")
      throw new Error("Couldn't load the project's tasks. Try again.");
    const task = await cache.createTask(
      target,
      taskSubmission(draft, target, parent?.task.task.id),
    );
    if (!task) return undefined;
    if (target.url !== project.url) toast.success(`Added to ${target.tracker.title}`);
    return { task, project: target };
  }
  async function submit() {
    if (!result.canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const submittedText = text;
    try {
      const saved = await save(result);
      if (saved) {
        setDefaults({
          projectUrl: saved.project.url,
          ...(result.sectionId
            ? {
                sectionId: result.sectionId,
                sectionName:
                  saved.project.tracker.sections.find((section) => section.id === result.sectionId)
                    ?.name ?? "Section",
              }
            : {}),
          ...(due ? { due } : {}),
        });
        if (textRef.current === submittedText) {
          setText("");
          setKeepText(new Set());
          setControls({});
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add task");
    } finally {
      busyRef.current = false;
      setBusy(false);
      focus();
    }
  }
  async function addPaste(pending: PasteBatch) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmPaste(false);
    setPasteFailed(false);
    try {
      while (pending.index < pending.entries.length) {
        const entry = pending.entries[pending.index] as PasteEntry;
        const parent =
          entry.parentIndex === undefined ? undefined : pending.created.get(entry.parentIndex);
        const saved = await save(entry.result, parent);
        if (!saved) {
          setPasteFailed(true);
          return;
        }
        pending.created.set(pending.index, saved);
        pending.index++;
      }
      setBatch(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add tasks");
      setPasteFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
      focus();
    }
  }
  const titleLabel = sectionId ? "Task title in section" : "Task title";
  const field = (
    <>
      <form
        className="tsk-composer"
        aria-label="Add task"
        onKeyDown={(event) => {
          if (!event.defaultPrevented && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="tsk-composer-label" htmlFor={id}>
          {titleLabel}
        </label>
        <Input
          id={id}
          ref={input}
          placeholder={TASK_PLACEHOLDER}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setKeepText(rebaseKeepText(text, next, keepText, ctx));
            setText(next);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              requestClose();
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text/plain");
            if (!/[\r\n]/.test(pasted)) return;
            event.preventDefault();
            if (busyRef.current || batch) return;
            const entries = planPaste(pasted, { ...ctx, keepText: new Set() });
            if (!entries.length) return;
            if (entries.some((entry) => !entry.result.canSubmit)) {
              toast.error("Every task needs a title");
              return;
            }
            const pending = { entries, index: 0, created: new Map() };
            setBatch(pending);
            if (needsConfirm(entries.length)) setConfirmPaste(true);
            else void addPaste(pending);
          }}
        />
        <fieldset className="tsk-composer-chips" aria-label="Task properties">
          {result.chips.map((chip) => (
            <span
              className="tsk-compose-chip"
              data-invalid={chip.invalid || undefined}
              key={chip.id}
            >
              {chip.kind === "due" ? (
                <DueControl
                  label={chip.label}
                  value={result.due}
                  context={ctx}
                  onChange={(value) => setControls((previous) => ({ ...previous, due: value }))}
                />
              ) : (
                <span>{chip.label}</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={() => remove(chip)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </fieldset>
        <span className="tsk-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {result.chips
            .map((chip) => `${chip.label}${chip.invalid ? " — requires a due date" : ""}`)
            .join(", ")}
        </span>
        <div className="tsk-composer-controls">
          <DueControl
            label="Due"
            value={result.due}
            context={ctx}
            onChange={(value) => setControls((previous) => ({ ...previous, due: value }))}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Priority P{result.priority}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={String(result.priority)}
                onValueChange={(value) =>
                  setControls((previous) => ({
                    ...previous,
                    priority: Number(value) as 1 | 2 | 3 | 4,
                  }))
                }
              >
                {[1, 2, 3, 4].map((level) => (
                  <DropdownMenuRadioItem key={level} value={String(level)}>
                    P{level}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Labels{result.labels.length ? ` (${result.labels.length})` : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="tsk-composer-popover" align="start" aria-label="Labels">
              <TagInput
                label="Labels"
                options={[
                  ...new Set([...ctx.labels, ...result.labels.map((label) => label.name)]),
                ].map((name) => ({ id: name, label: name }))}
                value={result.labels.map((label) => label.name)}
                onChange={(names) => {
                  let kept = keepText;
                  for (const chip of parsed.chips.filter(
                    (chip) => chip.kind === "label" && !names.includes(chip.label.slice(1)),
                  ))
                    kept = removeChip(text, chip, kept).keepText;
                  setKeepText(kept);
                  setControls((previous) => ({ ...previous, labels: names }));
                }}
              />
              <label className="tsk-composer-label" htmlFor={`${id}-label`}>
                New label
              </label>
              <Input
                id={`${id}-label`}
                value={labelName}
                onChange={(event) => setLabelName(event.target.value)}
              />
              <Button
                type="button"
                disabled={!labelName.trim()}
                onClick={() => {
                  const names = [
                    ...new Set([...result.labels.map((label) => label.name), labelName.trim()]),
                  ];
                  setControls((previous) => ({ ...previous, labels: names }));
                  setLabelName("");
                }}
              >
                Create label
              </Button>
            </PopoverContent>
          </Popover>
          <Select
            value={projectValue}
            onValueChange={(url) => {
              // Radix's native form bridge can emit an empty change while its
              // options update after parsing. It is not a project selection.
              if (!url) return;
              setControls((previous) => {
                const next = { ...previous };
                if (url === "__create__") delete next.projectUrl;
                else next.projectUrl = url;
                return next;
              });
            }}
          >
            <SelectTrigger aria-label="Project" size="sm">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {ctx.projects.map((item) => (
                <SelectItem key={item.url} value={item.url}>
                  {item.title}
                </SelectItem>
              ))}
              {result.project?.kind === "create" && (
                <SelectItem value="__create__">Create project '{result.project.name}'</SelectItem>
              )}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={!result.due}>
                Reminder{result.reminders.length ? ` (${result.reminders.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={result.reminders[0]?.offset ?? "none"}
                onValueChange={(offset) =>
                  setControls((previous) => ({
                    ...previous,
                    reminders: offset === "none" ? [] : [{ offset }],
                  }))
                }
              >
                <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="PT0S"
                  disabled={!result.due || Boolean(result.due.allDay)}
                >
                  At due time
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="-PT1H">1 hour before</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="-P1D">1 day before</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {result.chips.some((chip) => chip.invalid) && (
          <p className="tsk-composer-note">Reminders require a due date.</p>
        )}
        {pasteFailed && batch && (
          <div role="alert">
            <p>
              Added {batch.index} of {batch.entries.length} tasks.
            </p>
            <Button type="button" onClick={() => void addPaste(batch)}>
              Retry remaining tasks
            </Button>
          </div>
        )}
        <div className="tsk-composer-actions">
          <span role="status">{busy ? "Saving…" : ""}</span>
          <Button type="button" variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!result.canSubmit || busy || Boolean(batch)}>
            Add task
          </Button>
        </div>
      </form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard task?</AlertDialogTitle>
            <AlertDialogDescription>Your task draft will be discarded.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={confirmPaste}
        onOpenChange={(open) => {
          setConfirmPaste(open);
          if (!open && !busyRef.current) setBatch(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {batch?.entries.length} tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              Indented lines will be added as sub-tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={focus}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (batch) void addPaste(batch);
              }}
            >
              Add tasks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  if (mobile)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) requestCloseRef.current();
        }}
      >
        <SheetContent
          side="bottom"
          className="tsk-composer-sheet"
          showCloseButton={false}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestCloseRef.current();
          }}
        >
          <SheetTitle>Add task</SheetTitle>
          {field}
        </SheetContent>
      </Sheet>
    );
  if (modal)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestCloseRef.current();
        }}
      >
        <DialogContent
          className="tsk-composer-dialog"
          showCloseButton={false}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestCloseRef.current();
          }}
        >
          <DialogTitle>Add task</DialogTitle>
          {field}
        </DialogContent>
      </Dialog>
    );
  return field;
}
