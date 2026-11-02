// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as PodSession | undefined,
  status: "ready" as "ready" | "loading" | "error",
  path: "/calendar/week",
  date: "2026-11-01",
  query: "",
  extra: {} as Record<string, string>,
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () =>
    mocks.status === "ready"
      ? { status: "ready", session: mocks.session }
      : mocks.status === "loading"
        ? { status: "loading" }
        : { status: "error", error: new Error("storage") },
  PodSessionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams({ d: mocks.date, q: mocks.query, ...mocks.extra }),
  useRouter: () => mocks.router,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as string),
}));

import { CalendarApp } from "../src/apps/calendar/components/calendar-app";
import { CalendarScreen, CalendarSearch } from "../src/apps/calendar/components/calendar-views";
import { CalendarEditorRoute } from "../src/apps/calendar/components/event-editor";
import { calendarIO } from "../src/apps/calendar/lib/model";
import {
  CalendarProvider,
  useCalendarState,
  useEventMutations,
  useEventsInRange,
} from "../src/apps/calendar/state/calendar-context";
import {
  type CalendarView,
  type Occurrence,
  PALETTE,
  rangeKey,
} from "../src/apps/calendar/state/view";
import { encodeRef } from "../src/lib/refs";

const NOW = Date.UTC(2026, 10, 1, 12);
let unsubscribe: (() => void) | undefined;
let notify: ((url: string) => void) | undefined;
beforeEach(async () => {
  mocks.path = "/calendar/week";
  mocks.date = "2026-11-01";
  mocks.query = "";
  mocks.extra = {};
  mocks.status = "ready";
  mocks.router.replace.mockReset();
  mocks.router.push.mockReset();
  localStorage.clear();
  Object.defineProperty(window.navigator, "language", { value: "en-GB", configurable: true });
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
  const listeners = new Set<(url: string) => void>();
  unsubscribe = pod.subscribe((url) => {
    for (const listener of listeners) listener(url);
  });
  notify = (url) => {
    for (const listener of listeners) listener(url);
  };
  mocks.session = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: vi.fn(),
  };
  vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);
  vi.stubGlobal("HTMLAnchorElement", window.HTMLAnchorElement);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
});
afterEach(() => {
  unsubscribe?.();
});
function screen(view: CalendarView = "week") {
  return h(CalendarApp, { children: h(CalendarScreen, { view }) });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}
function buttons(host: HTMLElement, title: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button.cal-event")].filter((button) =>
    button.getAttribute("aria-label")?.startsWith(title),
  );
}

it("renders week recurrence, filters Work everywhere and persists visibility per WebID", async () => {
  const mounted = await mount(screen());
  await settle();
  expect(buttons(mounted.host, "Team stand-up,")).toHaveLength(3);
  const checkbox = mounted.host.querySelector<HTMLElement>(
    '[aria-label="Show Work calendar"]',
  ) as HTMLElement;
  await click(checkbox);
  await settle();
  expect(buttons(mounted.host, "Team stand-up,")).toHaveLength(0);
  expect(localStorage.getItem(`suite:calendar:${DEMO_WEBID}`)).toContain("work.ttl");
  mocks.path = "/calendar/month";
  await mounted.render(screen("month"));
  await settle();
  expect(buttons(mounted.host, "Team stand-up,")).toHaveLength(0);
  expect(mounted.host.querySelectorAll('.cal-month [role="gridcell"]')).toHaveLength(42);
});
it("moves month focus, handles date navigation and opens quick-create", async () => {
  mocks.path = "/calendar/month";
  const mounted = await mount(screen("month"));
  await settle();
  const day = mounted.host.querySelector<HTMLElement>(
    '.cal-month [data-day="2026-11-01"]',
  ) as HTMLElement;
  await act(() => day.focus());
  await key(day, "ArrowRight");
  expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-02");
  const monday = document.activeElement as HTMLElement;
  await key(monday, "End");
  expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-08");
  await key(document.activeElement as HTMLElement, "Home");
  expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-02");
  await key(document.activeElement as HTMLElement, "PageDown");
  expect(mocks.router.replace).toHaveBeenLastCalledWith("/calendar/month?d=2026-12-02");
  mocks.date = "2026-12-02";
  await mounted.render(screen("month"));
  await settle();
  expect(document.activeElement?.getAttribute("data-day")).toBe("2026-12-02");
  await key(document.activeElement as HTMLElement, "Enter");
  expect(document.querySelector(".cal-quick")).not.toBeNull();
  await key(document.activeElement as HTMLElement, "Escape");
  await settle();
  expect(document.activeElement?.getAttribute("data-day")).toBe("2026-12-02");
});
it("moves between week slots, tabs to an event, shows read-only details and restores focus", async () => {
  const mounted = await mount(screen());
  await settle();
  const slot = mounted.host.querySelector<HTMLElement>(
    '[data-slot="2026-10-26:14"]',
  ) as HTMLElement;
  await act(() => slot.focus());
  await key(slot, "ArrowRight");
  expect(document.activeElement?.getAttribute("data-slot")).toBe("2026-10-27:14");
  await key(document.activeElement as HTMLElement, "ArrowLeft");
  await key(document.activeElement as HTMLElement, "Tab");
  const event = document.activeElement as HTMLButtonElement;
  expect(event.getAttribute("aria-label")).toMatch(/^Team stand-up,/);
  await click(event);
  expect(mounted.host.querySelector(".cal-details")?.textContent).toContain(
    "Weekly on Mon, Wed, Fri",
  );
  expect(mounted.host.querySelector(".cal-details")?.textContent).toContain("15 minutes before");
  await click(mounted.host.querySelector('[aria-label="Close event details"]') as HTMLElement);
  await settle();
  expect(mounted.host.querySelector(".cal-details")).toBeNull();
  expect(document.activeElement).toBe(event);
});
it("restores the focused half-hour slot after loading the previous week", async () => {
  const mounted = await mount(screen());
  await settle();
  const slot = mounted.host.querySelector<HTMLElement>(
    '[data-slot="2026-10-26:13"]',
  ) as HTMLElement;
  await act(() => slot.focus());
  await key(slot, "ArrowLeft");
  expect(mocks.router.replace).toHaveBeenLastCalledWith("/calendar/week?d=2026-10-25");
  mocks.date = "2026-10-25";
  await mounted.render(screen());
  await settle();
  expect(document.activeElement?.getAttribute("data-slot")).toBe("2026-10-25:13");
});
it("shows month overflow and searches loaded event fields", async () => {
  mocks.path = "/calendar/month";
  const mounted = await mount(screen("month"));
  await settle();
  const more = mounted.host.querySelector('[data-day="2026-11-01"] .cal-more') as HTMLElement;
  expect(more.textContent).toMatch(/\+\d+ more/);
  await click(more);
  expect(document.querySelector(".cal-overflow")?.textContent).toContain("Read in the park");
  await mounted.unmount();
  mocks.path = "/calendar/search";
  mocks.query = "share";
  const search = await mount(h(CalendarApp, { children: h(CalendarSearch) }));
  await settle();
  expect(search.host.textContent).toContain("Searching events from");
  expect(buttons(search.host, "Dinner with friends,")).toHaveLength(1);
});

