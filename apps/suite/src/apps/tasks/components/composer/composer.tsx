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
import { offerNotificationPermission } from "../../state/reminders";
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
type TaskSave = () => Promise<{ task: StoredTask; project: StoredProject } | undefined>;
interface PasteBatch {
  entries: PasteEntry[];
  index: number;
  created: Map<number, { task: StoredTask; project: StoredProject }>;
  save?: TaskSave | undefined;
}
interface DraftSave {
  revision: number;
  draft: ComposeResult;
  save?: TaskSave | undefined;
}
const parseFailure = "Couldn't interpret this task. Edit the text and try again.";

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
  const [now, setNow] = useState(() => new Date());
  const [defaults] = useState<ComposeContext["defaults"]>(() => ({
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
  const revision = useRef(0);
  const preparedSave = useRef<DraftSave | undefined>(undefined);
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
  let parsed: ComposeResult = {
    title: text,
    priority: 4,
    labels: [],
    reminders: [],
    chips: [],
    canSubmit: false,
  };
  let result = parsed;
  let parseError = false;
  try {
    parsed = parseQuickAdd(text, ctx);
    result = applyControls(parsed, controls, ctx, text);
  } catch {
    parseError = true;
  }
  const editControls = (change: (previous: ComposeOverrides) => ComposeOverrides) => {
    revision.current++;
    setControls(change);
  };
  const editText = (next: string) => {
    revision.current++;
    try {
      setKeepText(rebaseKeepText(text, next, keepText, ctx));
    } catch {
      // An invalid previous phrase must not prevent the next edit from recovering.
      setKeepText(new Set());
    }
    setNow(new Date());
    setText(next);
  };
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
    revision.current++;
    const removed = removeChip(text, chip, keepText);
    setKeepText(removed.keepText);
    setControls((previous) => {
      const next = { ...previous };
      if (chip.kind === "due") delete next.due;
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
  function prepareSave(
    draft: ComposeResult,
    parent?: { task: StoredTask; project: StoredProject },
    onRetry?: () => void,
  ) {
    if (!draft.canSubmit) throw new Error("Every task needs a title");
    let createProject: ReturnType<typeof cache.prepareProjectCreate> | undefined;
    let create: ReturnType<typeof cache.prepareTaskCreate> | undefined;
    let destination: StoredProject | undefined;
    let announced = false;
    return async () => {
      if (!create) {
        const snapshot = cache.getSnapshot();
        let target = parent?.project;
        if (!target && draft.project?.kind === "create") {
          const name = draft.project.name;
          // Once reserved, finish this project operation even if discovery sees its partial write.
          target = createProject
            ? await createProject()
            : snapshot.projects.find(
                (item) => item.tracker.title?.toLowerCase() === name.toLowerCase(),
              );
          if (!target && !createProject) {
            createProject = cache.prepareProjectCreate(name, onRetry);
            target = await createProject();
          }
        } else if (!target) {
          const targetUrl =
            draft.project?.kind === "existing" ? draft.project.url : defaults?.projectUrl;
          target = snapshot.projects.find((item) => item.url === targetUrl);
        }
        if (!target) return undefined;
        target = await cache.ensureLabels(
          target,
          draft.labels.map((label) => label.name),
          onRetry,
        );
        if (!target) return undefined;
        await cache.loadTasks(target, cache.getSnapshot().tasks[target.url]?.status === "error");
        if (cache.getSnapshot().tasks[target.url]?.status !== "ready")
          throw new Error("Couldn't load the project's tasks. Try again.");
        create = cache.prepareTaskCreate(
          target,
          taskSubmission(draft, target, parent?.task.task.id),
          onRetry,
        );
        destination = target;
      }
      const task = await create();
      if (!task || !destination) return undefined;
      if (!announced && destination.url !== project.url)
        toast.success(`Added to ${destination.tracker.title}`);
      announced = true;
      return { task, project: destination };
    };
  }
  async function submit() {
    if (parseError || !result.canSubmit || busyRef.current || batch) return;
    if (preparedSave.current?.revision !== revision.current) {
      // Capture a fresh interpretation once; retries keep this submission and its reservations.
      const current = { ...ctx, now: new Date() };
      try {
        const draft = applyControls(parseQuickAdd(text, current), controls, current, text);
        if (!draft.canSubmit) return;
        preparedSave.current = { revision: revision.current, draft };
      } catch {
        toast.error(parseFailure);
        return;
      }
    }
    await saveDraft(preparedSave.current);
  }
  async function saveDraft(prepared: DraftSave) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      prepared.save ??= prepareSave(prepared.draft, undefined, () => void saveDraft(prepared));
      const saved = await prepared.save?.();
      if (saved && prepared.draft.reminders.length) offerNotificationPermission();
      if (saved && revision.current === prepared.revision) {
        revision.current++;
        preparedSave.current = undefined;
        setText("");
        setKeepText(new Set());
        setControls({});
        setLabelName("");
        setNow(new Date());
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
    if (busyRef.current || pending.index === pending.entries.length) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmPaste(false);
    setPasteFailed(false);
    try {
      while (pending.index < pending.entries.length) {
        const entry = pending.entries[pending.index] as PasteEntry;
        const parent =
          entry.parentIndex === undefined ? undefined : pending.created.get(entry.parentIndex);
        pending.save ??= prepareSave(entry.result, parent, () => void addPaste(pending));
        const saved = await pending.save?.();
        if (!saved) {
          setPasteFailed(true);
          return;
        }
        pending.created.set(pending.index, saved);
        pending.index++;
        pending.save = undefined;
      }
      setBatch(undefined);
      setNow(new Date());
      if (pending.entries.some((entry) => entry.result.reminders.length))
        offerNotificationPermission();
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
          aria-invalid={parseError || undefined}
          aria-describedby={parseError ? `${id}-error` : undefined}
          onChange={(event) => editText(event.target.value)}
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
            let entries: PasteEntry[];
            try {
              entries = planPaste(pasted, { ...ctx, now: new Date(), keepText: new Set() });
            } catch {
              editText(pasted.replace(/[\r\n]+/g, " "));
              return;
            }
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
                  onChange={(value) => editControls((previous) => ({ ...previous, due: value }))}
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
            onChange={(value) => editControls((previous) => ({ ...previous, due: value }))}
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
                  editControls((previous) => ({
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
                  editControls((previous) => ({ ...previous, labels: names }));
                }}
              />
              <label className="tsk-composer-label" htmlFor={`${id}-label`}>
                New label
              </label>
              <Input
                id={`${id}-label`}
                value={labelName}
                onChange={(event) => {
                  revision.current++;
                  setLabelName(event.target.value);
                }}
              />
              <Button
                type="button"
                disabled={!labelName.trim()}
                onClick={() => {
                  const names = [
                    ...new Set([...result.labels.map((label) => label.name), labelName.trim()]),
                  ];
                  editControls((previous) => ({ ...previous, labels: names }));
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
              editControls((previous) => {
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
                  editControls((previous) => ({
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
        {parseError && (
          <p id={`${id}-error`} role="alert" className="tsk-composer-note">
            {parseFailure}
          </p>
        )}
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
          <Button
            type="submit"
            disabled={parseError || !result.canSubmit || busy || Boolean(batch)}
          >
            Add task
          </Button>
        </div>
      </form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
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
