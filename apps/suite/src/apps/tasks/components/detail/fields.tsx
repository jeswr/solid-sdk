// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  PeoplePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TagInput,
  ToggleGroup,
  ToggleGroupItem,
} from "@jeswr/suite-ui";
import {
  DateTimeField,
  type DateTimeValue,
  parseDateTime,
  RecurrenceEditor,
} from "@jeswr/suite-ui/date-time";
import { Flag, Repeat2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { fromEditorRule, recurrenceAnchor, toEditorRule } from "../../lib/detail/recurrence-map";
import { humanise } from "../../lib/model/recurrence";
import type { Reminder } from "../../lib/model/reminders";
import type { StoredProject, StoredTask } from "../../lib/model/store";
import { type PriorityLevel, priorityValue, type TaskView } from "../../lib/views/types";
import { offerNotificationPermission } from "../../state/reminders";
import { useTasks } from "../../state/tasks-context";

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** DateTimeField parses while typing; persist only the final valid draft on blur/Enter. */
function CommitDateField({
  label,
  value,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: DateTimeValue | null;
  onCommit: (value: DateTimeValue | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const dirty = useRef(false);
  const signature = JSON.stringify(value);
  useEffect(() => {
    if (!dirty.current) setDraft(JSON.parse(signature));
  }, [signature]);
  const commit = (form: HTMLFormElement) => {
    const input = form.querySelector("input");
    if (!dirty.current || !input) return;
    // A focused draft may span midnight; resolve its raw phrase against the commit clock too.
    const parsed = parseDateTime(input.value, "en-GB", new Date());
    input.setCustomValidity(parsed.status === "invalid" ? parsed.message : "");
    if (parsed.status === "invalid" || !form.checkValidity()) return;
    const next = parsed.status === "valid" ? parsed.value : null;
    dirty.current = false;
    setDraft(next);
    if (JSON.stringify(next) !== signature) onCommit(next);
  };
  return (
    <form
      className="tsk-detail-date"
      onInput={() => {
        dirty.current = true;
        setReferenceDate(new Date());
      }}
      onFocus={() => {
        setReferenceDate(new Date());
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit(event.currentTarget);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
    >
      <DateTimeField
        label={label}
        locale="en-GB"
        value={draft}
        referenceDate={referenceDate}
        onChange={(value) => {
          dirty.current = true;
          setDraft(value);
        }}
        disabled={disabled}
      />
    </form>
  );
}

function DetailSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProjectFields({
  stored,
  project,
  view,
  onMove,
}: {
  stored: StoredTask;
  project: StoredProject;
  view: TaskView;
  onMove: (target: StoredProject) => void;
}) {
  const tasks = useTasks();
  return (
    <>
      <DetailSelect
        label="Project"
        value={project.url}
        disabled={!stored.etag}
        options={tasks.projects.map((item) => ({
          id: item.url,
          name: item.tracker.title ?? "Project",
        }))}
        onChange={(url) => {
          const target = tasks.projects.find((item) => item.url === url);
          if (target) onMove(target);
        }}
      />
      <DetailSelect
        label="Section"
        value={view.sectionId ?? "none"}
        options={[{ id: "none", name: "No section" }, ...project.tracker.sections]}
        onChange={(id) => {
          void tasks.updateTask(stored, (task) => {
            for (const section of project.tracker.sections) task.types.delete(section.id);
            if (id !== "none") task.types.add(id);
          });
        }}
      />
    </>
  );
}

function LabelsField({
  stored,
  project,
  view,
}: {
  stored: StoredTask;
  project: StoredProject;
  view: TaskView;
}) {
  const tasks = useTasks();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(
    tasks.projects.flatMap((item) =>
      item.tracker.labels.map((label) => [label.name.toLowerCase(), label.name] as const),
    ),
  );
  for (const label of project.tracker.labels) names.set(label.name.toLowerCase(), label.name);
  const selected = project.tracker.labels
    .filter((label) => view.labelIds.includes(label.id))
    .map((label) => label.name.toLowerCase());
  const setLabels = async (keys: string[], submittedName?: string) => {
    // Either failed write must retry the entire user intent, including assignment.
    const retry = () => {
      void setLabels(keys, submittedName);
    };
    setBusy(true);
    try {
      const missing = keys.filter(
        (key) => !project.tracker.labels.some((label) => label.name.toLowerCase() === key),
      );
      const updated = missing.length
        ? await tasks.updateProject(
            project,
            (tracker) => {
              for (const key of missing) {
                if (!tracker.labels.some((label) => label.name.toLowerCase() === key)) {
                  const original = tasks.projects
                    .flatMap((item) => item.tracker.labels)
                    .find((label) => label.name.toLowerCase() === key);
                  tracker.defineCategory(
                    "Label",
                    names.get(key) ?? key,
                    undefined,
                    original?.color,
                  );
                }
              }
            },
            retry,
          )
        : project;
      if (!updated) return;
      const ids = updated.tracker.labels
        .filter((label) => keys.includes(label.name.toLowerCase()))
        .map((label) => label.id);
      const saved = await tasks.updateTask(
        stored,
        (task) => {
          for (const label of updated.tracker.labels) task.types.delete(label.id);
          for (const id of ids) task.types.add(id);
        },
        retry,
      );
      if (saved && submittedName !== undefined)
        setName((current) => (current === submittedName ? "" : current));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tsk-detail-stack">
      <TagInput
        label="Labels"
        options={[...names].map(([id, label]) => ({ id, label }))}
        value={selected}
        onChange={(keys) => {
          void setLabels(keys);
        }}
        disabled={busy}
      />
      <form
        className="tsk-detail-inline tsk-detail-label-create"
        onSubmit={(event) => {
          event.preventDefault();
          const label = name.trim();
          if (!label || busy) return;
          names.set(label.toLowerCase(), label);
          void setLabels([...new Set([...selected, label.toLowerCase()])], name);
        }}
      >
        <input
          aria-label="New label name"
          placeholder="New label"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button size="sm" variant="ghost" type="submit" disabled={!name.trim() || busy}>
          Create label
        </Button>
      </form>
    </div>
  );
}
function useMemberProfile(webId: string) {
  return { displayName: new URL(webId).hostname, loading: false };
}

function AssigneeField({
  stored,
  project,
  view,
}: {
  stored: StoredTask;
  project: StoredProject;
  view: TaskView;
}) {
  const tasks = useTasks();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const members = project.tracker.groupMembers;
  if (!members.some((member) => member !== tasks.webId)) return null;
  return (
    <div className="tsk-detail-property">
      <span>Assignee</span>
      <div>
        <PeoplePicker
          contacts={{ people: members.map((webId) => ({ webId })), state: { kind: "ready" } }}
          value={view.assignee ? [{ webId: view.assignee }] : []}
          query={query}
          onQueryChange={setQuery}
          useProfile={useMemberProfile}
          onChange={(people) => {
            const assignee = people.at(-1)?.webId;
            if (assignee && !members.includes(assignee)) {
              setError("Choose a project member.");
              return;
            }
            setError("");
            void tasks.updateTask(stored, (task) => {
              task.assignee = assignee;
            });
          }}
        />
        {error && <p role="alert">{error}</p>}
        {members.includes(tasks.webId) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void tasks.updateTask(stored, (task) => {
                task.assignee = tasks.webId;
              });
            }}
          >
            Assign to me
          </Button>
        )}
      </div>
    </div>
  );
}

export function TaskProperties({
  stored,
  project,
  view,
  onMove,
}: {
  stored: StoredTask;
  project: StoredProject;
  view: TaskView;
  onMove: (target: StoredProject) => void;
}) {
  const tasks = useTasks();
  const allDayId = useId();
  const [repeatError, setRepeatError] = useState("");
  const [custom, setCustom] = useState(false);
  const due: DateTimeValue | null = view.allDay
    ? { kind: "date", date: view.allDay }
    : view.due
      ? { kind: "dateTime", dateTime: view.due.toISOString() }
      : null;
  const rule = stored.task.recurrence;
  const anchor = recurrenceAnchor(view.due ?? new Date(), view.allDay);
  const reminders = stored.task.reminders;
  const updateDue = (value: DateTimeValue | null) => {
    void tasks.updateTask(stored, (task) => {
      if (!value) {
        task.reminders = [];
        task.recurrence = undefined;
        task.dueDate = undefined;
      } else if (value.kind === "date") task.allDay = value.date;
      else task.dueDate = new Date(value.dateTime);
    });
  };
  const reminderName = (reminder: Reminder) =>
    reminder.time
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
          reminder.time,
        )
      : ({ PT0S: "At due time", "-PT1H": "1 hour before", "-P1D": "1 day before" }[
          reminder.offset
        ] ?? reminder.offset);
  const addReminder = (reminder: Reminder) => {
    const saving = tasks.updateTask(stored, (task) => {
      if (!task.dueDate) return;
      if (
        task.reminders.some((entry) =>
          reminder.time
            ? entry.time?.getTime() === reminder.time.getTime()
            : entry.offset === reminder.offset,
        )
      )
        return;
      task.reminders = [...task.reminders, reminder];
    });
    void saving.then((saved) => {
      if (saved?.task.reminders.length) offerNotificationPermission();
    });
  };
  return (
    <div className="tsk-detail-properties">
      <div className="tsk-detail-property">
        <span>Due</span>
        <div className="tsk-detail-stack">
          <CommitDateField label="Due date" value={due} onCommit={updateDue} />
          <div className="tsk-detail-inline">
            <Switch
              id={allDayId}
              checked={Boolean(view.allDay)}
              disabled={!view.due}
              onCheckedChange={(checked) => {
                if (!view.due) return;
                updateDue(
                  checked
                    ? { kind: "date", date: localDate(view.due) }
                    : {
                        kind: "dateTime",
                        dateTime: new Date(`${view.allDay}T00:00:00`).toISOString(),
                      },
                );
              }}
            />
            <label htmlFor={allDayId}>All day</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!view.due}>
                  <Repeat2 size={16} aria-hidden="true" />
                  Repeat
                </Button>
              </PopoverTrigger>
              <PopoverContent className="tsk-detail-popover" align="end">
                <RecurrenceEditor
                  locale="en-GB"
                  value={toEditorRule(rule)}
                  startDate={localDate(anchor)}
                  onChange={(value) => {
                    try {
                      const recurrence = fromEditorRule(value, anchor);
                      setRepeatError("");
                      void tasks.updateTask(stored, (task) => {
                        if (task.dueDate) task.recurrence = recurrence;
                      });
                    } catch (error) {
                      setRepeatError(
                        error instanceof Error ? error.message : "Choose another repeat pattern.",
                      );
                    }
                  }}
                />
                {repeatError && <p role="alert">{repeatError}</p>}
              </PopoverContent>
            </Popover>
          </div>
          {rule && <span className="tsk-chip">{humanise(rule, anchor)}</span>}
        </div>
      </div>
      <div className="tsk-detail-property">
        <span>Reminder</span>
        <div className="tsk-detail-stack">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" disabled={!view.due}>
                Add reminder
              </Button>
            </PopoverTrigger>
            <PopoverContent className="tsk-detail-popover" align="end">
              <div className="tsk-detail-stack">
                <Button
                  variant="ghost"
                  disabled={!view.due || Boolean(view.allDay)}
                  onClick={() => addReminder({ offset: "PT0S" })}
                >
                  At due time
                </Button>
                <Button variant="ghost" onClick={() => addReminder({ offset: "-PT1H" })}>
                  1 hour before
                </Button>
                <Button variant="ghost" onClick={() => addReminder({ offset: "-P1D" })}>
                  1 day before
                </Button>
                <Button variant="ghost" onClick={() => setCustom(true)}>
                  Custom…
                </Button>
                {custom && (
                  <CommitDateField
                    label="Custom reminder"
                    value={null}
                    onCommit={(value) => {
                      if (value?.kind === "dateTime") {
                        addReminder({ time: new Date(value.dateTime) });
                        setCustom(false);
                      }
                    }}
                  />
                )}
                {custom && (
                  <p className="tsk-detail-muted">Include a time, for example tomorrow 9am.</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {!view.due && <p className="tsk-detail-muted">Set a due date to add reminders.</p>}
          <ul className="tsk-detail-reminders">
            {reminders.map((reminder, index) => (
              <li key={reminder.id ?? index}>
                <span>{reminderName(reminder)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove reminder ${reminderName(reminder)}`}
                  onClick={() => {
                    const id = reminder.id;
                    void tasks.updateTask(stored, (task) => {
                      task.reminders = task.reminders.filter((entry) => entry.id !== id);
                    });
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="tsk-detail-property">
        <span>Priority</span>
        <ToggleGroup
          className="tsk-detail-priority"
          type="single"
          aria-label="Priority"
          value={String(view.priority)}
          onValueChange={(value) => {
            if (value)
              void tasks.updateTask(stored, (task) => {
                task.priority = priorityValue(Number(value) as PriorityLevel);
              });
          }}
        >
          {([1, 2, 3, 4] as const).map((level) => (
            <ToggleGroupItem key={level} value={String(level)} aria-label={`P${level}`}>
              <Flag size={14} data-priority={level} aria-hidden="true" />P{level}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="tsk-detail-property">
        <span>Labels</span>
        <LabelsField stored={stored} project={project} view={view} />
      </div>
      <AssigneeField stored={stored} project={project} view={view} />
      <div className="tsk-detail-property">
        <span>Project / Section</span>
        <div className="tsk-detail-stack">
          <ProjectFields stored={stored} project={project} view={view} onMove={onMove} />
        </div>
      </div>
    </div>
  );
}
