// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  renderAsync,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { layoutAllDayEvents, layoutTimeGrid } from "../lib/layout";
import { useCalendarState, useCalendars, useEventsInRange } from "../state/calendar-context";
import { columnAt, dayDistance, PX_PER_MINUTE, pointerMinutes } from "../state/drag";
import { layoutMonth, monthBarLabel } from "../state/month-layout";
import {
  addDays,
  addMonths,
  agendaGroups,
  type CalendarView,
  calendarHref,
  dateKey,
  eventTime,
  localDate,
  type Occurrence,
  occursOn,
  projectTimed,
  stepDate,
  visibleRange,
} from "../state/view";
import { CreateCalendar, useCalendarNavigation } from "./calendar-app";
import {
  type ActiveDrag,
  CalendarDragProvider,
  type DragOrigin,
  type DragSourceProps,
  useEventDrag,
} from "./event-drag";
import { useCalendarEditing } from "./event-editor";

export function EventButton({
  event,
  style,
  className = "",
  tabIndex,
  compact = false,
  accessibleName,
  day,
  drag,
  resizable = false,
}: {
  event: Occurrence;
  style?: CSSProperties;
  className?: string;
  tabIndex?: number;
  compact?: boolean;
  accessibleName?: string;
  day?: () => HTMLElement | undefined;
  /** Pointer drag handlers; the keyboard alternative is the Edit dialog. */
  drag?: DragSourceProps | undefined;
  /** Show the bottom-edge resize grip (the final segment of a timed event). */
  resizable?: boolean;
}) {
  const { openEvent } = useCalendarState();
  return (
    <button
      {...drag}
      type="button"
      className={`cal-event ${className}`}
      data-occurrence={event.id}
      style={{ ...style, borderInlineStartColor: event.calendar.colour }}
      tabIndex={tabIndex}
      title={`${event.data.name} · ${eventTime(event.data)} · ${event.calendar.title}`}
      aria-label={
        accessibleName ?? `${event.data.name}, ${eventTime(event.data)}, ${event.calendar.title}`
      }
      onClick={(e) => openEvent(event, e.currentTarget, day?.())}
    >
      <span className="cal-event-title">
        {event.data.name}
        {compact && `, ${eventTime(event.data).split("–")[0]}`}
      </span>
      {!compact && (
        <span className="cal-event-time">
          {eventTime(event.data)} · {event.calendar.title}
        </span>
      )}
      {resizable && <span className="cal-resize-handle" aria-hidden="true" />}
    </button>
  );
}
/** The live preview of a drag's target; hidden from assistive technology (announced on drop). */
function DragGhost({
  drag,
  style,
  compact = false,
}: {
  drag: ActiveDrag;
  style?: CSSProperties;
  compact?: boolean;
}) {
  const time = eventTime(drag.preview);
  return (
    <div
      className={`cal-drag-ghost${compact ? " cal-compact-event" : ""}`}
      aria-hidden="true"
      style={{ ...style, "--cal-ghost": drag.occurrence.calendar.colour } as CSSProperties}
    >
      <span className="cal-event-title">
        {drag.occurrence.data.name}
        {compact && `, ${time.split("–")[0]}`}
      </span>
      {!compact && <span className="cal-event-time">{time}</span>}
    </div>
  );
}
function MonthView({ events }: { events: Occurrence[] }) {
  const { date, navigate, weekStart } = useCalendarNavigation();
  const editing = useCalendarEditing();
  const value = localDate(date);
  const [focused, setFocused] = useState(date);
  const [agendaDay, setAgendaDay] = useState(date);
  const [phone, setPhone] = useState(false);
  const root = useRef<HTMLTableElement>(null);
  const [limit, setLimit] = useState(2);
  const weeks = layoutMonth(events, value.getFullYear(), value.getMonth() + 1, weekStart, limit);
  const { focusRequest, selected, closeEvent } = useCalendarState();
  const drag = useEventDrag();
  const ghost = drag?.active?.surface === "month" ? drag.active : undefined;
  // The month cell under the pointer; dragging keeps the time of day and the event's span.
  const dayAt = (x: number, y: number) =>
    [...(root.current?.querySelectorAll<HTMLElement>("[data-day]") ?? [])].find((cell) => {
      const rect = cell.getBoundingClientRect();
      return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
    })?.dataset.day;
  const monthOrigin =
    (fallback: string): DragOrigin =>
    (x0, y0) => {
      const from = dayAt(x0, y0) ?? fallback;
      return (x, y) => {
        const day = dayAt(x, y);
        return day ? { days: dayDistance(from, day), minutes: 0 } : undefined;
      };
    };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = () => {
      const compact = window.innerWidth < 640;
      const height = element.querySelector(".cal-month-day")?.getBoundingClientRect().height ?? 100;
      setPhone(compact);
      setLimit(compact ? 2 : Math.max(2, Math.floor((height - 68) / 28)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    const request = focusRequest.current;
    if (request?.view === "month") {
      const target = root.current?.querySelector<HTMLElement>(`[data-day="${request.date}"]`);
      if (target) {
        target.focus();
        setFocused(request.date);
        focusRequest.current = undefined;
      }
    } else setFocused(date);
    setAgendaDay(date);
  }, [date, focusRequest]);
  function onKey(event: KeyboardEvent, key: string) {
    if (event.key === "Tab" && !phone && event.target instanceof HTMLButtonElement) {
      const cell = root.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`);
      const bars = [
        ...(cell?.closest("tr")?.querySelectorAll<HTMLButtonElement>("button.cal-month-bar") ?? []),
      ].filter((button) => button.tabIndex === 0);
      const buttons = [
        ...bars,
        ...(cell?.querySelectorAll<HTMLButtonElement>(".cal-month-chip, .cal-more") ?? []),
      ];
      const index = buttons.indexOf(event.target);
      // Portal content keeps its own focus scope.
      if (index < 0) return;
      const next = buttons[index + (event.shiftKey ? -1 : 1)];
      if (next) {
        event.preventDefault();
        next.focus();
      } else if (event.shiftKey) {
        event.preventDefault();
        cell?.focus();
      } else if (key !== focused) {
        // Start native forward traversal after the focused day, skipping its earlier bar.
        cell?.focus();
      }
      return;
    }
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)
      return;
    let next: string;
    if (event.key === "ArrowRight") next = addDays(key, 1);
    else if (event.key === "ArrowLeft") next = addDays(key, -1);
    else if (event.key === "ArrowDown") next = addDays(key, 7);
    else if (event.key === "ArrowUp") next = addDays(key, -7);
    else if (event.key === "Home")
      next = addDays(key, -((localDate(key).getDay() - weekStart + 7) % 7));
    else if (event.key === "End")
      next = addDays(key, 6 - ((localDate(key).getDay() - weekStart + 7) % 7));
    else if (event.key === "PageUp" || event.key === "PageDown")
      next = stepDate("month", key, event.key === "PageUp" ? -1 : 1);
    else if (event.key === "Tab" && !event.shiftKey && !phone) {
      // A continued bar lives in its first cell; Tab must also reach it from later days.
      const week = weeks.find((week) => key >= week.startDate && key < addDays(week.startDate, 7));
      const bar = week?.bars.find((bar) => occursOn(bar.event.data, key));
      const first =
        bar &&
        root.current
          ?.querySelector(`[data-day="${key}"]`)
          ?.closest("tr")
          ?.querySelector<HTMLButtonElement>(`button[data-occurrence="${CSS.escape(bar.id)}"]`);
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    } else if (event.key === "Enter") {
      event.preventDefault();
      editing?.openQuick(key, addDays(key, 1), event.currentTarget as HTMLElement);
      return;
    } else return;
    event.preventDefault();
    setFocused(next);
    const target = root.current?.querySelector<HTMLElement>(`[data-day="${next}"]`);
    if (
      target &&
      !["PageUp", "PageDown"].includes(event.key) &&
      next.slice(0, 7) === date.slice(0, 7)
    )
      target.focus();
    else {
      focusRequest.current = { view: "month", date: next, slot: 0 };
      navigate(next, "month");
    }
  }
  const agendaLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(
    localDate(agendaDay),
  );
  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: this table implements the ARIA grid keyboard pattern */}
      <table ref={root} role="grid" className="cal-month" aria-label="Month calendar">
        <tbody>
          <tr className="cal-weekdays">
            {(weeks[0]?.days ?? []).map((cell) => (
              <th scope="col" key={cell.date}>
                {new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(
                  localDate(cell.date),
                )}
              </th>
            ))}
          </tr>
          {weeks.map((week) => (
            <tr className="cal-month-week" key={week.startDate}>
              {week.days.map((cell) => {
                const dayEvents = cell.events;
                const target = ghost && occursOn(ghost.preview, cell.date);
                const label = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(
                  localDate(cell.date),
                );
                return (
                  <td
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: focusable cell in an interactive ARIA grid
                    role="gridcell"
                    key={cell.date}
                    className="cal-month-day"
                    style={{ "--cal-bar-lanes": cell.barLanes } as CSSProperties}
                    data-outside={!cell.inMonth || undefined}
                    data-today={cell.date === dateKey(new Date()) || undefined}
                    data-day={cell.date}
                    aria-selected={phone ? cell.date === agendaDay : undefined}
                    data-drop-target={target || undefined}
                    tabIndex={cell.date === focused ? 0 : -1}
                    aria-label={label}
                    onFocus={(event) => {
                      const bar = week.bars.find(
                        (bar) => bar.id === (event.target as HTMLElement).dataset.occurrence,
                      );
                      if (
                        !bar ||
                        !occursOn(bar.event.data, focused) ||
                        focused < week.startDate ||
                        focused >= addDays(week.startDate, 7)
                      ) {
                        setFocused(cell.date);
                        if (phone && event.target === event.currentTarget) setAgendaDay(cell.date);
                      }
                    }}
                    onKeyDown={(event) => onKey(event, cell.date)}
                    onClick={(event) => {
                      if (event.target === event.currentTarget) {
                        if (phone) setAgendaDay(cell.date);
                        else
                          editing?.openQuick(cell.date, addDays(cell.date, 1), event.currentTarget);
                      }
                    }}
                  >
                    {phone ? (
                      <button
                        type="button"
                        className="cal-month-open"
                        tabIndex={-1}
                        aria-label={`Show events on ${label}${cell.hidden ? `, ${cell.hidden} more events` : ""}`}
                        aria-controls="cal-month-agenda"
                        onClick={() => {
                          setAgendaDay(cell.date);
                          setFocused(cell.date);
                        }}
                      >
                        <span className="cal-day-number">{cell.dayOfMonth}</span>
                        {cell.hidden > 0 && <span className="cal-phone-more">+{cell.hidden}</span>}
                      </button>
                    ) : (
                      <Link
                        tabIndex={-1}
                        href={calendarHref("day", cell.date)}
                        className="cal-day-number"
                        aria-label={`Open ${label}`}
                      >
                        {cell.dayOfMonth}
                      </Link>
                    )}
                    {week.bars
                      .filter((bar) => bar.column === cell.column)
                      .map((bar) => {
                        const className = `cal-month-bar${bar.continuesBefore ? " cal-continues-before" : ""}${bar.continuesAfter ? " cal-continues-after" : ""}`;
                        const style = {
                          "--cal-bar-span": bar.span,
                          "--cal-event-lane": bar.lane,
                        } as CSSProperties;
                        const name = `${monthBarLabel(bar.event.data)}, ${bar.event.calendar.title}`;
                        return phone ? (
                          <span
                            key={bar.id}
                            role="img"
                            aria-label={name}
                            className={`${className} cal-month-mark`}
                            style={{ ...style, borderInlineStartColor: bar.event.calendar.colour }}
                          />
                        ) : (
                          <EventButton
                            key={bar.id}
                            event={bar.event}
                            accessibleName={name}
                            className={className}
                            style={style}
                            tabIndex={
                              occursOn(bar.event.data, focused) &&
                              focused >= week.startDate &&
                              focused < addDays(week.startDate, 7)
                                ? 0
                                : -1
                            }
                            day={() =>
                              root.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`) ??
                              undefined
                            }
                            drag={drag?.source(bar.event, "month", monthOrigin(cell.date))}
                          />
                        );
                      })}
                    <div className="cal-month-timed">
                      {cell.timed.map((event, index) =>
                        phone ? (
                          <span
                            key={event.id}
                            className="cal-month-dot"
                            role="img"
                            aria-label={`${event.data.name}, ${eventTime(event.data)}`}
                            style={
                              {
                                "--cal-event-lane": cell.barLanes + index,
                                "--cal-dot-colour": event.calendar.colour,
                              } as CSSProperties
                            }
                          />
                        ) : (
                          <EventButton
                            key={event.id}
                            event={event}
                            className="cal-month-chip"
                            tabIndex={focused === cell.date ? 0 : -1}
                            drag={drag?.source(event, "month", monthOrigin(cell.date))}
                          />
                        ),
                      )}
                    </div>
                    {target && <DragGhost drag={ghost} />}
                    {cell.hidden > 0 && !phone && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="cal-more"
                            tabIndex={focused === cell.date ? 0 : -1}
                            aria-label={`${cell.hidden} more events on ${label}`}
                          >{`+${cell.hidden} more`}</button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="cal-overflow"
                          aria-label={`Events on ${label}`}
                          onInteractOutside={(event) => {
                            if (selected) event.preventDefault();
                          }}
                          onEscapeKeyDown={(event) => {
                            if (selected) {
                              event.preventDefault();
                              closeEvent();
                            }
                          }}
                        >
                          <h2>{label}</h2>
                          <Link href={calendarHref("day", cell.date)}>Open day</Link>
                          {dayEvents.map((event) => (
                            <EventButton
                              key={event.id}
                              event={event}
                              day={() =>
                                root.current?.querySelector<HTMLElement>(
                                  `[data-day="${cell.date}"]`,
                                ) ?? undefined
                              }
                            />
                          ))}
                        </PopoverContent>
                      </Popover>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {phone && (
        <section
          id="cal-month-agenda"
          className="cal-month-agenda"
          aria-label={`Events on ${agendaLabel}`}
        >
          <h2 aria-live="polite">{agendaLabel}</h2>
          <Link href={calendarHref("day", agendaDay)}>Open day</Link>
          {events
            .filter((event) => occursOn(event.data, agendaDay))
            .map((event) => (
              <EventButton
                key={event.id}
                event={event}
                accessibleName={`${monthBarLabel(event.data)}, ${eventTime(event.data)}, ${event.calendar.title}`}
                day={() =>
                  root.current?.querySelector<HTMLElement>(`[data-day="${agendaDay}"]`) ?? undefined
                }
              />
            ))}
          {!events.some((event) => occursOn(event.data, agendaDay)) && <p>No events</p>}
        </section>
      )}
    </>
  );
}
function TimeView({ events, view }: { events: Occurrence[]; view: "week" | "day" }) {
  const { date, navigate, weekStart } = useCalendarNavigation();
  const editing = useCalendarEditing();
  const openSlot = (day: string, slot: number, anchor: HTMLElement) => {
    const start = localDate(day);
    start.setMinutes(slot * 30);
    editing?.openQuick(start, new Date(+start + 3600000), anchor);
  };
  const range = visibleRange(view, date, weekStart);
  const count = view === "week" ? 7 : 1;
  const days = Array.from({ length: count }, (_, i) => addDays(range.from, i));
  const projected = projectTimed(events, range.from, count);
  // Collision intervals include the 24px target at 0.8px per minute.
  const placements = layoutTimeGrid(
    projected.map((event) => ({
      ...event,
      endMinute: Math.min(1440, Math.max(event.endMinute, event.startMinute + 30)),
    })),
    count,
  );
  const allDay = events.filter((e) => typeof e.data.start === "string");
  const bars = layoutAllDayEvents(
    allDay.map((event) => ({
      id: event.id,
      startDate: event.data.start as string,
      endDate:
        typeof event.data.end === "string"
          ? event.data.end
          : addDays(event.data.start as string, 1),
    })),
    range.from,
    count,
  );
  const [focus, setFocus] = useState({ day: date, slot: 14 });
  const [eventMode, setEventMode] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const { focusRequest } = useCalendarState();
  const drag = useEventDrag();
  const ghost = drag?.active && drag.active.surface !== "month" ? drag.active : undefined;
  const ghostSegments =
    ghost?.surface === "time"
      ? projectTimed([{ ...ghost.occurrence, data: ghost.preview }], range.from, count)
      : [];
  const ghostBar =
    ghost?.surface === "all-day"
      ? layoutAllDayEvents(
          [
            {
              id: ghost.occurrence.id,
              startDate: ghost.preview.start as string,
              endDate:
                typeof ghost.preview.end === "string"
                  ? ghost.preview.end
                  : addDays(ghost.preview.start as string, 1),
            },
          ],
          range.from,
          count,
        ).bars[0]
      : undefined;
  const columns = () =>
    Array.from(grid.current?.querySelectorAll<HTMLElement>("[data-event-day]") ?? [], (column) =>
      column.getBoundingClientRect(),
    );
  // Columns follow the pointer (scrolling included); minutes follow its vertical travel.
  const timeOrigin: DragOrigin = (x0, y0) => {
    const from = columnAt(x0, columns());
    const top = scroll.current?.scrollTop ?? 0;
    return (x, y) => ({
      days: columnAt(x, columns()) - from,
      minutes: pointerMinutes(y - y0 + (scroll.current?.scrollTop ?? 0) - top),
    });
  };
  const allDayOrigin: DragOrigin = (x0) => {
    const from = columnAt(x0, columns());
    return (x) => ({ days: columnAt(x, columns()) - from, minutes: 0 });
  };
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const first = events
      .filter((e) => e.data.start instanceof Date)
      .map((e) => (e.data.start as Date).getHours());
    if (scrolled.current) return;
    scrolled.current = true;
    if (scroll.current) scroll.current.scrollTop = Math.min(7, ...first) * 48;
  }, [events]);
  useEffect(() => {
    const request = focusRequest.current;
    if (request?.view === view) {
      const target = grid.current?.querySelector<HTMLElement>(
        `[data-slot="${request.date}:${request.slot}"]`,
      );
      if (target) {
        target.focus();
        setFocus({ day: request.date, slot: request.slot });
        focusRequest.current = undefined;
      }
    }
  }, [focusRequest, view]);
  function move(event: KeyboardEvent, day: string, slot: number) {
    let nextDay = day;
    let nextSlot = slot;
    if (event.key === "ArrowDown") nextSlot = Math.min(47, slot + 1);
    else if (event.key === "ArrowUp") nextSlot = Math.max(0, slot - 1);
    else if (event.key === "ArrowLeft") nextDay = addDays(day, -1);
    else if (event.key === "ArrowRight") nextDay = addDays(day, 1);
    else if (event.key === "Enter") {
      event.preventDefault();
      openSlot(day, slot, event.currentTarget as HTMLElement);
      return;
    } else if (event.key === "Tab" && !event.shiftKey) {
      const allDayEvent = bars.bars
        .map((bar) => allDay.find((event) => event.id === bar.id) as Occurrence)
        .find((event) => occursOn(event.data, day));
      const first = allDayEvent
        ? scroll.current?.querySelector<HTMLButtonElement>(
            `[data-occurrence="${CSS.escape(allDayEvent.id)}"]`,
          )
        : grid.current?.querySelector<HTMLButtonElement>(`[data-event-day="${day}"] button`);
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    } else return;
    event.preventDefault();
    setFocus({ day: nextDay, slot: nextSlot });
    const target = grid.current?.querySelector<HTMLElement>(`[data-slot="${nextDay}:${nextSlot}"]`);
    if (target) target.focus();
    else {
      focusRequest.current = { view, date: nextDay, slot: nextSlot };
      navigate(nextDay);
    }
  }
  return (
    <div
      ref={scroll}
      className={`cal-time-scroll cal-time-${view}`}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).closest("button.cal-event")) setEventMode(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEventMode(false);
      }}
    >
      <div className="cal-time-content" style={{ minWidth: count * 88 + 48 }}>
        <div
          className="cal-time-header"
          style={{ gridTemplateColumns: `48px repeat(${count}, minmax(88px, 1fr))` }}
        >
          <span className="cal-zone" title={Intl.DateTimeFormat().resolvedOptions().timeZone}>
            Time
          </span>
          {days.map((day) => (
            <Link
              key={day}
              href={calendarHref("day", day)}
              aria-current={day === dateKey(now) ? "date" : undefined}
            >
              {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(
                localDate(day),
              )}
            </Link>
          ))}
        </div>
        <div className="cal-all-day">
          <span className="cal-gutter-label">All day</span>
          <div className="cal-all-day-events" style={{ height: Math.max(32, bars.laneCount * 30) }}>
            <div
              className="cal-all-day-slots"
              style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}
            >
              {days.map((day) => (
                <button
                  type="button"
                  key={day}
                  aria-label={`Create all-day event on ${day}`}
                  onClick={(event) => editing?.openQuick(day, addDays(day, 1), event.currentTarget)}
                />
              ))}
            </div>
            {bars.bars.map((bar) => {
              const event = allDay.find((e) => e.id === bar.id) as Occurrence;
              return (
                <EventButton
                  key={bar.id}
                  event={event}
                  className="cal-all-day-bar"
                  tabIndex={eventMode && occursOn(event.data, focus.day) ? 0 : -1}
                  style={{
                    left: `${bar.left * 100}%`,
                    width: `${bar.width * 100}%`,
                    top: bar.lane * 30,
                  }}
                  drag={drag?.source(event, "all-day", allDayOrigin)}
                />
              );
            })}
            {ghost && ghostBar && (
              <DragGhost
                drag={ghost}
                style={{
                  left: `${ghostBar.left * 100}%`,
                  width: `${ghostBar.width * 100}%`,
                  top: 0,
                  height: 26,
                }}
              />
            )}
          </div>
        </div>
        <div className="cal-time-body" ref={grid}>
          <div className="cal-hour-gutter" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={String(hour)} style={{ top: hour * 48 }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <table
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: this table implements the ARIA grid keyboard pattern
            role="grid"
            className="cal-slots"
            aria-label={`${view === "week" ? "Week" : "Day"} time grid`}
            style={{ gridTemplateColumns: `repeat(${count}, minmax(88px, 1fr))` }}
          >
            <tbody>
              {Array.from({ length: 48 }, (_, slot) => (
                <tr className="cal-slot-row" key={String(slot)}>
                  {days.map((day) => (
                    <td
                      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: focusable cell in an interactive ARIA grid
                      role="gridcell"
                      key={day}
                      className="cal-slot"
                      data-slot={`${day}:${slot}`}
                      tabIndex={!eventMode && focus.day === day && focus.slot === slot ? 0 : -1}
                      aria-label={`${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(localDate(day))}, ${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`}
                      onFocus={() => {
                        setFocus({ day, slot });
                        setEventMode(false);
                      }}
                      onKeyDown={(event) => move(event, day, slot)}
                      onClick={(event) => openSlot(day, slot, event.currentTarget)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className="cal-event-layer"
            style={{ gridTemplateColumns: `repeat(${count}, minmax(88px, 1fr))` }}
          >
            {days.map((day, index) => (
              <div className="cal-event-day" data-event-day={day} key={day}>
                {placements
                  .filter((p) => p.day === index)
                  .map((placement) => {
                    const event = projected.find((p) => p.id === placement.id)?.event as Occurrence;
                    const start = event.data.start as Date;
                    const end = event.data.end instanceof Date ? event.data.end : start;
                    return (
                      <EventButton
                        key={placement.id}
                        event={event}
                        className={`cal-timed-event${placement.height * 1152 < 40 ? " cal-compact-event" : ""}`}
                        compact={placement.height * 1152 < 40}
                        tabIndex={eventMode && focus.day === day ? 0 : -1}
                        style={{
                          left: `${placement.left * 100}%`,
                          width: `calc(${placement.width * 100}% - 3px)`,
                          top: placement.top * 1152,
                          height: Math.max(24, placement.height * 1152),
                        }}
                        drag={drag?.source(event, "time", timeOrigin)}
                        resizable={dateKey(new Date(Math.max(+start, +end - 1))) === day}
                      />
                    );
                  })}
                {ghost &&
                  ghostSegments
                    .filter((segment) => segment.day === index)
                    .map((segment) => (
                      <DragGhost
                        key={segment.id}
                        drag={ghost}
                        compact={(segment.endMinute - segment.startMinute) * PX_PER_MINUTE < 40}
                        style={{
                          top: segment.startMinute * PX_PER_MINUTE,
                          height: Math.max(
                            24,
                            (segment.endMinute - segment.startMinute) * PX_PER_MINUTE,
                          ),
                        }}
                      />
                    ))}
                {day === dateKey(now) && (
                  <div
                    className="cal-now"
                    aria-hidden="true"
                    style={{ top: (now.getHours() * 60 + now.getMinutes()) * 0.8 }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function Agenda({
  events,
  from,
  to,
  incomplete,
}: {
  events: Occurrence[];
  from: string;
  to: string;
  incomplete: boolean;
}) {
  const groups = agendaGroups(events, from, to);
  return (
    <div className="cal-agenda">
      {groups.length === 0 && !incomplete && (
        <EmptyState title="No events" body="There are no events in this date range." />
      )}
      {groups.map(({ day, events: dayEvents }) => (
        <section key={day}>
          <h2>
            {new Intl.DateTimeFormat("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(localDate(day))}
          </h2>
          {dayEvents.map((event) => (
            <EventButton key={event.id} event={event} />
          ))}
        </section>
      ))}
    </div>
  );
}
export function CalendarScreen({ view }: { view: CalendarView }) {
  const { date, weekStart } = useCalendarNavigation();
  const [agendaDays, setAgendaDays] = useState(30);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new anchor resets pagination
  useEffect(() => setAgendaDays(30), [date]);
  const range = visibleRange(view, date, weekStart, agendaDays);
  const calendars = useCalendars();
  const state = useEventsInRange(range.from, range.to);
  return (
    <CalendarDragProvider>
      <div className="cal-screen">
        <CalendarWarnings state={state} />
        {renderAsync({
          loading: (calendars.status === "loading" ||
            (calendars.status === "ready" && state.status === "loading")) && (
            <LoadingSkeleton preset="grid" label="Loading events" />
          ),
          error:
            calendars.status === "error" || state.status === "error" ? (
              <ErrorState error="unreachable" actions={{ retry: calendars.reload }} />
            ) : undefined,
          empty:
            calendars.status === "ready" &&
            calendars.calendars.length === 0 &&
            !calendars.warnings.length ? (
              <EmptyState
                title="Your calendar starts here"
                body="Create a calendar to keep your events together."
                primaryAction={<CreateCalendar />}
              />
            ) : undefined,
          children: () =>
            state.status === "ready" && (
              <>
                <div aria-live="polite" className="sr-only">
                  {state.events.length} events loaded
                </div>
                {view === "month" ? (
                  <MonthView events={state.events} />
                ) : view === "agenda" ? (
                  <>
                    <Agenda
                      events={state.events}
                      from={range.from}
                      to={range.to}
                      incomplete={Boolean(state.warnings.length)}
                    />
                    <Button
                      className="cal-load-more"
                      variant="outline"
                      onClick={() => setAgendaDays((n) => n + 30)}
                    >
                      Load more
                    </Button>
                  </>
                ) : (
                  <TimeView key={`${view}:${range.from}`} events={state.events} view={view} />
                )}
              </>
            ),
        })}
      </div>
    </CalendarDragProvider>
  );
}
function CalendarWarnings({ state }: { state: ReturnType<typeof useEventsInRange> }) {
  return (
    state.status === "ready" &&
    state.warnings.map((warning, index) => (
      <div className="cal-warning" role="status" key={String(index)}>
        {warning.title}.{" "}
        <Button variant="ghost" onClick={state.reload}>
          Retry
        </Button>
      </div>
    ))
  );
}
export function CalendarSearch() {
  const params = useSearchParams();
  const { date } = useCalendarNavigation();
  const q = params.get("q")?.trim().toLocaleLowerCase() ?? "";
  const from = addMonths(date, -6);
  const to = addMonths(date, 6);
  const state = useEventsInRange(from, to);
  const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
  const matches =
    state.status === "ready"
      ? state.events.filter((e) =>
          [e.data.name, e.data.location, e.data.description].some((v) =>
            v?.toLocaleLowerCase().includes(q),
          ),
        )
      : [];
  return (
    <div className="cal-search-results">
      <p>
        Searching events from {format.format(localDate(from))} to {format.format(localDate(to))}
      </p>
      <CalendarWarnings state={state} />
      {renderAsync({
        loading: state.status === "loading" && <LoadingSkeleton />,
        error: state.status === "error" && (
          <ErrorState error="unreachable" actions={{ retry: state.reload }} />
        ),
        empty: state.status === "ready" && !state.warnings.length && !matches.length && (
          <EmptyState variant="no-results" query={q} />
        ),
        children: (
          <>
            <p role="status">{matches.length} results loaded</p>
            {state.status === "ready" && Boolean(state.warnings.length) && (
              <p>Search results may be incomplete.</p>
            )}
            {matches.map((event) => (
              <div key={event.id}>
                <p>{format.format(localDate(dateKey(event.data.start)))}</p>
                <EventButton event={event} />
              </div>
            ))}
          </>
        ),
      })}
    </div>
  );
}
