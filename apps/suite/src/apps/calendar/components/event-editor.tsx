// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Input,
  LoadingSkeleton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Switch,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import {
  DateTimeField,
  type DateTimeValue,
  fromRRule,
  RecurrenceEditor,
  recurrenceSummary,
  toRRule,
  type RecurrenceRule as UiRule,
} from "@jeswr/suite-ui/date-time";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  asDate,
  type CalendarDate,
  type CalendarEvent,
  calendarIO,
  expandEvent,
  importICal,
  ruleToICal,
  type StoredItem,
  validateEvent,
} from "../lib/model";
import { useCalendarState, useEventMutations } from "../state/calendar-context";
import {
  decodeEventRef,
  editorRecurrence,
  planSeriesEdit,
  quickDraft,
  type SeriesMode,
} from "../state/editing";
import { type CalendarInfo, calendarHref, dateKey, eventDateRange, localDate } from "../state/view";
import { CalendarScreen } from "./calendar-views";

interface Quick {
  data: CalendarEvent;
  anchor: HTMLElement;
}
const Editing = createContext<
  | {
      openQuick: (start: CalendarDate, end: CalendarDate, anchor: HTMLElement) => void;
      draft: CalendarEvent | undefined;
      consumeDraft: () => void;
      lastCalendar: string;
      remember: (calendar: string) => void;
    }
  | undefined