it("renders an untrusted calendar colour with a safe swatch in navigation, events and Details", async () => {
  const session = mocks.session as PodSession;
  const io = calendarIO(session.fetch, session.storageUrl);
  const url = `${DEMO_ROOT}calendar/work.ttl`;
  const work = await io.loadCalendar(url);
  await io.saveCalendar(
    url,
    { title: "Work", color: "url(https://attacker.example/pixel)" },
    { etag: work?.etag as string },
  );
  const mounted = await mount(screen());
  await settle();
  await click(buttons(mounted.host, "Team stand-up,")[0] as HTMLElement);
  const swatches = mounted.host.querySelectorAll<HTMLElement>(".cal-swatch");
  expect(swatches.length).toBeGreaterThan(1);
  for (const swatch of swatches) {
    expect(swatch.style.backgroundColor).not.toBe("");
    expect(swatch.style.backgroundImage).toBe("");
  }
  expect(mounted.host.innerHTML).not.toContain("attacker.example");
});

it("keeps month overflow mounted while Details has focus and returns to its event", async () => {
  mocks.path = "/calendar/month";
  const mounted = await mount(screen("month"));
  await settle();
  const more = mounted.host.querySelector<HTMLElement>(
    '[data-day="2026-11-01"] .cal-more',
  ) as HTMLElement;
  await click(more);
  const event = document.querySelector<HTMLElement>(
    '.cal-overflow button[aria-label^="Read in the park,"]',
  ) as HTMLElement;
  await act(() => event.focus());
  await click(event);
  await settle();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close event details");
  expect(event.isConnected).toBe(true);
  await click(document.activeElement as HTMLElement);
  await settle();
  expect(document.activeElement).toBe(event);
});

