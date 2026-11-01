// AUTHORED-BY Codex GPT-6
"use client";
import { Input } from "@jeswr/suite-ui";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StoredProject } from "../lib/model/store";
import { useTasks } from "../state/tasks-context";
export const TASK_PLACEHOLDER =
  "Add a task… e.g. Pay rent tomorrow 5pm #Home @bills p2 every month";
/** Replace the input with Composer in TSK-05; project/section and focus remain here. */
export function AddTaskRow({
  project,
  sectionId,
}: {
  project: StoredProject;
  sectionId?: string | undefined;
}) {
  const { createTask } = useTasks();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = container.current;
    const focus = () => {
      setOpen(true);
      input.current?.focus();
    };
    target?.addEventListener("tasks:add", focus);
    return () => target?.removeEventListener("tasks:add", focus);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return (
    <div ref={container} data-tsk-add={sectionId ?? ""} className="tsk-add-row">
      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            void createTask(project, { title, sectionId });
            setTitle("");
            input.current?.focus();
          }}
        >
          <Input
            ref={input}
            aria-label={sectionId ? "Task title in section" : "Task title"}
            placeholder={TASK_PLACEHOLDER}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setTitle("");
                requestAnimationFrame(() => trigger.current?.focus());
              }
            }}
          />
        </form>
      ) : (
        <button ref={trigger} type="button" className="tsk-ghost" onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          Add task
        </button>
      )}
    </div>
  );
}
