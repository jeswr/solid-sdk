// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { ErrorState, LoadingSkeleton, toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PodSession, usePodSessionState } from "@/lib/session/pod-session";
import { type CalendarEvent, expandEvent, validateEvent } from "../lib/model";
import { eventDocument } from "./editing";
import { createEventOutbox } from "./outbox";
import {
  compareOccurrences,
  createCalendar,
  discoverCalendars,
  type EventWrite,
  eventContainer,
  eventMutations,
  loadRange,
} from "./repository";
import {
  type CalendarInfo,
  type CalendarView,
  defaultWeekStart,
  localDate,
  type Occurrence,
  type Preferences,
  preferencesKey,
  rangeKey,
  readPreferences,
  reconcileOccurrence,
} from "./view";

type CalendarsState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | ({ status: "ready" } & Awaited<ReturnType<typeof discoverCalendars>>);
type RangeResult = Awaited<ReturnType<typeof loadRange>> & { acknowledged: EventWrite[] };
type EventsState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | ({ status: "ready" } & RangeResult);
interface CalendarContextValue {
  session: PodSession;
  calendars: CalendarsState;
  prefs: Preferences;
  setPrefs: (update: (value: Preferences) => Preferences) => void;
  reload: () => void;
  revision: number;
  cache: Map<string, Promise<RangeResult>>;
  writes: EventWrite[];
  syncStatus: string;
  mutate: (write: EventWrite, requireConfirmation?: boolean) => Promise<void>;
  /** Show a write's result without sending it; the returned function removes the preview. */
  preview: (write: EventWrite) => () => void;
  resolveEventEtag: (
    url: string,
    etag: string | null,
    requireConfirmation?: boolean,
  ) => Promise<string>;
  create: (title: string, colour: string) => Promise<void>;
  selected: Occurrence | undefined;
  focusRequest: { current: { view: CalendarView; date: string; slot: number } | undefined };
  openEvent: (event: Occurrence, trigger: HTMLElement, day?: HTMLElement) => void;
  closeEvent: () => void;
  eventTrigger: RefObject<HTMLElement | null>;
  reconcile: (events: Occurrence[], from: string, to: string, failedCalendars: string[]) => void;
}
const Context = createContext<CalendarContextValue | undefined>(undefined);
function SessionCalendarProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const [calendars, setCalendars] = useState<CalendarsState>({ status: "loading" });
  const [prefs, updatePrefs] = useState<Preferences>({ hidden: [], view: "week", weekStart: 1 });
  const [revision, setRevision] = useState(0);
  const cache = useMemo(() => new Map<string, Promise<RangeResult>>(), []);
  const [writes, setWrites] = useState<EventWrite[]>([]);
  const [queuedWrites, setQueuedWrites] = useState<EventWrite[]>([]);
  const [previews, setPreviews] = useState<EventWrite[]>([]);
  const preview = useCallback((write: EventWrite) => {
    setPreviews((current) => [...current, write]);
    return () => setPreviews((current) => current.filter((item) => item !== write));
  }, []);
  const [syncStatus, setSyncStatus] = useState("");
  const calendarRef = useRef(calendars);
  calendarRef.current = calendars;
  const [selected, setSelected] = useState<Occurrence>();
  const trigger = useRef<HTMLElement>(null);
  const returnDay = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<{ view: CalendarView; date: string; slot: number } | undefined>(
    undefined,
  );
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reload = useCallback(() => {
    cache.clear();
    setRevision((n) => n + 1);
  }, [cache]);
  useEffect(() => {
    const locale = new Intl.Locale(navigator.language);
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(preferencesKey(session.webId));
    } catch {
      /* Private browsing can disable preferences. */
    }
    updatePrefs(readPreferences(raw, defaultWeekStart(locale)));
  }, [session.webId]);
  const setPrefs = useCallback(
    (update: (value: Preferences) => Preferences) => {
      updatePrefs((current) => {
        const next = update(current);
        try {
          localStorage.setItem(preferencesKey(session.webId), JSON.stringify(next));
        } catch {
          /* In-memory preferences remain usable. */
        }
        return next;
      });
    },
    [session.webId],
  );
  useEffect(() => {
    return session.subscribe(() => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(reload, 30);
    });
  }, [session, reload]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests rediscovery
  useEffect(() => {
    let live = true;
    discoverCalendars(session).then(
      (result) => live && setCalendars({ status: "ready", ...result }),
      (error: unknown) =>
        live &&
        setCalendars((current) =>
          current.status === "ready" && unreachable(error) ? current : { status: "error", error },
        ),
    );
    return () => {
      live = false;
    };
  }, [session, revision]);
  const mutate = useMemo(
    () =>
      eventMutations(
        {
          ...session,
          fetch: async (input, init) => {
            try {
              if (!navigator.onLine) throw new TypeError("Offline");
              return await session.fetch(input, init);
            } catch (error) {
              if (error instanceof TypeError) throw new TypeError("Calendar network unavailable");
              throw error;
            }
          },
        },
        setWrites,
        reload,
        (error, conflict) => {
          if (error instanceof TypeError && error.message === "Calendar network unavailable")
            return;
          toast.error(
            conflict
              ? "This event changed elsewhere. The latest version has been loaded."
              : "Couldn't save the event. Your change was reverted.",
          );
        },
      ),
    [session, reload],
  );
  const outbox = useMemo(
    () =>
      createEventOutbox(
        session.webId,
        {
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
        },
        mutate,
        (entries, offline) => {
          setQueuedWrites(entries);
          setSyncStatus(
            entries.length ? (offline ? "Saved on this device, will sync" : "Saving…") : "Saved",
          );
        },
        (write) => {
          const current = calendarRef.current;
          if (current.status !== "ready") throw new Error("Calendars are still loading");
          eventDocument(write.url, session.storageUrl, current.calendars);
          if (write.kind !== "delete") validateEvent(write.data);
        },
      ),
    [session, mutate],
  );
  const ready = calendars.status === "ready";
  useEffect(() => {
    if (!ready) return;
    outbox.restore();
    const retry = () => {
      void outbox.flush();
    };
    retry();
    addEventListener("online", retry);
    return () => removeEventListener("online", retry);
  }, [outbox, ready]);
  const create = useCallback(
    async (title: string, colour: string) => {
      try {
        await createCalendar(session, title, colour);
        reload();
      } catch (error) {
        toast.error("Couldn't create the calendar. Please retry.");
        throw error;
      }
    },
    [session, reload],
  );
  const openEvent = useCallback((event: Occurrence, element: HTMLElement, day?: HTMLElement) => {
    trigger.current = element;
    returnDay.current = day ?? element.closest<HTMLElement>("[data-day]");
    setSelected(event);
  }, []);
  useEffect(() => {
    if (selected && prefs.hidden.includes(selected.calendar.url)) setSelected(undefined);
  }, [selected, prefs.hidden]);
  const closeEvent = useCallback(() => {
    setSelected(undefined);
    requestAnimationFrame(() => {
      const day = returnDay.current;
      const fallback = day?.isConnected
        ? (day.querySelector<HTMLElement>(".cal-more") ?? day)
        : document.getElementById("main-content");
      const target = trigger.current?.isConnected ? trigger.current : fallback;
      trigger.current = target;
      target?.focus();
    });
  }, []);
  const reconcile = useCallback(
    (events: Occurrence[], from: string, to: string, failedCalendars: string[]) => {
      const next = reconcileOccurrence(selected, events, from, to, failedCalendars);
      if (selected && !next) closeEvent();
      else setSelected(next);
    },
    [selected, closeEvent],
  );
  // Previews go first so real writes for the same event take precedence once they exist.
  const visibleWrites = useMemo(
    () => [...previews, ...writes, ...queuedWrites],
    [previews, writes, queuedWrites],
  );
  return (
    <Context
      value={{
        session,
        calendars,
        prefs,
        setPrefs,
        reload,
        revision,
        cache,
        writes: visibleWrites,
        syncStatus,
        mutate: outbox.save,
        preview,
        resolveEventEtag: outbox.resolve,
        create,
        selected,
        focusRequest,
        openEvent,
        closeEvent,
        eventTrigger: trigger,
        reconcile,
      }}
    >
      {children}
    </Context>
  );
}
/**
 * A refresh that fails because the pod is unreachable (offline) keeps what is already on
 * screen; queued writes still show through the overlay and sync once the network returns.
 */