it.each([
  "overflow",
  "day",
  "main",
  "removed",
])("restores a connected %s fallback when the event trigger is unmounted", async (fallback) => {
  let context!: ReturnType<typeof useCalendarState>;
  let events!: ReturnType<typeof useEventsInRange>;
  function Probe() {
    context = useCalendarState();
    events = useEventsInRange("2026-11-01", "2026-11-02");
    return null;
  }
  const mounted = await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const main = document.createElement("main");
  main.id = "main-content";
  main.tabIndex = -1;
  const day = document.createElement("div");
  day.dataset.day = "2026-11-01";
  day.tabIndex = -1;
  const more = document.createElement("button");
  more.className = "cal-more";
  const trigger = document.createElement("button");
  day.append(more, trigger);
  main.append(day);
  mounted.host.append(main);
  await act(() => {
    if (events.status !== "ready") throw new Error("Events not ready");
    context.openEvent(events.events[0] as Occurrence, trigger, day);
  });
  trigger.remove();
  if (fallback !== "overflow") more.remove();
  if (fallback === "main" || fallback === "removed") day.remove();
  if (fallback === "removed") main.remove();
  await act(() => context.closeEvent());
  await settle();
  if (fallback !== "removed")
    expect(document.activeElement).toBe(
      fallback === "overflow" ? more : fallback === "day" ? day : main,
    );
  else expect(context.eventTrigger.current).toBeNull();
});
it("renders agenda pagination, navigation shortcuts and input exclusions", async () => {
  mocks.path = "/calendar/agenda";
  const mounted = await mount(screen("agenda"));
  await settle();
  const load = [...mounted.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Load more",
  ) as HTMLElement;
  await click(load);
  await settle();
  expect(buttons(mounted.host, "Team stand-up,").length).toBeGreaterThan(12);
  await key(mounted.host, "m");
  expect(mocks.router.push).toHaveBeenLastCalledWith("/calendar/month?d=2026-11-01");
  await key(mounted.host, "n");
  expect(mocks.router.replace).toHaveBeenLastCalledWith("/calendar/agenda?d=2026-12-01");
  mocks.router.replace.mockClear();
  await key(mounted.host.querySelector("input") as HTMLElement, "t");
  expect(mocks.router.replace).not.toHaveBeenCalled();
});
it("renders empty and error states with calendar creation and retry actions", async () => {
  const session = mocks.session as PodSession;
  mocks.session = {
    ...session,
    fetch: createDemoPod({
      root: DEMO_ROOT,
      seed: (await buildDemoSeed(NOW)).filter(
        (file) =>
          !file.path.startsWith("calendar/") && file.path !== "settings/privateTypeIndex.ttl",
      ),
    }).fetch,
  };
  const mounted = await mount(screen());
  await settle();
  expect(mounted.host.textContent).toContain("Your calendar starts here");
  await mounted.unmount();
  mocks.session = { ...session, fetch: async () => new Response(null, { status: 403 }) };
  const denied = await mount(screen());
  await settle();
  expect(denied.host.querySelector('[role="alert"]')).not.toBeNull();
  expect(denied.host.querySelector('[aria-label="Loading events"]')).toBeNull();
});
it("exposes optimistic mutation hooks and refreshes subscriptions without leaking the old account", async () => {
  let latest: ReturnType<typeof useEventsInRange> | undefined;
  let mutations: ReturnType<typeof useEventMutations> | undefined;
  let selected: Occurrence | undefined;
  function Probe() {
    latest = useEventsInRange("2026-11-01", "2026-11-02");
    mutations = useEventMutations();
    selected = useCalendarState().selected;
    return null;
  }
  const mounted = await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  expect(latest?.status).toBe("ready");
  const account = mocks.session as PodSession;
  const pending = deferred<Response>();
  const original = account.fetch;
  mocks.session = {
    ...account,
    fetch: async (input, init) =>
      init?.method === "PUT" ? pending.promise : original(input, init),
  };
  await mounted.render(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  let write: Promise<void> | undefined;
  await act(() => {
    write = mutations?.create(`${DEMO_ROOT}calendar/work/optimistic.ttl`, {
      name: "Optimistic",
      start: new Date(2026, 10, 1, 15),
      inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
    });
  });
  expect(
    latest?.status === "ready" && latest.events.some((e) => e.data.name === "Optimistic"),
  ).toBe(true);
  await act(async () => {
    pending.resolve(new Response(null, { status: 500 }));
    await write?.catch(() => undefined);
  });
  await settle();
  expect(
    latest?.status === "ready" && latest.events.some((e) => e.data.name === "Optimistic"),
  ).toBe(false);
  await act(() => notify?.(`${DEMO_ROOT}calendar/work/changed.ttl`));
  await settle();
  expect(latest?.status).toBe("ready");
  expect(selected).toBeUndefined();
  mocks.session = {
    ...account,
    webId: `${DEMO_ROOT}profile/card#other`,
    fetch: async () => {
      throw new Error("offline");
    },
  };
  await mounted.render(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  expect(latest?.status).toBe("error");
});

it.each([
  "week",
  "month",
] as const)("reconciles open %s details after remote edits and restores focus after deletion", async (view) => {
  mocks.path = `/calendar/${view}`;
  const mounted = await mount(screen(view));
  await settle();
  const trigger = buttons(mounted.host, "Team stand-up,")[0] as HTMLElement;
  const day = trigger.closest<HTMLElement>("[data-day]");
  const fallback = day ?? mounted.host.querySelector("#main-content");
  await click(trigger);
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const item = await io.loadEvent(url);
  if (!item) throw new Error("Missing stand-up fixture");
  await act(async () => {
    await io.saveEvent(
      url,
      { ...item.data, name: "Renamed remotely" },
      { etag: item.etag as string },
    );
  });
  await settle();
  expect(mounted.host.querySelector(".cal-details h2")?.textContent).toBe("Renamed remotely");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close event details");
  await act(async () => {
    const current = await io.loadEvent(url);
    await io.removeEvent(url, current?.etag as string);
  });
  await settle();
  expect(mounted.host.querySelector(".cal-details")).toBeNull();
  expect(fallback?.isConnected).toBe(true);
  expect(document.activeElement).toBe(fallback);
});

it("places adjacent 15-minute events in separate columns for their full 24px targets", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  for (const [name, start, end] of [
    ["First short event", "13:00", "13:15"],
    ["Second short event", "13:15", "13:30"],
  ] as const) {
    await io.saveEvent(
      `${DEMO_ROOT}calendar/work/${start}.ttl`,
      {
        name,
        start: new Date(`2026-11-01T${start}:00Z`),
        end: new Date(`2026-11-01T${end}:00Z`),
        inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
      },
      { create: true },
    );
  }
  const mounted = await mount(screen("day"));
  await settle();
  const first = buttons(mounted.host, "First short event,")[0] as HTMLButtonElement;
  const second = buttons(mounted.host, "Second short event,")[0] as HTMLButtonElement;
  expect(first.style.height).toBe("24px");
  expect(second.style.height).toBe("24px");
  expect(parseFloat(second.style.top) - parseFloat(first.style.top)).toBe(12);
  expect(first.style.left).not.toBe(second.style.left);
  for (const button of [first, second]) {
    await click(button);
    expect(mounted.host.querySelector(".cal-details h2")?.textContent).toBe(
      button.textContent?.split(",")[0],
    );
    await click(mounted.host.querySelector('[aria-label="Close event details"]') as HTMLElement);
  }
});

it.each([
  "profile/card",
  "settings/privateTypeIndex.ttl",
])("shows discovery failures and Retry in search for %s", async (path) => {
  mocks.path = "/calendar/search";
  const session = mocks.session as PodSession;
  let broken = true;
  mocks.session = {
    ...session,
    fetch: async (input, init) =>
      broken && String(input) === `${DEMO_ROOT}${path}`
        ? new Response(null, { status: 500 })
        : session.fetch(input, init),
  };
  const mounted = await mount(h(CalendarApp, { children: h(CalendarSearch) }));
  await settle();
  expect(mounted.host.querySelector('[role="alert"]')).not.toBeNull();
  expect(mounted.host.querySelector(".cal-slot")).toBeNull();
  broken = false;
  const retry = [...mounted.host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Retry"),
  );
  await click(retry as HTMLElement);
  await settle();
  expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
  expect(buttons(mounted.host, "Team stand-up,").length).toBeGreaterThan(0);
});

it.each([
  "week",
  "agenda",
  "search",
])("keeps all calendar failures and retry visible in empty %s results", async (view) => {
  mocks.path = `/calendar/${view}`;
  mocks.query = "no match";
  const session = mocks.session as PodSession;
  mocks.session = {
    ...session,
    fetch: async (input, init) =>
      /calendar\/(work|personal)\.ttl$/.test(String(input))
        ? new Response(null, { status: 500 })
        : session.fetch(input, init),
  };
  const mounted = await mount(
    view === "search"
      ? h(CalendarApp, { children: h(CalendarSearch) })
      : screen(view as CalendarView),
  );
  await settle();
  expect(mounted.host.querySelectorAll(".cal-warning")).toHaveLength(2);
  expect(mounted.host.querySelectorAll(".cal-warning button")).toHaveLength(2);
  expect(mounted.host.textContent).not.toContain("Your calendar starts here");
  expect(mounted.host.textContent).not.toContain("No events");
  expect(mounted.host.textContent).not.toContain("No results for");
});

it("keeps range failures visible in search with no matching events", async () => {
  mocks.path = "/calendar/search";
  mocks.query = "no match";
  const session = mocks.session as PodSession;
  mocks.session = {
    ...session,
    fetch: async (input, init) =>
      String(input) === `${DEMO_ROOT}calendar/work/`
        ? new Response(null, { status: 500 })
        : session.fetch(input, init),
  };
  const mounted = await mount(h(CalendarApp, { children: h(CalendarSearch) }));
  await settle();
  expect(mounted.host.querySelector(".cal-warning")?.textContent).toContain(
    "Could not load events from Work",
  );
  expect(mounted.host.textContent).toContain("Search results may be incomplete");
});

it("keeps confirmed creates, updates, ETags and deletes visible during slow revalidation, then accepts remote changes", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  let readGate: ReturnType<typeof deferred<void>> | undefined;
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (readGate && String(input) === `${DEMO_ROOT}calendar/work/`) await readGate.promise;
      return account.fetch(input, init);
    },
  };
  let latest!: ReturnType<typeof useEventsInRange>;
  let otherRange!: ReturnType<typeof useEventsInRange>;
  let mutations!: ReturnType<typeof useEventMutations>;
  function Probe() {
    latest = useEventsInRange("2026-11-01", "2026-11-02");
    otherRange = useEventsInRange("2026-10-01", "2026-12-01");
    mutations = useEventMutations();
    return null;
  }
  const mounted = await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const url = `${DEMO_ROOT}calendar/work/confirmed.ttl`;
  const data = {
    name: "Confirmed",
    start: new Date(2026, 10, 1, 14),
    inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
  };
  const current = () =>
    latest.status === "ready" ? latest.events.find((e) => e.url === url) : undefined;
  const other = () =>
    otherRange.status === "ready" ? otherRange.events.find((e) => e.url === url) : undefined;
  readGate = deferred<void>();
  await act(async () => {
    await mutations.create(url, data);
  });
  await settle();
  const created = await io.loadEvent(url);
  expect(current()?.data.name).toBe("Confirmed");
  expect(other()?.data.name).toBe("Confirmed");
  expect(current()?.etag).toBe(created?.etag);
  await act(() => {
    readGate?.resolve();
    readGate = undefined;
  });
  await settle();
  expect(current()?.etag).toBe(created?.etag);
  readGate = deferred<void>();
  await act(async () => {
    await mutations.update(url, { ...data, name: "Updated" }, created?.etag as string);
  });
  await settle();
  const updated = await io.loadEvent(url);
  expect(current()?.data.name).toBe("Updated");
  expect(current()?.etag).toBe(updated?.etag);
  await act(() => {
    readGate?.resolve();
    readGate = undefined;
  });
  await settle();
  await act(async () => {
    await io.saveEvent(url, { ...data, name: "Remote" }, { etag: updated?.etag as string });
  });
  await settle();
  expect(current()?.data.name).toBe("Remote");
  const remote = await io.loadEvent(url);
  readGate = deferred<void>();
  await act(async () => {
    await mutations.delete(url, remote?.etag as string);
  });
  await settle();
  expect(current()).toBeUndefined();
  expect(other()).toBeUndefined();
  await act(() => {
    readGate?.resolve();
    readGate = undefined;
  });
  await settle();
  expect(current()).toBeUndefined();
  expect(other()).toBeUndefined();
  await mounted.unmount();
});

