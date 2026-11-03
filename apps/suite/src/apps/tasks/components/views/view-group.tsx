// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { DropContainer } from "../../lib/dnd/types";
import { flatRows } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
import { useTasks } from "../../state/tasks-context";
import { useDropTarget } from "../dnd/use-task-drag";
import { TaskList } from "../task-list";

export function ViewGroup({
  title,
  rows,
  collapsible = false,
  defaultCollapsed = false,
  destructive = false,
  actions,
  children,
  dayKey,
  container,
}: {
  title: string;
  rows: readonly TaskView[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  destructive?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  dayKey?: string;
  /** Rows drag out of every day group; only a dated group accepts drops (06-tasks §2.4). */
  container?: DropContainer;
}) {
  const { views } = useTasks();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const id = useId();
  const dropDay = container?.kind === "day" ? container.dayKey : undefined;
  const drop = useDropTarget(`day:${id}`, dropDay ? { kind: "day", dayKey: dropDay } : undefined);
  return (
    <section className="tsk-view-group" aria-labelledby={`${id}-heading`}>
      <div className="tsk-group-header" ref={drop.ref} data-drop-over={drop.over || undefined}>
        <h2 id={`${id}-heading`} data-day-key={dayKey} tabIndex={dayKey ? -1 : undefined}>
          {collapsible ? (
            <button
              type="button"
              className="tsk-group-toggle"
              aria-expanded={!collapsed}
              aria-controls={`${id}-body`}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <ChevronRight size={16} aria-hidden="true" />
              ) : (
                <ChevronDown size={16} aria-hidden="true" />
              )}
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <span className="tsk-count" data-destructive={destructive || undefined}>
          {rows.length}
          <span className="tsk-sr-only"> tasks</span>
        </span>
        {actions}
      </div>
      <div id={`${id}-body`} hidden={collapsible && collapsed}>
        <TaskList rows={flatRows(rows, views)} showProject container={container} />
        {children}
      </div>
    </section>
  );
}
