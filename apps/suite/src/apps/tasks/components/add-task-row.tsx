// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComposeDue } from "../lib/compose/quick-add";
import type { StoredProject } from "../lib/model/store";
import { Composer } from "./composer/composer";

export { TASK_PLACEHOLDER } from "./composer/composer";
export function AddTaskRow({
  project,
  sectionId,
  hideTrigger = false,
  due,
}: {
  project: StoredProject;
  sectionId?: string | undefined;
  hideTrigger?: boolean;
  due?: ComposeDue | undefined;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = container.current;
    const focus = () => {
      setOpen(true);
      requestAnimationFrame(() =>
        container.current?.querySelector<HTMLInputElement>("input")?.focus(),
      );
    };
    target?.addEventListener("tasks:add", focus);
    return () => target?.removeEventListener("tasks:add", focus);
  }, []);
  return (
    <div
      ref={container}
      data-tsk-add={sectionId ?? ""}
      data-composer-open={open || undefined}
      className="tsk-add-row"
      hidden={hideTrigger && !open}
    >
      {open ? (
        <Composer
          project={project}
          sectionId={sectionId}
          due={due}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => {
              if (hideTrigger)
                container.current
                  ?.closest(".tsk-content")
                  ?.querySelector<HTMLButtonElement>(".tsk-empty-add")
                  ?.focus();
              else trigger.current?.focus();
            });
          }}
        />
      ) : (
        <button ref={trigger} type="button" className="tsk-ghost" onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          Add task
        </button>
      )}
    </div>
  );
}