it("renders session loading/error states and retries the session", async () => {
  mocks.status = "loading";
  const mounted = await mount(h(CalendarProvider, { children: null }));
  expect(mounted.host.textContent).toContain("Opening Calendar");
  mocks.status = "error";
  await mounted.render(h(CalendarProvider, { children: null }));
  expect(mounted.host.querySelector('[role="alert"]')).not.toBeNull();
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  await click(
    [...mounted.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Retry",
    ) as HTMLElement,
  );
  expect(reload).toHaveBeenCalledOnce();
});

it("requires a provider for calendar hooks", async () => {
  function Orphan() {
    useCalendarState();
    return null;
  }
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(mount(h(Orphan))).rejects.toThrow("Calendar hooks require CalendarProvider");
  } finally {
    errors.mockRestore();
  }
});

it("retries an incomplete calendar creation through the context", async () => {
  const account = mocks.session as PodSession;
  let broken = true;
  mocks.session = {
    ...account,
    fetch: async (input, init) =>
      broken && String(input).endsWith("/recover-context/") && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : account.fetch(input, init),
  };
  let context!: ReturnType<typeof useCalendarState>;
  function Probe() {
    context = useCalendarState();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  await act(async () => {
    await expect(context.create("Recover Context", PALETTE[0] as string)).rejects.toThrow("500");
  });
  broken = false;
  await act(async () => {
    await context.create("Recover Context", PALETTE[0] as string);
  });
  await settle();
  expect(
    context.calendars.status === "ready" &&
      context.calendars.calendars.some((c) => c.title === "Recover Context"),
  ).toBe(true);
});

it("keeps pending updates with their ETag, hides their calendar and closes its selected details", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const item = await io.loadEvent(url);
  if (!item) throw new Error("Missing stand-up fixture");
  const gate = deferred<void>();
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (String(input) === url && init?.method === "PUT") await gate.promise;
      return account.fetch(input, init);
    },
  };
  let context!: ReturnType<typeof useCalendarState>;
  let latest!: ReturnType<typeof useEventsInRange>;
  let mutations!: ReturnType<typeof useEventMutations>;
  function Probe() {
    context = useCalendarState();
    latest = useEventsInRange("2026-10-26", "2026-11-02");
    mutations = useEventMutations();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  await act(() => {
    if (latest.status === "ready")
      context.openEvent(latest.events.find((e) => e.url === url) as Occurrence, document.body);
  });
  let task: Promise<void> | undefined;
  await act(() => {
    task = mutations.update(url, { ...item.data, name: "Pending rename" }, item.etag as string);
  });
  expect(latest.status === "ready" && latest.events.find((e) => e.url === url)?.etag).toBe(
    item.etag,
  );
  expect(context.selected?.data.name).toBe("Pending rename");
  await act(() => {
    context.setPrefs((prefs) => ({ ...prefs, hidden: [`${DEMO_ROOT}calendar/work.ttl`] }));
  });
  await settle();
  expect(context.selected).toBeUndefined();
  expect(latest.status === "ready" && latest.events.some((e) => e.url === url)).toBe(false);
  await act(async () => {
    gate.resolve();
    await task;
  });
  await settle();
  await act(async () => {
    await expect(mutations.update(url, item.data, '"stale"')).rejects.toThrow("412");
  });
});

it("keeps legacy events without inCalendar and their open Details visible through optimistic success and rollback", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const original = await io.loadEvent(url);
  if (!original) throw new Error("Missing stand-up fixture");
  const { inCalendar: _calendar, ...legacy } = original.data;
  const etag = await io.saveEvent(url, legacy, { etag: original.etag as string });
  let writeGate = deferred<boolean>();
  let readGate: ReturnType<typeof deferred<void>> | undefined;
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (String(input) === url && init?.method === "PUT" && !(await writeGate.promise))
        return new Response(null, { status: 500 });
      if (String(input) === `${DEMO_ROOT}calendar/work/` && readGate) await readGate.promise;
      return account.fetch(input, init);
    },
  };
  let context!: ReturnType<typeof useCalendarState>;
  let latest!: ReturnType<typeof useEventsInRange>;
  let mutations!: ReturnType<typeof useEventMutations>;
  function Probe() {
    context = useCalendarState();
    latest = useEventsInRange("2026-10-26", "2026-11-02");
    mutations = useEventMutations();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const occurrences = () =>
    latest.status === "ready" ? latest.events.filter((event) => event.url === url) : [];
  expect(occurrences()).toHaveLength(3);
  expect(occurrences()[0]?.data.inCalendar).toBeUndefined();
  await act(() => context.openEvent(occurrences()[0] as Occurrence, document.body));
  let task!: Promise<void>;
  await act(() => {
    task = mutations.update(url, { ...legacy, name: "Pending legacy rename" }, etag as string);
  });
  expect(occurrences()).toHaveLength(3);
  expect(
    occurrences().every((event) => event.calendar.title === "Work" && event.etag === etag),
  ).toBe(true);
  expect(context.selected?.data.name).toBe("Pending legacy rename");
  await act(async () => {
    writeGate.resolve(false);
    await expect(task).rejects.toThrow("500");
  });
  await settle();
  expect(occurrences()).toHaveLength(3);
  expect(context.selected?.data.name).toBe(legacy.name);
  writeGate = deferred<boolean>();
  readGate = deferred<void>();
  await act(() => {
    task = mutations.update(url, { ...legacy, name: "Saved legacy rename" }, etag as string);
  });
  expect(context.selected?.data.name).toBe("Saved legacy rename");
  await act(async () => {
    writeGate.resolve(true);
    await task;
  });
  await settle();
  expect(occurrences()).toHaveLength(3);
  expect(context.selected?.data.name).toBe("Saved legacy rename");
  expect(context.selected?.etag).toBe((await io.loadEvent(url))?.etag);
  await act(() => {
    readGate?.resolve();
    readGate = undefined;
  });
  await settle();
  expect(context.selected?.data.name).toBe("Saved legacy rename");
});

