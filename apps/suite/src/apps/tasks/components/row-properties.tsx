// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Popover, PopoverAnchor, PopoverContent, TagInput } from "@jeswr/suite-ui";
import { RecurrenceEditor } from "@jeswr/suite-ui/date-time";
import { useState } from "react";
import { fromEditorRule, recurrenceAnchor, toEditorRule } from "../lib/detail/recurrence-map";
import { localDayKey } from "../lib/views/days";
import type { TaskView } from "../lib/views/types";
import { useTasks } from "../state/tasks-context";

/** Existing tracker labels only; richer label creation belongs to the composer/detail lanes. */
export function RowProperties({
  task,
  panel,
  onClose,
}: {
  task: TaskView;
  panel: "labels" | "repeat" | undefined;
  onClose: () => void;
}) {
  const tasks = useTasks();
  const stored = tasks.tasks[task.projectUrl]?.items.find((item) => item.url === task.url);
  const project = tasks.projects.find((project) => project.url === task.projectUrl);
  const [error, setError] = useState("");
  const focusRow = () =>
    document.querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)?.focus();
  return (
    <Popover
      open={!!panel}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setError("");
        }
      }}
    >
      <PopoverAnchor asChild>
        <span className="tsk-property-anchor" />
      </PopoverAnchor>
      <PopoverContent
        aria-label={panel === "labels" ? "Labels" : "Repeat"}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusRow();
        }}
      >
        {panel === "labels" && (
          <TagInput
            label="Labels"
            options={(project?.tracker.labels ?? []).map((label) => ({
              id: label.id,
              label: label.name,
            }))}
            value={task.labelIds}
            onChange={(ids) => {
              if (stored && project)
                void tasks.updateTask(stored, (task) => {
                  for (const label of project.tracker.labels) task.types.delete(label.id);
                  for (const id of ids) task.types.add(id);
                });
            }}
          />
        )}
        {panel === "repeat" && stored && (
          <RecurrenceEditor
            label="Repeat"
            locale="en-GB"
            value={toEditorRule(stored.task.recurrence)}
            startDate={task.allDay ?? localDayKey(task.due ?? new Date())}
            onChange={(rule) => {
              try {
                const due = recurrenceAnchor(task.due ?? new Date(), task.allDay);
                const recurrence = fromEditorRule(rule, due);
                setError("");
                void tasks.updateTask(stored, (task) => {
                  if (recurrence && !task.dueDate) task.allDay = localDayKey(due);
                  task.recurrence = recurrence;
                });
              } catch (error) {
                setError(error instanceof Error ? error.message : "Couldn't save repeat pattern");
              }
            }}
          />
        )}
        {error && <p role="alert">{error}</p>}
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </PopoverContent>
    </Popover>
  );
}
