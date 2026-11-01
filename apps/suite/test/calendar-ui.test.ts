// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  useSearchParams: () => new URLSearchParams({ d: mocks.date, q: mocks.query }),
  useRouter: () => mocks.router,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as string),
}));

import { CalendarApp } from "../src/apps/calendar/components/calendar-app";
import { CalendarScreen, CalendarSearch } from "../src/apps/calendar/components/calendar-views";
import {
  CalendarProvider,
  useCalendarState,
  useEventMutations,
  useEventsInRange,
} from "../src/apps/calendar/state/calendar-context";
import type { CalendarView, Occurrence } from "../src/apps/calendar/state/view";

const NOW = Date.UTC(2026, 10, 1, 12);
let unsubscribe: (() => void) | undefined;
let notify: ((url: string) => void) | undefined;
beforeEach(async () => {
  mocks.path = "/calendar/week";
  mocks.date = "2026-11-01";
  mocks.query = "";
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
  expect(mounted.host.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
});
it("moves month focus, handles date navigation and opens the selected day", async () => {
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
  expect(mocks.router.push).toHaveBeenLastCalledWith("/calendar/day?d=2026-12-02");
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
  expect(document.querySelector(".cal-overflow")?.textContent).toContain("Personal plan 6");
  await mounted.unmount();
  mocks.path = "/calendar/search";
  mocks.query = "share";
  const search = await mount(h(CalendarApp, { children: h(CalendarSearch) }));
  await settle();
  expect(search.host.textContent).toContain("Searching events from");
  expect(buttons(search.host, "Dinner with friends,")).toHaveLength(1);
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
  expect(latest?.status).toBe("loading");
});