it("derives a missing calendar association from the scoped event container when no occurrence is cached", async () => {
  const account = mocks.session as PodSession;
  const gate = deferred<void>();
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT") await gate.promise;
      return account.fetch(input, init);
    },
  };
  let latest!: ReturnType<typeof useEventsInRange>;
  let mutations!: ReturnType<typeof useEventMutations>;
  function Probe() {
    latest = useEventsInRange("2026-11-01", "2026-11-02");
    mutations = useEventMutations();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  let task!: Promise<void>;
  const data = { name: "No predicate", start: "2026-11-01" };
  const url = `${DEMO_ROOT}calendar/work/new-legacy.ttl`;
  await act(() => {
    task = mutations.create(url, data);
  });
  const current = () =>
    latest.status === "ready" ? latest.events.find((event) => event.url === url) : undefined;
  expect(current()?.calendar.title).toBe("Work");
  expect(current()?.data.inCalendar).toBeUndefined();
  await act(async () => {
    gate.resolve();
    await task;
  });
  await settle();
  expect(current()?.calendar.title).toBe("Work");
  let rejected!: Promise<void>;
  await act(() => {
    rejected = mutations.create("https://attacker.example/calendar/work/foreign.ttl", data);
    void rejected.catch(() => undefined);
  });
  await act(async () => {
    await expect(rejected).rejects.toThrow();
  });
  expect(
    latest.status === "ready" &&
      latest.events.some((event) => event.url.includes("attacker.example")),
  ).toBe(false);
});

it("surfaces rejected cached ranges, retries them and ignores late failure after unmount", async () => {
  let context!: ReturnType<typeof useCalendarState>;
  let latest!: ReturnType<typeof useEventsInRange>;
  function Range() {
    latest = useEventsInRange("2026-11-01", "2026-11-02");
    return null;
  }
  function Harness({ show }: { show: boolean }) {
    context = useCalendarState();
    return show ? h(Range) : null;
  }
  const render = (show: boolean) => h(CalendarProvider, { children: h(Harness, { show }) });
  const mounted = await mount(render(false));
  await settle();
  const cacheKey = () => {
    if (context.calendars.status !== "ready") throw new Error("Calendars not ready");
    return rangeKey(
      context.session.webId,
      context.calendars.calendars.map((c) => JSON.stringify([c.url, c.etag, c.title, c.colour])),
      "2026-11-01",
      "2026-11-02",
    );
  };
  const error = new Error("cached range failed");
  const gate = deferred<never>();
  context.cache.set(cacheKey(), gate.promise);
  await mounted.render(render(true));
  await act(async () => {
    gate.reject(error);
    await gate.promise.catch(() => undefined);
  });
  expect(latest.status).toBe("error");
  expect(context.cache.has(cacheKey())).toBe(false);
  await act(() => context.reload());
  await settle();
  expect(latest.status).toBe("ready");
  await mounted.render(render(false));
  const late = deferred<never>();
  context.cache.set(cacheKey(), late.promise);
  await mounted.render(render(true));
  await mounted.unmount();
  await act(async () => {
    late.reject(error);
    await late.promise.catch(() => undefined);
  });
});

it.each([
  375, 768,
])("restores the event trigger after closing the details Sheet at %s pixels", async (width) => {
  const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches:
      query.includes("max-width: 1023px") || (width === 375 && query.includes("max-width: 639px")),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
  try {
    const mounted = await mount(screen());
    await settle();
    const event = buttons(mounted.host, "Team stand-up,")[0] as HTMLElement;
    await act(() => event.focus());
    await click(event);
    expect(document.querySelector('[role="dialog"] .cal-details')).not.toBeNull();
    await click(document.querySelector('[aria-label="Close event details"]') as HTMLElement);
    await settle();
    expect(document.querySelector(".cal-details")).toBeNull();
    expect(document.activeElement).toBe(event);
  } finally {
    media.mockRestore();
  }
});

it("acknowledges writes and reconciles details per calendar while another calendar fails", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  let failedCalendar = "";
  mocks.session = {
    ...account,
    fetch: async (input, init) =>
      failedCalendar && String(input) === `${DEMO_ROOT}calendar/${failedCalendar}/`
        ? new Response(null, { status: 500 })
        : account.fetch(input, init),
  };
  let context!: ReturnType<typeof useCalendarState>;
  let latest!: ReturnType<typeof useEventsInRange>;
  let mutations!: ReturnType<typeof useEventMutations>;
  function Probe() {
    context = useCalendarState();
    latest = useEventsInRange("2026-11-01", "2026-11-02");
    mutations = useEventMutations();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const url = `${DEMO_ROOT}calendar/work/partial.ttl`;
  const data = {
    name: "Saved locally",
    start: new Date(2026, 10, 1, 14),
    inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
  };
  failedCalendar = "work";
  await act(async () => {
    await mutations.create(url, data);
  });
  await settle();
  const event = () =>
    latest.status === "ready" ? latest.events.find((e) => e.url === url) : undefined;
  expect(event()?.data.name).toBe("Saved locally");
  await act(() => {
    context.openEvent(event() as Occurrence, document.body);
  });
  expect(context.selected?.data.name).toBe("Saved locally");
  failedCalendar = "personal";
  await act(() => context.reload());
  await settle();
  const item = await io.loadEvent(url);
  await act(async () => {
    await io.saveEvent(url, { ...data, name: "Remote rename" }, { etag: item?.etag as string });
  });
  await settle();
  expect(event()?.data.name).toBe("Remote rename");
  expect(context.selected?.data.name).toBe("Remote rename");
  expect(latest.status === "ready" && latest.warnings).toHaveLength(1);
});

