// AUTHORED-BY Codex GPT-6
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  pathname: "/calendar/__",
  query: "",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => {
    throw new Error("Native routing must not read the placeholder params");
  },
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("../src/apps/calendar/components/calendar-views", () => ({
  CalendarScreen: ({ view }: { view: string }) => h("span", null, view),
}));

let routes: typeof import("../src/apps/calendar/components/native-route");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  routes = await import("../src/apps/calendar/components/native-route");
}, 30_000);
afterAll(() => vi.unstubAllEnvs());

it("waits for the real URL and follows sibling views on the mounted native route", async () => {
  const mounted = await mount(h(routes.NativeCalendarView));
  expect(mounted.host.textContent).not.toContain("__");
  for (const view of ["week", "month", "day", "agenda"]) {
    navigation.pathname = `/calendar/${view}/`;
    await mounted.render(h(routes.NativeCalendarView));
    expect(mounted.host.textContent).toBe(view);
  }
});

it("retains invalid-view rejection on the native target", async () => {
  navigation.pathname = "/calendar/invalid/";
  await expect(mount(h(routes.NativeCalendarView))).rejects.toThrow("not-found");
});

it.each([
  "",
  "d=2026-11-01",
  "d=a%26b",
])("preserves the calendar entry date for %s", async (query) => {
  navigation.query = query;
  await mount(h(routes.NativeCalendarIndex));
  expect(navigation.replace).toHaveBeenLastCalledWith(`/calendar/week${query ? `?${query}` : ""}`);
});
