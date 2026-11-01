// AUTHORED-BY Claude Opus 5.5
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type CalendarEvent, CalendarHttpError, calendarIO, type StoredItem } from "../lib/model";
import { useCalendarState, useEventMutations } from "../state/calendar-context";
import {
  type DragGesture,
  type DragKind,
  draggedEvent,
  dropAnnouncement,
  passedThreshold,
  sameTiming,
} from "../state/drag";
import {
  applySeriesPlan,
  editorRecurrence,
  localEventItem,
  planSeriesEdit,
  removeReplacement,
  type SeriesMode,
  type SeriesReplacement,
  withSourceCalendar,
} from "../state/editing";
import type { Occurrence } from "../state/view";
import { SeriesScopeDialog } from "./series-scope-dialog";

/** Where a chip is dragged: the timed grid, the week/day all-day row, or the month grid. */
export type DragSurface = "time" | "all-day" | "month";
/**
 * Called at pointer-down with the origin. Returns a locator from a later pointer position to a
 * gesture, or undefined while the pointer is over no target (the preview then stays put).
 */
export type DragOrigin = (
  x: number,
  y: number,
) => (x: number, y: number) => Omit<DragGesture, "kind"> | undefined;
export interface ActiveDrag {
  occurrence: Occurrence;
  surface: DragSurface;
  kind: DragKind;
  /** The occurrence's timing at the drop target (its own timing when nothing changes). */
  preview: CalendarEvent;
  /** Dropped: waiting for the scope choice, or for the optimistic write to appear. */
  settling?: "scope" | "saving";
}
export type DragSourceProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "data-draggable": "";
  "data-dragging"?: DragKind | undefined;
};
interface Gesture {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  element: HTMLElement;
  locate: ReturnType<DragOrigin>;
  occurrence: Occurrence;
  surface: DragSurface;
  kind: DragKind;
  started: boolean;
}
interface Pending {
  occurrence: Occurrence;
  next: CalendarEvent;
  kind: DragKind;
  source: Promise<StoredItem<CalendarEvent>>;
}
const Context = createContext<
  | {
      active: ActiveDrag | undefined;
      source: (occurrence: Occurrence, surface: DragSurface, origin: DragOrigin) => DragSourceProps;
    }
  | undefined
>(undefined);
export function useEventDrag() {
  return useContext(Context);
}

/**
 * Pointer drag-and-drop for event chips. Pointer-only by design: the keyboard alternative is
 * the Edit dialog (WCAG 2.5.7). Saves go through the editor's series planning and mutations.
 */