async function changeField(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(() => {
    const prototype =
      input instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
it("creates a weekly series from the full editor and announces invalid end dates", async () => {
  mocks.path = "/calendar/e/new";
  mocks.extra = {
    start: "2027-01-04",
    end: "2027-01-05",
    cal: `${DEMO_ROOT}calendar/work.ttl#it`,
    return: "/calendar/month?d=2027-01-01",
  };
  const mounted = await mount(
    h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: "new" }) }),
  );
  await settle();
  const editor = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    editor.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Weekly planning",
  );
  await changeField(
    [...editor.querySelectorAll("input")].find((i) =>
      i.closest(".suite-date-field")?.textContent?.startsWith("End"),
    ) as HTMLInputElement,
    "3 Jan 2027",
  );
  await act(() =>
    editor
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(editor.querySelector('[role="alert"]')?.textContent).toBe("End must be after start.");
  await changeField(
    [...editor.querySelectorAll("input")].find((i) =>
      i.closest(".suite-date-field")?.textContent?.startsWith("End"),
    ) as HTMLInputElement,
    "5 Jan 2027",
  );
  expect((editor.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Weekly planning",
  );
  const frequency = [...editor.querySelectorAll("select")].find((s) =>
    s.closest("label")?.textContent?.startsWith("Frequency"),
  ) as HTMLSelectElement;
  await changeField(frequency, "WEEKLY");
  expect((editor.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Weekly planning",
  );
  await act(() =>
    editor
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  expect(editor.querySelector('[role="alert"]')?.textContent).toBeUndefined();
  expect(mocks.router.push).toHaveBeenLastCalledWith("/calendar/month?d=2027-01-01");
  const account = mocks.session as PodSession;
  const events = await calendarIO(account.fetch, account.storageUrl).eventsInRange(
    `${DEMO_ROOT}calendar/work/`,
    new Date("2027-01-01"),
    new Date("2027-02-01"),
  );
  expect(events.filter((e) => e.data.name === "Weekly planning")).toHaveLength(4);
  const created = events.find((e) => e.data.name === "Weekly planning");
  if (!created) throw new Error("Missing newly created series");
  mocks.path = `/calendar/e/${encodeRef(created.url)}`;
  mocks.extra = { occurrence: "2027-01-11", return: "/calendar/month?d=2027-01-01" };
  await mounted.render(
    h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(created.url) }) }),
  );
  await settle();
  const nextEditor = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    nextEditor.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Changed local",
  );
  await act(() =>
    nextEditor
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await click(
    [...document.querySelectorAll(".cal-series-dialog button")].find(
      (b) => b.textContent === "This event",
    ) as HTMLElement,
  );
  await settle();
  const saved = await calendarIO(account.fetch, account.storageUrl).eventsInRange(
    `${DEMO_ROOT}calendar/work/`,
    new Date("2027-01-01"),
    new Date("2027-02-01"),
  );
  expect(saved.filter((e) => e.data.name === "Changed local")).toHaveLength(1);
  expect(saved.filter((e) => e.data.name === "Weekly planning")).toHaveLength(3);
});
it("loads the series master for editing an occurrence and detaches just that occurrence", async () => {
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  mocks.extra = { occurrence: "2026-10-28T09:30:00.000Z", return: "/calendar/week?d=2026-11-01" };
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const editor = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    editor.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Changed once",
  );
  await act(() =>
    editor
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await click(
    [...document.querySelectorAll(".cal-series-dialog button")].find(
      (b) => b.textContent === "This event",
    ) as HTMLElement,
  );
  await settle();
  const account = mocks.session as PodSession;
  const events = await calendarIO(account.fetch, account.storageUrl).eventsInRange(
    `${DEMO_ROOT}calendar/work/`,
    new Date("2026-10-26"),
    new Date("2026-11-02"),
  );
  expect(events.filter((e) => e.data.name === "Changed once")).toHaveLength(1);
  expect(events.filter((e) => e.data.name === "Team stand-up")).toHaveLength(2);
});
it("retains offline intents and replays them on online, while rejecting invalid ETags", async () => {
  const account = mocks.session as PodSession;
  let offline = true;
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT" && offline) throw new TypeError("network");
      return account.fetch(input, init);
    },
  };
  let api: ReturnType<typeof useEventMutations> | undefined;
  let status = "";
  function Probe() {
    api = useEventMutations();
    status = useCalendarState().syncStatus;
    return null;
  }
  const mounted = await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const url = `${DEMO_ROOT}calendar/work/offline.ttl`;
  const data = {
    name: "Offline",
    start: new Date("2026-11-01T15:00Z"),
    end: new Date("2026-11-01T16:00Z"),
  };
  await act(async () => {
    await api?.create(url, data);
  });
  expect(status).toBe("Saved on this device, will sync");
  expect(localStorage.getItem(`suite:calendar:outbox:${DEMO_WEBID}`)).toContain("Offline");
  offline = false;
  await act(() => window.dispatchEvent(new Event("online")));
  await settle();
  expect(status).toBe("Saved");
  expect((await calendarIO(account.fetch, account.storageUrl).loadEvent(url))?.data.name).toBe(
    "Offline",
  );
  for (const etag of ["", "*", 'W/"1"'])
    await act(async () => {
      await expect(api?.update(url, data, etag)).rejects.toThrow("Reload");
    });
  await mounted.unmount();
});
it("keeps offline writes when navigator reports offline and surfaces non-network transport errors", async () => {
  const account = mocks.session as PodSession;
  let failure: unknown = new Error("transport denied");
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT") throw failure;
      return account.fetch(input, init);
    },
  };
  let api: ReturnType<typeof useEventMutations> | undefined;
  let status = "";
  function Probe() {
    api = useEventMutations();
    status = useCalendarState().syncStatus;
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await settle();
  const url = `${DEMO_ROOT}calendar/work/network.ttl`;
  const data = { name: "Network", start: "2026-11-01" };
  await act(async () => {
    await expect(api?.create(url, data)).rejects.toThrow("transport denied");
  });
  failure = new TypeError("network");
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    await api?.create(url, data);
  });
  expect(status).toBe("Saved on this device, will sync");
  online.mockRestore();
});
it("does not write before discovery has identified the user's calendars", async () => {
  const account = mocks.session as PodSession;
  const loading = deferred<Response>();
  mocks.session = {
    ...account,
    fetch: async (input, init) =>
      String(input).includes("profile/card") ? loading.promise : account.fetch(input, init),
  };
  let api: ReturnType<typeof useEventMutations> | undefined;
  function Probe() {
    api = useEventMutations();
    return null;
  }
  await mount(h(CalendarProvider, { children: h(Probe) }));
  await act(async () => {
    await expect(
      api?.create(`${DEMO_ROOT}calendar/work/e.ttl`, { name: "Early", start: "2026-11-01" }),
    ).rejects.toThrow("Calendars are still loading");
  });
});
it("parses and saves a quick-create title through the existing mutations", async () => {
  // "tomorrow" is relative to the real clock: pin it to the seed's day so the test can't expire.
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  mocks.path = "/calendar/month";
  const mounted = await mount(screen("month"));
  await settle();
  const cell = mounted.host.querySelector('.cal-month [data-day="2026-11-02"]') as HTMLElement;
  await act(() => cell.focus());
  await key(cell, "Enter");
  await settle();
  const popover = document.querySelector(".cal-quick") as HTMLElement;
  expect(popover).not.toBeNull();
  await changeField(
    popover.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Lunch with Sam tomorrow 1pm",
  );
  await changeField(
    popover.querySelector("select") as HTMLSelectElement,
    `${DEMO_ROOT}calendar/work.ttl#it`,
  );
  await act(() =>
    popover
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  expect(document.querySelector(".cal-quick")).toBeNull();
  const account = mocks.session as PodSession;
  const events = await calendarIO(account.fetch, account.storageUrl).eventsInRange(
    `${DEMO_ROOT}calendar/work/`,
    new Date("2026-11-02"),
    new Date("2026-11-03"),
  );
  const lunch = events.find((e) => e.data.name === "Lunch with Sam");
  expect(lunch?.data.start).toEqual(new Date("2026-11-02T13:00Z"));
  expect(lunch?.data.end).toEqual(new Date("2026-11-02T14:00Z"));
});
it("infers the calendar for a legacy event and saves its editor fields", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const old = await io.loadEvent(url);
  if (!old?.etag) throw new Error("Missing seed");
  await io.saveEvent(
    url,
    { ...old.data, inCalendar: undefined, recurrence: undefined },
    { etag: old.etag },
  );
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  expect((form.querySelector('[aria-label="Calendar"]') as HTMLSelectElement).value).toBe(
    `${DEMO_ROOT}calendar/work.ttl#it`,
  );
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Edited legacy",
  );
  await act(() =>
    form
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  expect((await io.loadEvent(url))?.data.name).toBe("Edited legacy");
});
it("rejects an impossible date in a direct new-event URL", async () => {
  mocks.path = "/calendar/e/new";
  mocks.extra = { start: "2026-02-31", end: "2026-03-02", cal: `${DEMO_ROOT}calendar/work.ttl#it` };
  const mounted = await mount(
    h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: "new" }) }),
  );
  await settle();
  expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe(
    "This event reference or its dates are invalid.",
  );
  expect(mounted.host.querySelector(".cal-editor-page")).toBeNull();
});

