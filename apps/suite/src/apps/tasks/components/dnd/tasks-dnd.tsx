// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  type Active,
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  type Over,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { getEventCoordinates, isKeyboardEvent } from "@dnd-kit/utilities";
import { toast } from "@jeswr/suite-ui";
import { GripVertical } from "lucide-react";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRoutePathname } from "@/lib/route-params";
import {
  cancelMessage,
  dropMessage,
  failedMessage,
  movingMessage,
  overMessage,
  pickupMessage,
  projectNames,
  sectionToast,
} from "../../lib/dnd/announce";
import { dropPriority, placementFor, sameContainer } from "../../lib/dnd/placement";
import { planDrop, sortedTarget, visibleTasks } from "../../lib/dnd/plan";
import type { DropContainer, DropPlan, DropTarget, Placement } from "../../lib/dnd/types";
import type { TaskView } from "../../lib/views/types";
import { announceRetries, applyDropPlan, replanner } from "../../state/drop-actions";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import "./dnd.css";

/** Data carried by every draggable task row or card. */
export interface DragData {
  kind: "task";
  task: TaskView;
  container: DropContainer;
  /** A touch long-press released without moving selects instead of dropping. */
  onLongPress?: (() => void) | undefined;
}
/** The touch long-press delay: the TouchSensor's activation and the selection fallback. */
export const LONG_PRESS_MS = 250;
/** How far (px) a touch drag may wander and still count as a long-press. */
export const LONG_PRESS_SLOP = 8;
/** A touch-activated drag that ended where it started: a long-press, not a move. */
export function isStationaryTouch(event: {
  activatorEvent: Event;
  delta: { x: number; y: number };
}) {
  return (
    "touches" in event.activatorEvent && Math.hypot(event.delta.x, event.delta.y) < LONG_PRESS_SLOP
  );
}
/** Data carried by droppables; rows/cards add their container and nesting rule. */
export type DropData =
  | { kind: "task"; url: string; container: DropContainer; allowChild: boolean }
  | { kind: "section-start" | "section-end"; projectUrl: string; sectionId?: string | undefined }
  | { kind: "day"; dayKey: string }
  | { kind: "project"; projectUrl: string };

/** Hover hint for one droppable; rows render it as an insertion line or nest outline. */
type Hint = { id: string; placement: Placement | "inside" } | undefined;
function hintStore() {
  let hint: Hint;
  const listeners = new Set<() => void>();
  return {
    get: () => hint,
    set(next: Hint) {
      if (next?.id === hint?.id && next?.placement === hint?.placement) return;
      hint = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const HintContext = createContext<ReturnType<typeof hintStore> | undefined>(undefined);
/** The pending drop placement on this droppable id, if the drag is over it. */
export function useDropHint(id: string): Placement | "inside" | undefined {
  const store = useContext(HintContext);
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => {
      const hint = store?.get();
      return hint?.id === id ? hint.placement : undefined;
    },
    () => undefined,
  );
}
const noopSubscribe = () => () => {};

/** Fine pointers only: touch drags go through the long-press TouchSensor instead. */
class FinePointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: PointerEvent) =>
        nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== "touch",
    },
  ];
}

/** Pointer drags prefer the row under the pointer over the section around it. */
const collisions: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (!within.length) return closestCenter(args);
  return [...within].sort(
    (a, b) =>
      dropPriority(a.data?.droppableContainer?.data.current?.kind) -
      dropPriority(b.data?.droppableContainer?.data.current?.kind),
  );
};

function targetFor(
  active: Active,
  over: Over | null,
  activatorEvent: Event,
  delta: { x: number; y: number },
): DropTarget | undefined {
  const data = over?.data.current as DropData | undefined;
  const drag = active.data.current as DragData | undefined;
  // Hovering its own origin is not a drop target (and stays silent: see onDragOver).
  if (!over || !data || !drag || over.id === active.id) return undefined;
  switch (data.kind) {
    case "project":
      return { kind: "project", projectUrl: data.projectUrl };
    case "day":
      return { kind: "day", dayKey: data.dayKey };
    case "section-start":
    case "section-end":
      return {
        kind: "section",
        projectUrl: data.projectUrl,
        sectionId: data.sectionId,
        at: data.kind === "section-start" ? "start" : "end",
      };
    case "task": {
      const origin = getEventCoordinates(activatorEvent);
      const initial = active.rect.current.initial;
      return {
        kind: "task",
        url: data.url,
        container: data.container,
        placement: placementFor({
          over: over.rect,
          pointer:
            origin && !isKeyboardEvent(activatorEvent)
              ? { x: origin.x + delta.x, y: origin.y + delta.y }
              : undefined,
          movingDown: over.rect.top > (initial?.top ?? 0),
          sameContainer: sameContainer(drag.container, data.container),
          allowChild: data.allowChild,
        }),
      };
    }
  }
}

const hintOf = (target: DropTarget | undefined, over: Over | null): Hint =>
  target && over
    ? { id: String(over.id), placement: target.kind === "task" ? target.placement : "inside" }
    : undefined;

