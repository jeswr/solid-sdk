// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, IconButton } from "@jeswr/suite-ui";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { dateFromDayKey, localDayKey, shortDayLabel, startOfWeek } from "../../lib/views/days";
import { agenda, shiftWeek, weekStrip } from "../../lib/views/upcoming";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { AddTaskRow } from "../add-task-row";
import { useDropTarget } from "../dnd/use-task-drag";
import { CrossProjectView } from "./cross-project-view";
import { ViewGroup } from "./view-group";

/** A week-strip cell is also a drop target: dropping a row reschedules it to that day. */
function DayCell({ dayKey, ...props }: ComponentProps<"button"> & { dayKey: string }) {
  const drop = useDropTarget(`strip:${dayKey}`, { kind: "day", dayKey });
  return <button ref={drop.ref} data-drop-over={drop.over || undefined} {...props} type="button" />;
}

export function UpcomingView() {
  const tasks = useTasks();
  const now = useNow();
  const { preferences } = useTasksPreferences();
  const [anchor, setAnchor] = useState<Date | "today" | undefined>();
  const start =
    anchor === "today"
      ? dateFromDayKey(localDayKey(now))
      : (anchor ?? startOfWeek(now, preferences.weekStart));
  const strip = weekStrip(start, tasks.views, now);
  const groups = agenda(start, tasks.views, now);
  const rows = [
    ...(groups.overdue ?? []),
    ...groups.days.flatMap((day) => day.tasks),
    ...groups.later,
  ];
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
        <nav className="tsk-week" aria-label="Upcoming week">
          <div className="tsk-week-controls">
            <IconButton
              label="Previous week"
              variant="ghost"
              onClick={() => setAnchor(shiftWeek(start, -1))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </IconButton>
            <span>
              {shortDayLabel(start)} – {shortDayLabel(strip[6]?.date ?? start)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnchor("today");
                setSelected(undefined);
              }}
            >
              Today
            </Button>
            <IconButton
              label="Next week"
              variant="ghost"
              onClick={() => setAnchor(shiftWeek(start, 1))}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="tsk-week-strip" ref={stripRoot}>
            {strip.map((day) => (
              <DayCell
                key={day.dayKey}
                dayKey={day.dayKey}
                className="tsk-day-cell"
                data-day-key={day.dayKey}
                data-today={day.isToday || undefined}
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
                <span aria-hidden="true">{day.weekdayLetter}</span>
                <strong aria-hidden="true">{day.dayOfMonth}</strong>
                <span className="tsk-day-count" aria-hidden="true">
                  <span className="tsk-day-dot" data-empty={!day.count || undefined} />
                  {day.count}
                </span>
              </DayCell>
            ))}
          </div>
        </nav>
      }
    >
      <div ref={root}>
        {groups.overdue && groups.overdue.length > 0 && (
          <ViewGroup
            title="Overdue"
            rows={groups.overdue}
            collapsible
            destructive
            container={{ kind: "day" }}
          />
        )}
        {groups.days.map((day) => (
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
        <ViewGroup
          title="Later"
          rows={groups.later}
          collapsible
          defaultCollapsed
          container={{ kind: "day" }}
        />
      </div>
    </CrossProjectView>
  );
}
