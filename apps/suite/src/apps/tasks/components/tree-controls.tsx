// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { IconButton } from "@jeswr/suite-ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { taskProgress } from "../lib/views/tree";
import type { TaskView } from "../lib/views/types";
import type { TasksCache } from "../state/tasks-cache";
import { useTasks } from "../state/tasks-context";
import "./tree.css";

const treeMemory = new WeakMap<TasksCache, ReturnType<typeof createTreeMemory>>();
function createTreeMemory() {
  let collapsed: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    snapshot: () => collapsed,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setExpanded: (id: string, expanded: boolean) => {
      if (collapsed.has(id) !== expanded) return;
      const next = new Set(collapsed);
      if (expanded) next.delete(id);
      else next.add(id);
      collapsed = next;
      for (const listener of listeners) listener();
    },
  };
}
/** Session-scoped memory survives view changes; never writes RDF or preferences. */
export function useCollapsedTasks() {
  const { cache } = useTasks();
  const memory = useMemo(() => {
    let memory = treeMemory.get(cache);
    if (!memory) {
      memory = createTreeMemory();
      treeMemory.set(cache, memory);
    }
    return memory;
  }, [cache]);
  const collapsed = useSyncExternalStore(memory.subscribe, memory.snapshot, memory.snapshot);
  return { collapsed, setExpanded: memory.setExpanded };
}

export function TaskProgress({ tasks, id }: { tasks: readonly TaskView[]; id: string }) {
  const { completed, total } = taskProgress(tasks, id);
  if (!total) return null;
  return (
    <span className="tsk-progress">
      <span aria-hidden="true">
        {completed}/{total}
      </span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuenow={completed}
        aria-valuemax={total}
        aria-label={`${completed} of ${total} sub-tasks done`}
        className="tsk-progress-track"
      >
        <span style={{ width: `${(completed / total) * 100}%` }} />
      </span>
    </span>
  );
}

export function TreeToggle({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      className="tsk-tree-toggle"
      label={`${expanded ? "Collapse" : "Expand"} '${title}'`}
      variant="ghost"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown size={16} aria-hidden="true" />
      ) : (
        <ChevronRight size={16} aria-hidden="true" />
      )}
    </IconButton>
  );
}
