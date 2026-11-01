// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Calendar,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  LoadingSkeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toaster,
} from "@jeswr/suite-ui";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider } from "@/lib/session/pod-session";
import { CalendarProvider, useCalendarState, useCalendars } from "../state/calendar-context";
import {
  type CalendarView,
  calendarHref,
  dateKey,
  eventDateRange,
  isView,
  localDate,
  PALETTE,
  parseDate,
  rangeTitle,
  recurrenceSummary,
  reminderSummary,
  stepDate,
  VIEWS,
} from "../state/view";

export function useCalendarNavigation() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { prefs, setPrefs } = useCalendarState();
  const segment = pathname.split("/")[2] ?? "week";
  const view = isView(segment) ? segment : prefs.view;
  const date = parseDate(params.get("d"));
  const navigate = useCallback(
    (nextDate: string, nextView: CalendarView = view) => {
      const href = calendarHref(nextView, nextDate);
      if (nextView === view) router.replace(href);
      else router.push(href);
      setPrefs((current) => ({ ...current, view: nextView }));
    },
    [router, view, setPrefs],
  );
  return { date, view, navigate, weekStart: prefs.weekStart };
}
export function CreateCalendar() {
  const { create } = useCalendarState();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(PALETTE[0] as string);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" />
        Create calendar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="cal-create">
          <DialogTitle>Create calendar</DialogTitle>
          <DialogDescription>Choose a name and colour for your calendar.</DialogDescription>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setSaving(true);
              setError("");
              try {
                await create(name, colour);
                setOpen(false);
                setName("");
              } catch {
                setError("Couldn't create this calendar. Try another name or retry.");
              } finally {
                setSaving(false);
              }
            }}
          >
            <label htmlFor="cal-name">Name</label>
            <Input
              id="cal-name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <fieldset>
              <legend>Colour</legend>
              <div className="cal-colour-options">
                {PALETTE.map((value, index) => (
                  <label key={value} title={`Colour ${index + 1}`}>
                    <input
                      type="radio"
                      name="calendar-colour"
                      aria-label={`Colour ${index + 1}`}
                      checked={value === colour}
                      onChange={() => setColour(value)}
                    />
                    <span className="cal-swatch" style={{ background: value }} />
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Sidebar() {
  const { date, view, navigate, weekStart } = useCalendarNavigation();
  const calendars = useCalendars();
  const { prefs, setPrefs } = useCalendarState();
  return (
    <div className="cal-sidebar">
      <h2>Calendar</h2>
      <CreateCalendar />
      <Calendar
        mode="single"
        selected={localDate(date)}
        month={localDate(date)}
        onMonthChange={(d) => navigate(dateKey(d), view)}
        onSelect={(d) => d && navigate(dateKey(d), view)}
        weekStartsOn={weekStart as 0 | 1 | 2 | 3 | 4 | 5 | 6}
      />
      <h3>My calendars</h3>
      {calendars.status === "ready" &&
        calendars.calendars.map((calendar) => (
          <label className="cal-calendar-choice" key={calendar.url} htmlFor={`cal-${calendar.url}`}>
            <Checkbox
              id={`cal-${calendar.url}`}
              checked={!prefs.hidden.includes(calendar.url)}
              onCheckedChange={(checked) =>
                setPrefs((current) => ({
                  ...current,
                  hidden: checked
                    ? current.hidden.filter((id) => id !== calendar.url)
                    : [...current.hidden, calendar.url],
                }))
              }
              aria-label={`Show ${calendar.title} calendar`}
            />
            <span className="cal-swatch" style={{ background: calendar.colour }} />
            <span>{calendar.title}</span>
          </label>
        ))}
      <h3>Shared with me</h3>
      <p className="cal-muted">No shared calendars yet.</p>
      <label className="cal-week-preference">
        Week starts on
        <select
          aria-label="Week starts on"
          value={prefs.weekStart}
          onChange={(e) =>
            setPrefs((current) => ({ ...current, weekStart: Number(e.target.value) }))
          }
        >
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
            (day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  );
}
function Details() {
  const { selected, closeEvent } = useCalendarState();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  if (!selected) return null;
  const event = selected.data;
  return (
    <div className="cal-details">
      <header>
        <h2>{event.name}</h2>
        <IconButton ref={close} variant="ghost" label="Close event details" onClick={closeEvent}>
          <X size={20} aria-hidden="true" />
        </IconButton>
      </header>
      <p className="cal-calendar-name">
        <span className="cal-swatch" style={{ background: selected.calendar.colour }} />
        {selected.calendar.title}
      </p>
      <p>{eventDateRange(event)}</p>
      {event.recurrence && <p>{recurrenceSummary(event.recurrence)}</p>}
      {event.location && (
        <>
          <h3>Location</h3>
          <p>{event.location}</p>
        </>
      )}
      {event.description && (
        <>
          <h3>Description</h3>
          <p className="cal-description">{event.description}</p>
        </>
      )}
      <h3>Reminders</h3>
      {event.reminders?.length ? (
        <ul>
          {event.reminders.map((reminder, index) => (
            <li key={String(index)}>{reminderSummary(reminder)}</li>
          ))}
        </ul>
      ) : (
        <p>No reminders</p>
      )}
    </div>
  );
}
function CalendarChrome({ children }: { children: ReactNode }) {
  const { date, view, navigate, weekStart } = useCalendarNavigation();
  const { selected, closeEvent } = useCalendarState();
  const pathname = usePathname();
  const search = pathname === "/calendar/search";
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) {
        closeEvent();
        return;
      }
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable], [role=dialog]",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "t") navigate(dateKey(new Date()));
      else if (key === "j" || key === "n") navigate(stepDate(view, date, 1));
      else if (key === "k" || key === "p") navigate(stepDate(view, date, -1));
      else if (["m", "w", "d", "a"].includes(key))
        navigate(
          date,
          ({ m: "month", w: "week", d: "day", a: "agenda" } as const)[key as "m" | "w" | "d" | "a"],
        );
      else return;
      event.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [date, view, navigate, selected, closeEvent]);
  return (
    <SuiteFrame
      app="calendar"
      sidebar={<Sidebar />}
      context={
        <div className="cal-top-context">
          <CalendarDays size={20} aria-hidden="true" />
          <h1>{search ? "Search events" : rangeTitle(view, date, weekStart)}</h1>
        </div>
      }
      search={{
        placeholder: "Search in Calendar",
        scopeLabel: "in Calendar",
        action: "/calendar/search",
      }}
      details={selected ? <Details key={selected.id} /> : undefined}
      onDetailsClose={closeEvent}
    >
      {!search && (
        <div className="cal-toolbar" role="toolbar" aria-label="Calendar navigation">
          <Button variant="outline" onClick={() => navigate(dateKey(new Date()))}>
            Today
          </Button>
          <IconButton
            variant="ghost"
            label={`Previous ${view === "agenda" ? "30 days" : view}`}
            onClick={() => navigate(stepDate(view, date, -1))}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Next ${view === "agenda" ? "30 days" : view}`}
            onClick={() => navigate(stepDate(view, date, 1))}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </IconButton>
          <Popover open={picker} onOpenChange={setPicker}>
            <PopoverTrigger asChild>
              <IconButton variant="ghost" label="Choose date">
                <CalendarDays size={20} aria-hidden="true" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent className="cal-picker">
              <Calendar
                mode="single"
                selected={localDate(date)}
                defaultMonth={localDate(date)}
                weekStartsOn={weekStart as 0 | 1 | 2 | 3 | 4 | 5 | 6}
                onSelect={(day) => {
                  if (day) {
                    navigate(dateKey(day));
                    setPicker(false);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
          <label className="cal-view-switch">
            <span className="sr-only">Calendar view</span>
            <select
              aria-label="Calendar view"
              value={view}
              onChange={(event) => navigate(date, event.target.value as CalendarView)}
            >
              {VIEWS.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {children}
    </SuiteFrame>
  );
}
export function CalendarApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <Suspense fallback={<LoadingSkeleton preset="grid" />}>
        <CalendarProvider>
          <CalendarChrome>{children}</CalendarChrome>
        </CalendarProvider>
      </Suspense>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