function unreachable(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  // fetch() rejects with a TypeError on network failure; RDF loaders wrap it as the cause.
  for (let cause = error, depth = 0; cause && depth < 4; depth++) {
    if (cause instanceof TypeError) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}
/** On a refresh, a calendar the pod couldn't serve keeps its loaded events instead of emptying. */
function keepUnreachable(previous: RangeResult, next: RangeResult): RangeResult {
  const failed = new Set(
    next.warnings
      .filter(
        (warning) =>
          unreachable(warning.error) &&
          !previous.warnings.some((old) => old.calendarUrl === warning.calendarUrl),
      )
      .map((warning) => warning.calendarUrl),
  );
  if (!failed.size) return next;
  return {
    ...next,
    events: [
      ...next.events,
      ...previous.events.filter((event) => failed.has(event.calendar.url)),
    ].sort(compareOccurrences),
    warnings: next.warnings.filter((warning) => !failed.has(warning.calendarUrl)),
  };
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "signed-out") return <p role="status">Sign in to open your Calendar</p>;
  if (state.status === "loading") return <LoadingSkeleton preset="grid" label="Opening Calendar" />;
  if (state.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />;
  return (
    <SessionCalendarProvider key={state.session.webId} session={state.session}>
      {children}
    </SessionCalendarProvider>
  );
}
export function useCalendarState(): CalendarContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("Calendar hooks require CalendarProvider");
  return value;
}
export function useCalendars() {
  const { calendars, reload } = useCalendarState();
  return { ...calendars, reload };
}
export function useEventsInRange(
  from: string,
  to: string,
  reconcileSelection = true,
): EventsState & { reload: () => void } {
  const { session, calendars, prefs, cache, revision, writes, reload, reconcile } =
    useCalendarState();
  const latestWrites = useRef(writes);
  latestWrites.current = writes;
  const visible =
    calendars.status === "ready"
      ? calendars.calendars.filter((c) => !prefs.hidden.includes(c.url))
      : [];
  const key = rangeKey(
    session.webId,
    visible.map((c) => JSON.stringify([c.url, c.etag, c.title, c.colour])),
    from,
    to,
  );
  const [snapshot, setSnapshot] = useState<{ key: string; state: EventsState }>({
    key: "",
    state: { status: "loading" },
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key encodes the visible calendars, revision invalidates all ranges
  useEffect(() => {
    if (calendars.status !== "ready") return;
    let live = true;
    let request = cache.get(key);
    if (!request) {
      const acknowledged = latestWrites.current.filter((write) => write.confirmation);
      request = loadRange(session, visible, localDate(from), localDate(to), zone).then(
        (result) => ({
          ...result,
          acknowledged: acknowledged.filter(
            (write) =>
              !result.warnings.some((warning) =>
                write.url.startsWith(eventContainer(warning.calendarUrl)),
              ),
          ),
        }),
      );
      cache.set(key, request);
    }
    request.then(
      (result) =>
        live &&
        setSnapshot((current) => ({
          key,
          state: {
            status: "ready",
            ...(current.key === key && current.state.status === "ready"
              ? keepUnreachable(current.state, result)
              : result),
          },
        })),
      (error: unknown) => {
        cache.delete(key);
        if (live) setSnapshot({ key, state: { status: "error", error } });
      },
    );
    return () => {
      live = false;
    };
  }, [session, key, revision, calendars.status, cache, from, to, zone]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key includes visible calendar metadata
  const state: EventsState = useMemo(() => {
    if (calendars.status === "error") return calendars;
    if (calendars.status !== "ready" || snapshot.key !== key) return { status: "loading" };
    const state = snapshot.state;
    if (state.status !== "ready") return state;
    let events = state.events;
    for (const write of writes) {
      if (state.acknowledged.includes(write)) continue;
      const knownCalendar = events.find((e) => e.url === write.url)?.calendar;
      events = events.filter((e) => e.url !== write.url);
      if (write.kind === "delete") continue;
      const calendar = write.data.inCalendar
        ? visible.find((c) => `${c.url}#it` === write.data.inCalendar)
        : (visible.find((c) => c.url === knownCalendar?.url) ??
          visible.find((c) => podScopedUrl(c.container, write.url, { allowRoot: false })));
      if (calendar)
        for (const data of expandEvent(write.data, localDate(from), localDate(to), zone))
          events.push({
            url: write.url,
            etag: write.confirmation
              ? write.confirmation.etag
              : write.kind === "update"
                ? write.etag
                : null,
            id: JSON.stringify([write.url, data.start]),
            data,
            calendar,
          });
    }
    events = [...events].sort((a, b) => +new Date(a.data.start) - +new Date(b.data.start));
    return { ...state, events, warnings: [...calendars.warnings, ...state.warnings] };
  }, [snapshot, key, writes, calendars, from, to, zone]);
  useEffect(() => {
    if (reconcileSelection && state.status === "ready")
      reconcile(
        state.events,
        from,
        to,
        state.warnings.map((warning) => warning.calendarUrl),
      );
  }, [state, from, to, reconcile, reconcileSelection]);
  return { ...state, reload };
}
export function useEventMutations() {
  const { mutate, preview, resolveEventEtag } = useCalendarState();
  return useMemo(
    () => ({
      resolve: resolveEventEtag,
      preview,
      create: (url: string, data: CalendarEvent, requireConfirmation?: boolean) =>
        mutate({ kind: "create", url, data }, requireConfirmation),
      update: (url: string, data: CalendarEvent, etag: string, requireConfirmation?: boolean) =>
        mutate({ kind: "update", url, data, etag }, requireConfirmation),
      delete: (url: string, etag: string, requireConfirmation?: boolean) =>
        mutate({ kind: "delete", url, etag }, requireConfirmation),
    }),
    [mutate, preview, resolveEventEtag],
  );
}
export type { CalendarInfo, CalendarView };