export function CalendarDragProvider({ children }: { children: ReactNode }) {
  const { calendars, session, writes } = useCalendarState();
  const mutations = useEventMutations();
  const [active, setActiveState] = useState<ActiveDrag>();
  const [pending, setPending] = useState<Pending>();
  const [announcement, setAnnouncement] = useState("");
  const activeRef = useRef<ActiveDrag | undefined>(undefined);
  const gesture = useRef<Gesture | undefined>(undefined);
  const suppressClick = useRef(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const setActive = useCallback(
    (update: (current: ActiveDrag | undefined) => ActiveDrag | undefined) => {
      activeRef.current = update(activeRef.current);
      setActiveState(activeRef.current);
    },
    [],
  );
  // The optimistic write has replaced the original chip: retire the ghost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change in writes is the signal
  useEffect(() => {
    if (activeRef.current?.settling === "saving") setActive(() => undefined);
  }, [writes, setActive]);
  // A drag's trailing click must not open details; keyboard clicks are never swallowed.
  useEffect(() => {
    const reset = () => {
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    addEventListener("pointerup", reset, true);
    addEventListener("pointercancel", reset, true);
    return () => {
      removeEventListener("pointerup", reset, true);
      removeEventListener("pointercancel", reset, true);
    };
  }, []);
  const dragging = Boolean(active && !active.settling);
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = gesture.current;
      gesture.current = undefined;
      if (current?.element.hasPointerCapture(current.pointerId))
        current.element.releasePointerCapture(current.pointerId);
      setActive(() => undefined);
      setAnnouncement("Move cancelled");
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [dragging, setActive]);

  function sourceFor(occurrence: Occurrence): Promise<StoredItem<CalendarEvent>> {
    const list = calendars.status === "ready" ? calendars.calendars : [];
    if (!occurrence.data.recurrence)
      return Promise.resolve(
        withSourceCalendar(
          { url: occurrence.url, etag: occurrence.etag, data: occurrence.data },
          list,
        ),
      );
    // A recurring occurrence is planned against its series master, exactly as the editor does.
    const local = localEventItem(occurrence.url, writes);
    const loaded =
      local === undefined
        ? calendarIO(session.fetch, session.storageUrl).loadEvent(occurrence.url)
        : Promise.resolve(local);
    const source = loaded.then((item) => {
      if (!item) throw new Error("This event is no longer here.");
      return withSourceCalendar(item, list);
    });
    source.catch(() => undefined);
    return source;
  }
  async function commit(
    { occurrence, next, kind, source: sourcePromise }: Pending,
    mode: SeriesMode,
  ) {
    const replacement: SeriesReplacement = { current: undefined };
    setActive((current) => current && { ...current, settling: "saving" });
    try {
      const source = await sourcePromise;
      const edited: CalendarEvent = {
        ...occurrence.data,
        start: next.start,
        end: next.end,
        inCalendar: source.data.inCalendar,
        recurrence: editorRecurrence(occurrence.data.recurrence, next.start, zone),
      };
      const plan = planSeriesEdit(source.data, occurrence.data.start, edited, mode, zone);
      setAnnouncement(dropAnnouncement(occurrence.data.name, next, kind, zone));
      await applySeriesPlan({
        plan,
        source,
        mode,
        target: occurrence.calendar,
        mutations,
        replacement,
      });
    } catch (failure) {
      let message: string | undefined;
      try {
        await removeReplacement(mutations, replacement);
        // The save path already reported (and reverted) a failed pod write.
        if (!(failure instanceof CalendarHttpError))
          message =
            failure instanceof Error && failure.message.startsWith("Reconnect")
              ? "Reconnect before moving a recurring event."
              : "Couldn't move the event. Your change was reverted.";
      } catch {
        message = "Couldn't finish moving the event. Open it and save again to tidy up.";
      }
      if (message) toast.error(message);
      setAnnouncement(`Couldn't move ${occurrence.data.name}.`);
    } finally {
      setActive((current) =>
        current?.occurrence.id === occurrence.id && current.settling === "saving"
          ? undefined
          : current,
      );
    }
  }
  function drop(dropped: Gesture) {
    const current = activeRef.current;
    const next = current?.preview;
    if (!current || !next || sameTiming(next, dropped.occurrence.data)) {
      setActive(() => undefined);
      return;
    }
    const intent: Pending = {
      occurrence: dropped.occurrence,
      next,
      kind: dropped.kind,
      source: sourceFor(dropped.occurrence),
    };
    if (dropped.occurrence.data.recurrence) {
      setActive((value) => value && { ...value, settling: "scope" });
      setPending(intent);
    } else void commit(intent, "all");
  }
  function cancel(pointerId: number) {
    if (gesture.current?.pointerId !== pointerId) return;
    gesture.current = undefined;
    setActive(() => undefined);
  }
  function source(
    occurrence: Occurrence,
    surface: DragSurface,
    origin: DragOrigin,
  ): DragSourceProps {
    return {
      "data-draggable": "",
      "data-dragging":
        active && !active.settling && active.occurrence.id === occurrence.id
          ? active.kind
          : undefined,
      onPointerDown: (event) => {
        // Mouse and pen only: touch swipes on chips keep scrolling; a tap still opens details.
        if (event.pointerType === "touch") return;
        if (event.button !== 0 || !event.isPrimary || gesture.current || pending) return;
        const kind: DragKind =
          surface === "time" && (event.target as Element).closest(".cal-resize-handle")
            ? "resize-end"
            : "move";
        gesture.current = {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          x: event.clientX,
          y: event.clientY,
          element: event.currentTarget,
          locate: origin(event.clientX, event.clientY),
          occurrence,
          surface,
          kind,
          started: false,
        };
        suppressClick.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const current = gesture.current;
        if (current?.pointerId !== event.pointerId) return;
        if (!current.started) {
          if (
            !passedThreshold(
              event.clientX - current.x,
              event.clientY - current.y,
              current.pointerType,
            )
          )
            return;
          current.started = true;
          suppressClick.current = true;
        }
        event.preventDefault();
        const delta = current.locate(event.clientX, event.clientY);
        const shown = activeRef.current;
        if (!delta && shown) return;
        const preview =
          (delta &&
            draggedEvent(current.occurrence.data, { kind: current.kind, ...delta }, zone)) ??
          current.occurrence.data;
        if (shown && sameTiming(shown.preview, preview)) return;
        setActive(() => ({
          occurrence: current.occurrence,
          surface: current.surface,
          kind: current.kind,
          preview,
        }));
      },
      onPointerUp: (event) => {
        const current = gesture.current;
        if (current?.pointerId !== event.pointerId) return;
        gesture.current = undefined;
        if (current.started) drop(current);
      },
      onPointerCancel: (event) => cancel(event.pointerId),
      onLostPointerCapture: (event) => cancel(event.pointerId),
      onClickCapture: (event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }
  return (
    <Context value={{ active, source }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <SeriesScopeDialog
        action={pending ? "save" : undefined}
        onChoose={(mode) => {
          if (!pending) return;
          setPending(undefined);
          void commit(pending, mode);
        }}
        onCancel={() => {
          setPending(undefined);
          setActive(() => undefined);
          setAnnouncement("Move cancelled");
        }}
      />
    </Context>
  );
}