>(undefined);
export function useCalendarEditing() {
  return useContext(Editing);
}
function useLarge() {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setLarge(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return large;
}
export function CalendarEditingProvider({ children }: { children: ReactNode }) {
  const { calendars, prefs, session } = useCalendarState();
  const [quick, setQuick] = useState<Quick>();
  const [draft, setDraft] = useState<CalendarEvent>();
  const [lastCalendar, setLast] = useState("");
  const key = `suite:calendar:last:${session.webId}`;
  useEffect(() => {
    try {
      setLast(localStorage.getItem(key) ?? "");
    } catch {}
  }, [key]);
  const remember = (calendar: string) => {
    setLast(calendar);
    try {
      localStorage.setItem(key, calendar);
    } catch {}
  };
  return (
    <Editing
      value={{
        draft,
        consumeDraft: () => setDraft(undefined),
        lastCalendar,
        remember,
        openQuick: (start, end, anchor) => {
          const visible =
            calendars.status === "ready"
              ? calendars.calendars.filter((c) => !prefs.hidden.includes(c.url))
              : [];
          const calendar = visible.find((c) => c.url === lastCalendar) ?? visible[0];
          if (!calendar) {
            toast.error("Create or show a calendar first");
            return;
          }
          setQuick({ data: { name: "", start, end, inCalendar: `${calendar.url}#it` }, anchor });
        },
      }}
    >
      {children}
      {quick && (
        <QuickCreate
          key={String(quick.data.start)}
          quick={quick}
          close={() => setQuick(undefined)}
          more={(data) => {
            setDraft(data);
            setQuick(undefined);
          }}
        />
      )}
    </Editing>
  );
}
export function CalendarSelect({
  value,
  onChange,
  label = "Calendar",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { calendars } = useCalendarState();
  const list = calendars.status === "ready" ? calendars.calendars : [];
  const selected = list.find((c) => `${c.url}#it` === value);
  return (
    <label className="cal-field">
      <span>{label}</span>
      <span className="cal-calendar-select">
        <span className="cal-swatch" style={{ backgroundColor: selected?.colour }} />
        <select
          aria-label={label}
          value={value}
          required
          onChange={(e) => onChange(e.target.value)}
        >
          {list.map((c) => (
            <option key={c.url} value={`${c.url}#it`}>
              {c.title}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
function QuickCreate({
  quick,
  close,
  more,
}: {
  quick: Quick;
  close: () => void;
  more: (data: CalendarEvent) => void;
}) {
  const [title, setTitle] = useState("");
  const [calendar, setCalendar] = useState(quick.data.inCalendar ?? "");
  const [parsed, setParsed] = useState<CalendarEvent>();
  const [error, setError] = useState("");
  const { calendars } = useCalendarState();
  const editing = useCalendarEditing();
  const mutations = useEventMutations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const anchor = useRef(quick.anchor);
  const parse = () => {
    const data = quickDraft(
      title,
      { ...quick.data, inCalendar: calendar },
      new Date(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    validateEvent(data);
    setParsed(data);
    return data;
  };
  const rect = quick.anchor.getBoundingClientRect();
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        className="cal-quick cal-form"
        aria-label="Create event"
        role="dialog"
        style={{ maxHeight: `calc(100dvh - ${Math.min(rect.top, 20) + 24}px)` }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          quick.anchor.focus();
        }}
      >
        <h2>Create event</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            try {
              const data = parse();
              const target =
                calendars.status === "ready" &&
                calendars.calendars.find((c) => `${c.url}#it` === calendar);
              if (!target) throw new Error("Choose a calendar");
              editing?.remember(target.url);
              void mutations
                .create(new URL(`${crypto.randomUUID()}.ttl`, target.container).href, {
                  ...data,
                  uid: crypto.randomUUID(),
                })
                .catch(() => {});
              close();
            } catch {
              setError("Check the title and date phrase before saving.");
            }
          }}
        >
          <label className="cal-field" htmlFor="cal-quick-title">
            Title
            <Input
              id="cal-quick-title"
              required
              aria-label="Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setParsed(undefined);
              }}
              onBlur={() => {
                if (title.trim())
                  try {
                    parse();
                    setError("");
                  } catch {
                    setError("Check the date phrase, or choose More options.");
                  }
              }}
            />
          </label>
          <p role="status">{eventDateRange(parsed ?? quick.data)}</p>
          <CalendarSelect value={calendar} onChange={setCalendar} />
          {error && <p role="alert">{error}</p>}
          <div className="cal-actions">
            <Button type="submit">Save</Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                try {
                  const data = title.trim() ? parse() : { ...quick.data, inCalendar: calendar };
                  more(data);
                  const query = new URLSearchParams({
                    start: typeof data.start === "string" ? data.start : data.start.toISOString(),
                    end: typeof data.end === "string" ? data.end : (data.end as Date).toISOString(),
                    cal: calendar,
                    return: `${pathname}?${params}`,
                  });
                  router.push(`/calendar/e/new?${query}`);
                } catch {
                  setError("Check the date phrase before continuing.");
                }
              }}
            >
              More options
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
const fieldValue = (date: CalendarDate | undefined): DateTimeValue | null =>
  date === undefined
    ? null
    : typeof date === "string"
      ? { kind: "date", date }
      : { kind: "dateTime", dateTime: date.toISOString() };
function modelDate(value: DateTimeValue | null, allDay: boolean): CalendarDate | undefined {
  if (!value) return undefined;
  const date = value.kind === "date" ? value.date : new Date(value.dateTime);
  return allDay ? dateKey(date) : typeof date === "string" ? localDate(date) : date;
}
function uiRule(data: CalendarEvent): UiRule | null {
  if (!data.recurrence) return null;
  try {
    return fromRRule(ruleToICal(data.recurrence));
  } catch {
    return null;
  }
}
function modelRule(value: UiRule | null, data: CalendarEvent) {
  if (!value) return undefined;
  // Use the model's ICS rule adapter, which rejects unsupported ordinal patterns explicitly.
  const result = importICal(
    `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:adapter\nSUMMARY:Rule\nDTSTART;VALUE=DATE:20261101\n${toRRule(value)}\nEND:VEVENT\nEND:VCALENDAR`,
  );
  if (!result.events[0]?.recurrence)
    throw new Error("Choose a day-of-month pattern; ordinal weekdays are not supported yet.");
  return { ...result.events[0].recurrence, exceptDate: data.recurrence?.exceptDate };
}
export function CalendarEditorRoute({ eventRef }: { eventRef: string }) {
  const { session, calendars, writes, prefs } = useCalendarState();
  const editing = useCalendarEditing();
  const params = useSearchParams();
  const [loaded, setLoaded] = useState<StoredItem<CalendarEvent>>();
  const [error, setError] = useState("");
  const occurrence = params.get("occurrence");
  const start = params.get("start");
  const end = params.get("end");
  const cal = params.get("cal");
  const date =
    params.get("d") ??
    params.get("return")?.match(/[?&]d=(\d{4}-\d{2}-\d{2})/)?.[1] ??
    dateKey(new Date());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a loaded editor owns a stable snapshot until save or reload
  useEffect(() => {
    if (calendars.status !== "ready") return;
    let live = true;
    setError("");
    setLoaded(undefined);
    try {
      if (eventRef === "new") {
        const first = calendars.calendars.find((c) => !prefs.hidden.includes(c.url));
        const convert = (s: string): CalendarDate => (s.length === 10 ? s : new Date(s));
        const data = editing?.draft ?? {
          name: "",
          start: start ? convert(start) : localDate(date),
          end: end ? convert(end) : new Date(+localDate(date) + 3600000),
          inCalendar: cal ?? (first ? `${first.url}#it` : ""),
        };
        asDate(data.start);
        if (data.end !== undefined) asDate(data.end);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey(data.start)))
          throw new Error("Invalid event dates");
        setLoaded({ url: "", etag: null, data });
        editing?.consumeDraft();
      } else {
        const url = decodeEventRef(eventRef, session.storageUrl, calendars.calendars);
        const prepare = (item: StoredItem<CalendarEvent>) => {
          const source = calendars.calendars.find((c) =>
            podScopedUrl(c.container, item.url, { allowRoot: false }),
          );
          return {
            ...item,
            data: {
              ...item.data,
              inCalendar: item.data.inCalendar ?? (source ? `${source.url}#it` : undefined),
            },
          };
        };
        const local = [...writes].reverse().find((w) => w.url === url);
        if (local && local.kind !== "delete")
          setLoaded(
            prepare({
              url,
              etag: local.confirmation?.etag ?? (local.kind === "update" ? local.etag : null),
              data: local.data,
            }),
          );
        else
          void calendarIO(session.fetch, session.storageUrl)
            .loadEvent(url)
            .then(
              (item) => {
                if (!live) return;
                if (item) setLoaded(prepare(item));
                else setError("This event is no longer here.");
              },
              () => live && setError("Couldn't load this event. Return to the calendar and retry."),
            );
      }
    } catch {
      setError("This event reference or its dates are invalid.");
    }
    return () => {
      live = false;
    };
  }, [eventRef, session, calendars.status, start, end, cal, date]);
  return (
    <>
      <div className="cal-editor-background">
        <CalendarScreen view={prefs.view} />
      </div>
      {error ? (
        <div role="alert">{error}</div>
      ) : loaded ? (
        <EventEditor key={`${eventRef}:${loaded.etag}`} item={loaded} occurrence={occurrence} />
      ) : (
        <LoadingSkeleton label="Loading event" />
      )}
    </>
  );
}
function EventEditor({
  item,
  occurrence,
}: {
  item: StoredItem<CalendarEvent>;
  occurrence: string | null;
}) {
  const { calendars, closeEvent, session } = useCalendarState();
  const confirmed = useRef(item);
  const replacement = useRef<{ url: string; etag: string | null } | undefined>(undefined);
  const editing = useCalendarEditing();
  const router = useRouter();
  const params = useSearchParams();
  const large = useLarge();
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInput.current?.focus();
  }, []);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [snapshot] = useState(() => {
    if (!occurrence || !item.data.recurrence) return { data: item.data, error: "" };
    try {
      const at = typeof item.data.start === "string" ? occurrence : new Date(occurrence);
      const resolved = expandEvent(item.data, new Date(at), new Date(+new Date(at) + 1), zone).find(
        (e) => +new Date(e.start) === +new Date(at),
      );
      if (!resolved) throw new Error("Unknown occurrence");
      return { data: resolved, error: "" };
    } catch {
      return {
        data: item.data,
        error: "This occurrence is no longer part of the series. Open it again from the calendar.",
      };
    }
  });
  const initial = snapshot.data;
  const [data, setData] = useState(initial);
  const [allDay, setAllDay] = useState(typeof initial.start === "string");
  const [start, setStart] = useState(fieldValue(initial.start));
  const [end, setEnd] = useState(fieldValue(initial.end));
  const [rule, setRule] = useState(uiRule(initial));
  const [ruleError, setRuleError] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [scope, setScope] = useState<"save" | "delete">();
  const [busy, setBusy] = useState(false);
  const mutations = useEventMutations();
  const originalSignature = useRef(
    JSON.stringify({
      data: initial,
      start: fieldValue(initial.start),
      end: fieldValue(initial.end),
      rule: uiRule(initial),
    }),
  );
  const dirty = JSON.stringify({ data, start, end, rule }) !== originalSignature.current;
  const close = () => {
    closeEvent();
    const back = params.get("return");
    router.push(
      back && /^\/calendar\/(month|week|day|agenda)\?d=\d{4}-\d{2}-\d{2}$/.test(back)
        ? back
        : calendarHref("week", dateKey(initial.start)),
    );
  };
  const cancel = () => {
    if (!busy) dirty ? setDiscard(true) : close();
  };
  const calendar =
    calendars.status === "ready"
      ? calendars.calendars.find((c) => `${c.url}#it` === data.inCalendar)
      : undefined;
  function assembled(): CalendarEvent {
    if (snapshot.error) throw new Error(snapshot.error);
    const begin = modelDate(start, allDay);
    const finish = modelDate(end, allDay);
    if (!begin || !finish) throw new Error("Enter a start and end date.");
    if (+new Date(finish) <= +new Date(begin)) throw new Error("End must be after start.");
    if (ruleError) throw new Error(ruleError);
    const result = {
      ...data,
      name: data.name.trim(),
      start: begin,
      end: finish,
      recurrence: editorRecurrence(data.recurrence, begin, zone),
    };
    validateEvent(result);
    if (!calendar) throw new Error("Choose a calendar.");
    return result;
  }
  async function removeReplacement() {
    const pending = replacement.current;
    if (!pending) return;
    await mutations.delete(pending.url, pending.etag ?? "", true);
    replacement.current = undefined;
  }
  async function persist(action: "save" | "delete", mode: SeriesMode) {
    if (busy) return;
    try {
      const edited = action === "save" ? assembled() : null;
      const source = confirmed.current;
      const plan = planSeriesEdit(source.data, initial.start, edited, mode, zone);
      setBusy(true);
      setScope(undefined);
      setError("");
      // Finish a failed compensation before retrying, so a retry cannot duplicate replacements.
      await removeReplacement();
      const target = calendar as CalendarInfo;
      const create = async (event: CalendarEvent, compound: boolean) => {
        const url = new URL(`${crypto.randomUUID()}.ttl`, target.container).href;
        await mutations.create(url, { ...event, uid: crypto.randomUUID() }, compound);
        if (compound) {
          replacement.current = { url, etag: null };
          replacement.current.etag = await mutations.resolve(url, null);
        }
      };
      const moving =
        source.url &&
        plan.original &&
        plan.original.inCalendar !== source.data.inCalendar &&
        mode === "all";
      const compound = Boolean(plan.created || moving);
      // Compound operations require confirmed prerequisites; ordinary edits can stay queued offline.
      const etag = source.url ? await mutations.resolve(source.url, source.etag, compound) : "";
      if (moving && plan.original) await create(plan.original, true);
      else if (plan.created) await create(plan.created, true);
      if (source.url) {
        if (plan.original && !moving)
          await mutations.update(source.url, plan.original, etag, compound);
        else await mutations.delete(source.url, etag, compound);
      } else if (plan.original) await create(plan.original, false);
      replacement.current = undefined;
      if (target) editing?.remember(target.url);
      close();
    } catch (failure) {
      let message =
        failure instanceof Error ? failure.message : "Couldn't save this event. Please retry.";
      try {
        await removeReplacement();
      } catch {
        message = "Couldn't finish saving. Save again to retry cleanup; your draft is still here.";
      }
      if (failure instanceof Error && "status" in failure && failure.status === 412) {
        const latest = await calendarIO(session.fetch, session.storageUrl)
          .loadEvent(item.url)
          .catch(() => null);
        if (latest) confirmed.current = latest;
        message = "This event changed elsewhere. Review your draft and save again.";
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  function request(action: "save" | "delete") {
    if (snapshot.error) {
      setError(snapshot.error);
      return;
    }
    try {
      if (action === "save") assembled();
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    if (item.data.recurrence) setScope(action);
    else void persist(action, "all");
  }
  const form = (
    <div className="cal-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          request("save");
        }}
      >
        <label className="cal-field" htmlFor="cal-event-title">
          Title
          <Input
            ref={titleInput}
            id="cal-event-title"
            required
            aria-label="Title"
            value={data.name}
            onChange={(e) => setData({ ...data, name: e.target.value })}
          />
        </label>
        <label className="cal-switch" htmlFor="cal-event-all-day">
          All day
          <Switch
            id="cal-event-all-day"
            aria-label="All day"
            checked={allDay}
            onCheckedChange={(value) => {
              setAllDay(value);
              setStart(fieldValue(modelDate(start, value)));
              setEnd(fieldValue(modelDate(end, value)));
            }}
          />
        </label>
        <DateTimeField
          label="Start"
          locale="en-GB"
          value={start}
          onChange={(value) => setStart(fieldValue(modelDate(value, allDay)))}
        />
        <DateTimeField
          label={allDay ? "End (exclusive)" : "End"}
          locale="en-GB"
          value={end}
          onChange={(value) => setEnd(fieldValue(modelDate(value, allDay)))}
        />
        <CalendarSelect
          value={data.inCalendar ?? ""}
          onChange={(inCalendar) => setData({ ...data, inCalendar })}
        />
        <RecurrenceEditor
          locale="en-GB"
          value={rule}
          startDate={dateKey(modelDate(start, allDay) ?? initial.start)}
          onChange={(value) => {
            setRule(value);
            try {
              setData({ ...data, recurrence: modelRule(value, data) });
              setRuleError("");
            } catch (failure) {
              setRuleError((failure as Error).message);
            }
          }}
        />
        <p className="sr-only">{recurrenceSummary(rule, "en-GB")}</p>
        {ruleError && <p role="alert">{ruleError}</p>}
        <fieldset>
          <legend>Reminders</legend>
          {(data.reminders ?? []).map((reminder, index) => (
            <div className="cal-reminder" key={String(index)}>
              <label>
                Before event
                <select
                  aria-label={`Reminder ${index + 1}`}
                  value={reminder.triggerOffset ?? "absolute"}
                  onChange={(e) =>
                    setData({
                      ...data,
                      reminders: data.reminders?.map((r, i) =>
                        i === index
                          ? {
                              triggerOffset:
                                e.target.value === "custom" ? "-PT15M" : e.target.value,
                            }
                          : r,
                      ),
                    })
                  }
                >
                  {[
                    ["PT0M", "At start"],
                    ["-PT5M", "5 minutes"],
                    ["-PT10M", "10 minutes"],
                    ["-PT30M", "30 minutes"],
                    ["-PT1H", "1 hour"],
                    ["-P1D", "1 day"],
                  ].map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                  {reminder.triggerTime && (
                    <option value="absolute">{reminder.triggerTime.toLocaleString()}</option>
                  )}
                  {reminder.triggerOffset &&
                    !["PT0M", "-PT5M", "-PT10M", "-PT30M", "-PT1H", "-P1D"].includes(
                      reminder.triggerOffset,
                    ) && <option value={reminder.triggerOffset}>Custom</option>}
                  <option value="custom">Custom duration…</option>
                </select>
              </label>
              {reminder.triggerOffset &&
                !["PT0M", "-PT5M", "-PT10M", "-PT30M", "-PT1H", "-P1D"].includes(
                  reminder.triggerOffset,
                ) && (
                  <label htmlFor={`cal-custom-${index}`}>
                    Custom duration
                    <Input
                      id={`cal-custom-${index}`}
                      aria-label={`Custom duration ${index + 1}`}
                      placeholder="-PT15M"
                      value={reminder.triggerOffset}
                      onChange={(e) =>
                        setData({
                          ...data,
                          reminders: data.reminders?.map((r, i) =>
                            i === index ? { triggerOffset: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                )}
              <Button
                variant="ghost"
                type="button"
                aria-label={`Remove reminder ${index + 1}`}
                onClick={() =>
                  setData({ ...data, reminders: data.reminders?.filter((_, i) => i !== index) })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setData({
                ...data,
                reminders: [...(data.reminders ?? []), { triggerOffset: "-PT10M" }],
              })
            }
          >
            Add reminder
          </Button>
        </fieldset>
        <label className="cal-field" htmlFor="cal-event-location">
          Location
          <Input
            id="cal-event-location"
            value={data.location ?? ""}
            onChange={(e) => setData({ ...data, location: e.target.value })}
          />
        </label>
        <label className="cal-field" htmlFor="cal-event-description">
          Description
          <Textarea
            id="cal-event-description"
            value={data.description ?? ""}
            onChange={(e) => setData({ ...data, description: e.target.value })}
          />
        </label>
        {(error || snapshot.error) && <p role="alert">{error || snapshot.error}</p>}
        <div className="cal-actions">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          {item.url && (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => request("delete")}
            >
              Delete
            </Button>
          )}
        </div>
      </form>
    </div>
  );
  return (
    <>
      {large ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) cancel();
          }}
        >
          <SheetContent className="cal-editor" showCloseButton={false}>
            <SheetTitle>{item.url ? "Edit event" : "New event"}</SheetTitle>
            <SheetDescription>Event details, repeat pattern and reminders.</SheetDescription>
            {form}
          </SheetContent>
        </Sheet>
      ) : (
        <section className="cal-editor-page" aria-label={item.url ? "Edit event" : "New event"}>
          <h2>{item.url ? "Edit event" : "New event"}</h2>
          {form}
        </section>
      )}
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>Your unsaved edits will be discarded.</AlertDialogDescription>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={close}>Discard</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(scope)}
        onOpenChange={(open) => {
          if (!open) setScope(undefined);
        }}
      >
        <AlertDialogContent className="cal-series-dialog">
          <AlertDialogTitle>
            {scope === "delete" ? "Delete recurring event" : "Edit recurring event"}
          </AlertDialogTitle>
          <AlertDialogDescription>Which events should change?</AlertDialogDescription>
          {(
            [
              ["this", "This event"],
              ["following", "This and following events"],
              ["all", "All events"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              onClick={() => {
                if (scope) void persist(scope, mode);
              }}
            >
              {label}
            </Button>
          ))}
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