/**
 * One drag context for the whole Tasks frame, so rows can drop on sidebar
 * projects as well as on sections, rows, day headers and board columns
 * (06-tasks §4.4). Pointer (fine, 6px), touch (250ms long-press) and
 * keyboard (sortable coordinates) sensors; every phase is announced.
 */
export function TasksDnd({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const { preferences } = useTasksPreferences();
  const pathname = useRoutePathname();
  // A list sorted by due date, priority or name has no manual order to drop into.
  const manual = (preferences.sort[pathname] ?? "manual") === "manual";
  const flat = pathname.endsWith("/board");
  const [store] = useState(hintStore);
  const [active, setActive] = useState<TaskView>();
  /** The drop outcome, announced once its write settles (dnd-kit's region has moved on). */
  const [status, setStatus] = useState("");
  const target = useRef<DropTarget | undefined>(undefined);
  const plan = useRef<DropPlan>({ kind: "none" });
  const sensors = useSensors(
    useSensor(FinePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projects = () => projectNames(tasks.projects);
  const showCompleted = preferences.showCompletedInProject;
  /** Reorders count the visible rows of the active task's own project; nesting checks all. */
  const planFor = (task: TaskView, project: readonly TaskView[], drop: DropTarget) =>
    planDrop(task, drop, visibleTasks(project, showCompleted), { all: project, manual, flat });
  const projectTasks = (task: TaskView) =>
    tasks.views.filter((view) => view.projectUrl === task.projectUrl);
  /** What a sorted list makes of the target: a row stands for its section. */
  const effective = (drop: DropTarget | undefined) => (drop && !manual ? sortedTarget(drop) : drop);
  const taskOf = (activeItem: Active) => (activeItem.data.current as DragData | undefined)?.task;
  const track = (event: DragMoveEvent) => {
    target.current = targetFor(event.active, event.over, event.activatorEvent, event.delta);
    const task = taskOf(event.active);
    // In a sorted list a row in the dragged task's own section is no target at all.
    const inert =
      !manual &&
      task &&
      target.current &&
      planFor(task, projectTasks(task), target.current).kind === "none";
    store.set(inert ? undefined : hintOf(effective(target.current), event.over));
  };
  const announcements: Announcements = {
    onDragStart: ({ active: item }) => {
      const task = taskOf(item);
      return task ? pickupMessage(task) : undefined;
    },
    onDragOver: ({ active: item, over }) => {
      const task = taskOf(item);
      if (!task || over?.id === item.id) return undefined;
      return overMessage(task, effective(target.current), tasks.views, projects());
    },
    onDragEnd: ({ active: item }) => {
      const task = taskOf(item);
      if (!task) return undefined;
      // The outcome follows in `status` once the write settles; a rollback is never "Moved".
      return plan.current.kind === "none"
        ? dropMessage(task, plan.current, tasks.views, projects())
        : movingMessage(task);
    },
    onDragCancel: ({ active: item }) => {
      const task = taskOf(item);
      return task ? cancelMessage(task) : undefined;
    },
  };
  const reset = () => {
    setActive(undefined);
    store.set(undefined);
  };
  return (
    <HintContext value={store}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisions}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "To move a task, press Space or Enter on its drag handle, use the arrow keys to choose a place, then press Space or Enter to drop it, or Escape to cancel. The task menu also has Move up, Move down, Move to section and Move to project.",
          },
        }}
        onDragStart={(event: DragStartEvent) => {
          setStatus("");
          target.current = undefined;
          plan.current = { kind: "none" };
          setActive(taskOf(event.active));
        }}
        onDragMove={track}
        onDragOver={track}
        onDragCancel={reset}
        onDragEnd={(event: DragEndEvent) => {
          track(event);
          const task = taskOf(event.active);
          reset();
          if (isStationaryTouch(event)) {
            target.current = undefined;
            (event.active.data.current as DragData | undefined)?.onLongPress?.();
          }
          if (!task || !target.current) {
            plan.current = { kind: "none" };
            return;
          }
          const drop = target.current;
          const next = planFor(task, projectTasks(task), drop);
          plan.current = next;
          if (next.kind === "none") return;
          const names = projects();
          const message = dropMessage(task, next, tasks.views, names, manual, flat);
          const replan = replanner(tasks.cache, task.url, (fresh, project) =>
            planFor(fresh, project, drop),
          );
          const retried = announceRetries(tasks.cache, {
            task,
            plan: next,
            message,
            showCompleted,
            flat,
            describe: (plan) =>
              dropMessage(task, plan, tasks.cache.getSnapshot().views, names, manual, flat),
            announce: setStatus,
          });
          void applyDropPlan(next, tasks, replan, retried).then((written) => {
            setStatus(written ? message : failedMessage(task));
            const moved = written && sectionToast(next, names);
            if (moved) toast.success(moved);
          });
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="tsk-drag-overlay">
              <GripVertical size={16} aria-hidden="true" />
              <span>{active.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <span
        className="suite-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-tsk-drop-status
      >
        {status}
      </span>
    </HintContext>
  );
}
