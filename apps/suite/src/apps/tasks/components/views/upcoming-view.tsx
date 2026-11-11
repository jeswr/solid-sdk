// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, IconButton } from "@jeswr/suite-ui";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { filterDateRange, presetRange, rangeDays } from "../../lib/views/date-ranges";
import { dateFromDayKey, localDayKey, shortDayLabel } from "../../lib/views/days";
import { compareDue, taskDayKey } from "../../lib/views/today";
import { shiftWeek, weekStrip } from "../../lib/views/upcoming";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { AddTaskRow } from "../add-task-row";
import { useDropTarget } from "../dnd/use-task-drag";
import { CrossProjectView } from "./cross-project-view";
import { DateRangeControl, useTaskDateRange } from "./date-range-control";
import { GroupedTasks } from "./grouped-tasks";
import { ViewGroup } from "./view-group";

/**
 * A week-strip cell is also a drop target: dropping a row reschedules it to that day. The
 * weekday letter and task count are decorative overlays beside the button, so the button's
 * visible text (the date) stays within its expanded accessible name (WCAG 2.5.3).
 */
function DayCell({
  dayKey,
  letter,
  count,
  today,
  ...props
}: ComponentProps<"button"> & { dayKey: string; letter: string; count: number; today: boolean }) {
  const drop = useDropTarget(`strip:${dayKey}`, { kind: "day", dayKey });
  return (
    <div className="tsk-day" data-today={today || undefined}>
      <button
        ref={drop.ref}
        data-drop-over={drop.over || undefined}
        data-today={today || undefined}
        {...props}
        type="button"
      />
      <span className="tsk-day-letter" aria-hidden="true">
        {letter}
      </span>
      <span className="tsk-day-count" aria-hidden="true">
        <span className="tsk-day-dot" data-empty={!count || undefined} />
        {count}
      </span>
    </div>
  );
}

export function UpcomingView() {
  const tasks = useTasks();
  const now = useNow();
  const viewId = useRoutePathname();
  const { preferences } = useTasksPreferences();
  const grouped = (preferences.groupBy[viewId] ?? "none") !== "none";
  const { range, change, weekStart } = useTaskDateRange("upcoming", now);
  const start = dateFromDayKey(range.from);
  const strip = weekStrip(start, tasks.views, now).filter((day) => day.dayKey <= range.to);
  const rows = filterDateRange(tasks.views, range, "upcoming").sort(compareDue);
  const days = rangeDays(range).map((dayKey) => ({
    dayKey,
    label: shortDayLabel(dateFromDayKey(dayKey)),
    tasks: rows.filter((task) => taskDayKey(task) === dayKey),
  }));
  const shift = (direction: -1 | 1) =>
    change({
      from: localDayKey(shiftWeek(start, direction)),
      to: localDayKey(shiftWeek(dateFromDayKey(range.to), direction)),
    });
  const root = useRef<HTMLDivElement>(null);
  const stripRoot = useRef<HTMLDivElement>(null);
  const project =
    tasks.projects.find((project) => project.url === tasks.inboxUrl) ?? tasks.projects[0];
  const [selected, setSelected] = useState<string>();
  const visibleDayKey = (
    strip.find((day) => day.dayKey === selected) ??
    strip.find((day) => day.isToday) ??
    strip[0]
  )?.dayKey;
  // Narrower viewports can still scroll: reveal the selection, Today, or the week's first day.
  useEffect(() => {
    const active = stripRoot.current?.querySelector<HTMLElement>(
      `[data-day-key="${visibleDayKey}"]`,
    );
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [visibleDayKey]);
  return (
    <CrossProjectView
      title="Upcoming"
      rows={rows}
      emptyTitle=""
      emptyIcon={<CalendarRange aria-hidden="true" />}
      toolbar={
        <>
          <DateRangeControl kind="upcoming" now={now} range={range} onChange={change} />
          <nav className="tsk-week" aria-label="Upcoming week">
            <div className="tsk-week-controls">
              <IconButton label="Previous week" variant="ghost" onClick={() => shift(-1)}>
                <ChevronLeft size={18} aria-hidden="true" />
              </IconButton>
              <span>
                {shortDayLabel(start)} – {shortDayLabel(dateFromDayKey(range.to))}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  change(presetRange("next7", now, weekStart));
                  setSelected(undefined);
                }}
              >
                Today
              </Button>
              <IconButton label="Next week" variant="ghost" onClick={() => shift(1)}>
                <ChevronRight size={18} aria-hidden="true" />
              </IconButton>
            </div>
            {!grouped && (
              <div className="tsk-week-strip" ref={stripRoot}>
                {strip.map((day) => (
                  <DayCell
                    key={day.dayKey}
                    dayKey={day.dayKey}
                    className="tsk-day-cell"
                    data-day-key={day.dayKey}
                    today={day.isToday}
                    letter={day.weekdayLetter}
                    count={day.count}
                    aria-current={day.isToday ? "date" : undefined}
                    aria-pressed={selected === day.dayKey}
                    aria-label={`${shortDayLabel(day.date)}, ${day.count} ${day.count === 1 ? "task" : "tasks"}`}
                    onClick={() => {
                      setSelected(day.dayKey);
                      const heading = root.current?.querySelector<HTMLElement>(
                        `h2[data-day-key="${day.dayKey}"]`,
                      );
                      heading?.scrollIntoView?.({ block: "start", behavior: "instant" });
                      heading?.focus({ preventScroll: true });
                    }}
                  >
                    <strong>{day.dayOfMonth}</strong>
                  </DayCell>
                ))}
              </div>
            )}
          </nav>
        </>
      }
    >
      <GroupedTasks rows={rows}>
        <div ref={root}>
          {days.map((day) => (
            <ViewGroup
              key={day.dayKey}
              title={day.label}
              dayKey={day.dayKey}
              rows={day.tasks}
              container={{ kind: "day", dayKey: day.dayKey }}
            >
              {project && (
                <AddTaskRow
                  project={project}
                  due={{ date: dateFromDayKey(day.dayKey), allDay: day.dayKey }}
                />
              )}
            </ViewGroup>
          ))}
        </div>
      </GroupedTasks>
    </CrossProjectView>
  );
}