it.each([
  ["create", "save"],
  ["create", "delete"],
  ["update", "save"],
  ["update", "delete"],
] as const)("keeps the editor draft while a pending %s resolves before %s", async (kind, action) => {
  const account = mocks.session as PodSession;
  const url = `${DEMO_ROOT}calendar/work/pending-editor.ttl`;
  const io = calendarIO(account.fetch, account.storageUrl);
  const data = {
    name: "Pending event",
    start: new Date("2026-11-01T12:00Z"),
    end: new Date("2026-11-01T13:00Z"),
    inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
  };
  const etag = kind === "update" ? await io.saveEvent(url, data, { create: true }) : null;
  const gate = deferred<void>();
  let first = true;
  const requests: RequestInit[] = [];
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (String(input) === url && (init?.method === "PUT" || init?.method === "DELETE")) {
        requests.push(init);
        if (first) {
          first = false;
          await gate.promise;
        }
      }
      return account.fetch(input, init);
    },
  };
  let api!: ReturnType<typeof useEventMutations>;
  function Probe() {
    api = useEventMutations();
    return null;
  }
  const content = (edit: boolean) =>
    h(CalendarApp, {
      children: h(
        "div",
        null,
        h(Probe),
        edit ? h(CalendarEditorRoute, { eventRef: encodeRef(url) }) : null,
      ),
    });
  const mounted = await mount(content(false));
  await settle();
  let pending!: Promise<void>;
  await act(() => {
    pending = kind === "create" ? api.create(url, data) : api.update(url, data, etag as string);
  });
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  await mounted.render(content(true));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Retained draft",
  );
  if (action === "save")
    await act(() =>
      form
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  else
    await click(
      [...form.querySelectorAll("button")].find(
        (button) => button.textContent === "Delete",
      ) as HTMLElement,
    );
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect((form.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Retained draft",
  );
  expect(requests).toHaveLength(1);
  await act(async () => {
    gate.resolve();
    await pending;
  });
  await settle();
  expect(requests).toHaveLength(2);
  expect(new Headers(requests[1]?.headers).get("If-Match")).toBeTruthy();
  expect(mocks.router.push).toHaveBeenCalled();
  if (action === "save") expect((await io.loadEvent(url))?.data.name).toBe("Retained draft");
  else expect((await account.fetch(url)).status).toBe(404);
});
it("retains the editor draft on a 412, refreshes preconditions, and allows an explicit retry", async () => {
  const account = mocks.session as PodSession;
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const old = (await io.loadEvent(url))!;
  await io.saveEvent(url, { ...old.data, recurrence: undefined }, { etag: old.etag as string });
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "My conflict draft",
  );
  const current = (await io.loadEvent(url))!;
  await act(async () => {
    await io.saveEvent(
      url,
      { ...current.data, name: "Changed elsewhere" },
      { etag: current.etag as string },
    );
  });
  const submit = () =>
    act(() =>
      form
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await submit();
  await settle();
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere");
  expect((form.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "My conflict draft",
  );
  await submit();
  await settle();
  expect(mocks.router.push).toHaveBeenCalled();
  expect((await io.loadEvent(url))?.data.name).toBe("My conflict draft");
});
it.each([
  "This event",
  "This and following events",
])("preserves the series and draft if replacement creation fails for %s", async (mode) => {
  const account = mocks.session as PodSession;
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const io = calendarIO(account.fetch, account.storageUrl);
  const before = await io.loadEvent(url);
  let broken = true;
  const writes: string[] = [];
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT" || init?.method === "DELETE") {
        writes.push(`${init.method} ${String(input)}`);
        if (broken && String(input) !== url) return new Response(null, { status: 500 });
      }
      return account.fetch(input, init);
    },
  };
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  mocks.extra = { occurrence: "2026-10-28T09:30:00.000Z" };
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Retry replacement",
  );
  const save = async () => {
    await act(() =>
      form
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await click(
      [...document.querySelectorAll(".cal-series-dialog button")].find(
        (button) => button.textContent === mode,
      ) as HTMLElement,
    );
    await settle();
  };
  await save();
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toContain(url);
  expect(await io.loadEvent(url)).toEqual(before);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(form.querySelector('[role="alert"]')).not.toBeNull();
  expect((form.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Retry replacement",
  );
  broken = false;
  await save();
  expect(mocks.router.push).toHaveBeenCalled();
  expect(writes[2]).toBe(`PUT ${url}`);
});
it.each([
  "This event",
  "This and following events",
])("compensates the replacement when the original write fails for %s", async (mode) => {
  const account = mocks.session as PodSession;
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const io = calendarIO(account.fetch, account.storageUrl);
  const before = await io.loadEvent(url);
  const writes: [string, string][] = [];
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT" || init?.method === "DELETE") {
        writes.push([init.method, String(input)]);
        if (String(input) === url) return new Response(null, { status: 500 });
      }
      return account.fetch(input, init);
    },
  };
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  mocks.extra = { occurrence: "2026-10-28T09:30:00.000Z" };
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Retain after rollback",
  );
  await act(() =>
    form
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await click(
    [...document.querySelectorAll(".cal-series-dialog button")].find(
      (button) => button.textContent === mode,
    ) as HTMLElement,
  );
  await settle();
  expect(writes.map(([method]) => method)).toEqual(["PUT", "PUT", "DELETE"]);
  expect(writes[1]?.[1]).toBe(url);
  expect(writes[2]?.[1]).toBe(writes[0]?.[1]);
  expect((await account.fetch(writes[0]![1])).status).toBe(404);
  expect(await io.loadEvent(url)).toEqual(before);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect((form.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Retain after rollback",
  );
  expect(form.querySelector('[role="alert"]')).not.toBeNull();
});
it("exports and re-imports a timed series saved through the editor's Ends on date field", async () => {
  mocks.path = "/calendar/e/new";
  mocks.extra = {
    start: "2026-10-18T08:00:00Z",
    end: "2026-10-18T09:00:00Z",
    cal: `${DEMO_ROOT}calendar/work.ttl#it`,
  };
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: "new" }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(form.querySelector('[aria-label="Title"]') as HTMLInputElement, "Timed ending");
  const labelled = (name: string) =>
    [...form.querySelectorAll("select")].find((select) =>
      select.closest("label")?.textContent?.startsWith(name),
    ) as HTMLSelectElement;
  await changeField(labelled("Frequency"), "WEEKLY");
  await changeField(labelled("Ends"), "on");
  await changeField(form.querySelector('input[type="date"]') as HTMLInputElement, "2026-10-25");
  await act(() =>
    form
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  expect(mocks.router.push).toHaveBeenCalled();
  const account = mocks.session as PodSession;
  const { exportCalendar } = await import("../src/apps/calendar/state/transfer");
  const { discoverCalendars } = await import("../src/apps/calendar/state/repository");
  const { importICal } = await import("../src/apps/calendar/lib/model");
  const calendar = (await discoverCalendars(account)).calendars.find(
    (calendar) => calendar.title === "Work",
  )!;
  const parsed = importICal(await exportCalendar(account, calendar));
  expect(parsed.skipped).toBe(0);
  expect(parsed.warnings).toEqual([]);
  const event = parsed.events.find((event) => event.name === "Timed ending");
  expect(event?.recurrence?.until).toEqual(new Date("2026-10-25T23:59:59Z"));
});

it("retries a failed compensation before creating another replacement and deleting the original", async () => {
  const account = mocks.session as PodSession;
  const url = `${DEMO_ROOT}calendar/work/stand-up.ttl`;
  const io = calendarIO(account.fetch, account.storageUrl);
  const original = (await io.loadEvent(url))!;
  let broken = true;
  const writes: [string, string][] = [];
  mocks.session = {
    ...account,
    fetch: async (input, init) => {
      if (init?.method === "PUT" || init?.method === "DELETE") {
        writes.push([init.method, String(input)]);
        if (broken && init.method === "DELETE") return new Response(null, { status: 500 });
      }
      return account.fetch(input, init);
    },
  };
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  mocks.extra = { occurrence: new Date(original.data.start).toISOString() };
  await mount(h(CalendarApp, { children: h(CalendarEditorRoute, { eventRef: encodeRef(url) }) }));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Cleanup then retry",
  );
  const save = async () => {
    await act(() =>
      form
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await click(
      [...document.querySelectorAll(".cal-series-dialog button")].find(
        (button) => button.textContent === "This and following events",
      ) as HTMLElement,
    );
    await settle();
  };
  await save();
  expect(writes.map(([method]) => method)).toEqual(["PUT", "DELETE", "DELETE"]);
  expect(await io.loadEvent(url)).toEqual(original);
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("retry cleanup");
  expect(mocks.router.push).not.toHaveBeenCalled();
  broken = false;
  await save();
  expect(writes.map(([method]) => method)).toEqual([
    "PUT",
    "DELETE",
    "DELETE",
    "DELETE",
    "PUT",
    "DELETE",
  ]);
  expect(writes[3]?.[1]).toBe(writes[0]?.[1]);
  expect((await account.fetch(writes[0]![1])).status).toBe(404);
  expect((await account.fetch(url)).status).toBe(404);
  const events = await io.eventsInRange(
    `${DEMO_ROOT}calendar/work/`,
    new Date("2026-10-26"),
    new Date("2026-11-02"),
  );
  expect(events.filter((event) => event.data.name === "Cleanup then retry")).toHaveLength(3);
  expect(mocks.router.push).toHaveBeenCalled();
});

it("shows the import warning before an unsupported New York series can be saved", async () => {
  await mount(screen());
  await settle();
  const text =
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:ny\nSUMMARY:New York weekly\nDTSTART;TZID=America/New_York:20261018T090000\nRRULE:FREQ=WEEKLY;COUNT=4\nEND:VEVENT\nEND:VCALENDAR";
  const input = document.querySelector('[aria-label="Import ICS file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [{ name: "new-york.ics", size: text.length, text: async () => text }],
    configurable: true,
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
  const dialog = document.querySelector(".cal-import-dialog") as HTMLElement;
  expect(dialog.textContent).toContain("0 events · 1 skipped");
  expect(dialog.querySelector('[aria-label="Import warnings"]')?.textContent).toContain(
    '"New York weekly": recurring events in America/New_York',
  );
  expect(
    [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Import")
      ?.disabled,
  ).toBe(true);
});
it.each([
  "create",
  "update",
] as const)("keeps a draft open when its pending %s prerequisite is rejected", async (kind) => {
  const account = mocks.session as PodSession;
  const url = `${DEMO_ROOT}calendar/work/rejected-prerequisite.ttl`;
  const io = calendarIO(account.fetch, account.storageUrl);
  const data = {
    name: "Prerequisite",
    start: new Date("2026-11-01T12:00Z"),
    end: new Date("2026-11-01T13:00Z"),
    inCalendar: `${DEMO_ROOT}calendar/work.ttl#it`,
  };
  const etag = kind === "update" ? await io.saveEvent(url, data, { create: true }) : null;
  const gate = deferred<Response>();
  mocks.session = {
    ...account,
    fetch: (input, init) =>
      String(input) === url && init?.method === "PUT" ? gate.promise : account.fetch(input, init),
  };
  let api!: ReturnType<typeof useEventMutations>;
  function Probe() {
    api = useEventMutations();
    return null;
  }
  const content = (edit: boolean) =>
    h(CalendarApp, {
      children: h(
        "div",
        null,
        h(Probe),
        edit ? h(CalendarEditorRoute, { eventRef: encodeRef(url) }) : null,
      ),
    });
  const mounted = await mount(content(false));
  await settle();
  let pending!: Promise<unknown>;
  await act(() => {
    pending = (
      kind === "create" ? api.create(url, data) : api.update(url, data, etag as string)
    ).catch((error: unknown) => error);
  });
  mocks.path = `/calendar/e/${encodeRef(url)}`;
  await mounted.render(content(true));
  await settle();
  const form = document.querySelector(".cal-editor-page") as HTMLElement;
  await changeField(
    form.querySelector('[aria-label="Title"]') as HTMLInputElement,
    "Still my draft",
  );
  await act(() =>
    form
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => {
    gate.resolve(new Response(null, { status: 500 }));
    await pending;
  });
  await settle();
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect((form.querySelector('[aria-label="Title"]') as HTMLInputElement).value).toBe(
    "Still my draft",
  );
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("500");
});
