// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { Series } from "@jeswr/suite-insights";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";
import type { Source } from "../../src/apps/insights/lib/sources";
import type { InsightsSnapshot } from "../../src/apps/insights/state/store";
import type { PodSession } from "../../src/lib/session/pod-session";

vi.mock("@/shell/app-frame", () => ({
  AppFrame: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
  AppHeading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
  PodSessionGate: ({ children }: { children: (session: PodSession) => ReactNode }) =>
    children(session),
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/route-params", () => ({ useRoutePathname: () => "/insights" }));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => connection }));
vi.mock("../../src/apps/insights/state/insights-context", () => ({
  InsightsProvider: ({ children }: { children: ReactNode }) => children,
  useInsights: () => current,
}));
vi.mock("@jeswr/suite-insights", async (original) => {
  const actual = await original<typeof import("@jeswr/suite-insights")>();
  return {
    ...actual,
    insights: vi.fn(actual.insights),
    laggedCorrelation: vi.fn(actual.laggedCorrelation),
    dailySeries: vi.fn(actual.dailySeries),
  };
});

import { dailySeries, insights, laggedCorrelation, shiftDay } from "@jeswr/suite-insights";
import { InsightsApp } from "../../src/apps/insights/components/insights-app";
import { Explore, Overview, Sources, Trends } from "../../src/apps/insights/components/views";

const now = new Date("2026-11-11T12:00:00Z");
const session = {
  mode: "demo",
  webId: "https://insights.test/#me",
  storageUrl: "https://insights.test/",
  displayName: "Fictional",
} as PodSession;
const series: Series[] = [
  { id: "health.steps", label: "Steps", unit: "steps", aggregation: "sum" as const, points: [] },
  { id: "health.sleep", label: "Sleep", unit: "min", aggregation: "sum" as const, points: [] },
].map((s, index) => ({
  ...s,
  points: Array.from({ length: 35 }, (_, i) => ({
    at: shiftDay("2026-10-07", i),
    value: index ? 360 + i * 2 : 4000 + i * 100,
  })),
}));
const fixture: Source[] = [
  { id: "health", label: "Health", status: "found", days: 35, series, droppedPoints: 1 },
];
let connection = "online";
let current: InsightsSnapshot & { session: PodSession; timeZone: string; refresh: () => void };
beforeEach(() => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  current = {
    status: "ready",
    sources: fixture,
    refreshing: false,
    now,
    session,
    timeZone: "UTC",
    refresh: vi.fn(),
  };
  connection = "online";
  vi.clearAllMocks();
});
afterEach(cleanup);
const cases = [
  ["Overview", Overview],
  ["Explore", Explore],
  ["Trends", Trends],
  ["Sources", Sources],
] as const;
describe.each(cases)("%s view", (name, View) => {
  const page = () => (
    <InsightsApp>
      <View />
    </InsightsApp>
  );
  it("renders loaded fixture data with accessible shared charts or source details", () => {
    render(page());
    expect(screen.getByRole("heading", { name })).toBeTruthy();
    if (name === "Sources") {
      expect(screen.getByText("Connected", { exact: false })).toBeTruthy();
      expect(screen.getByText("1 invalid record was left out.")).toBeTruthy();
    } else if (name === "Trends") {
      expect(screen.getAllByRole("figure", { name: "Weekday pattern" })).toHaveLength(2);
      expect(screen.getAllByRole("figure", { name: "30-day rolling average" })).toHaveLength(2);
    } else {
      expect(screen.getAllByRole("figure", { name: "Steps and Sleep" }).length).toBeGreaterThan(0);
    }
  });
  it("renders an empty state", () => {
    current.sources = [{ id: "health", label: "Health", status: "empty", days: 0, series: [] }];
    render(page());
    expect(
      screen.getByText(name === "Sources" ? /No records yet/ : "Your patterns start here"),
    ).toBeTruthy();
  });
  it("renders source failures with a retry", () => {
    current.status = "error";
    render(page());
    expect(screen.getByText(/We couldn't open your sources/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(current.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name })).toBeNull();
  });
  it("announces loading", () => {
    current.status = "loading";
    render(page());
    expect(screen.getByLabelText("Finding patterns in your pod")).toBeTruthy();
    expect(screen.queryByRole("heading", { name })).toBeNull();
  });
  it("keeps loaded data available offline", () => {
    connection = "offline";
    render(page());
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Refresh sources" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("heading", { name })).toBeTruthy();
  });
});
it("does not recompute findings, exploration or trends when refreshing changes", () => {
  for (const [View, calculate] of [
    [Overview, insights],
    [Explore, laggedCorrelation],
    [Trends, dailySeries],
  ] as const) {
    const { rerender, unmount } = render(
      <InsightsApp>
        <View />
      </InsightsApp>,
    );
    const calls = vi.mocked(calculate).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    current = { ...current, refreshing: !current.refreshing };
    rerender(
      <InsightsApp>
        <View />
      </InsightsApp>,
    );
    expect(vi.mocked(calculate).mock.calls).toHaveLength(calls);
    current = {
      ...current,
      sources: fixture.map((source) => ({
        ...source,
        series: source.series.map((s) => ({ ...s })),
      })),
    };
    rerender(
      <InsightsApp>
        <View />
      </InsightsApp>,
    );
    expect(vi.mocked(calculate).mock.calls.length).toBeGreaterThan(calls);
    unmount();
  }
});
it("exposes the trend, data table and keyboard chart points in Explore", () => {
  render(
    <InsightsApp>
      <Explore />
    </InsightsApp>,
  );
  const figure = screen.getByRole("figure", { name: "Steps and Sleep" });
  expect(within(figure).getByText(/r = 1.00/)).toBeTruthy();
  const first = figure.querySelector('[tabindex="0"]');
  expect(first).toBeTruthy();
  fireEvent.keyDown(first as Element, { key: "ArrowRight" });
  expect(document.activeElement?.getAttribute("aria-label")).toContain("2026-10-08");
  fireEvent.click(within(figure).getByRole("button", { name: "Show table for Steps and Sleep" }));
  expect(within(figure).getByRole("table")).toBeTruthy();
  expect(screen.getByText(/both trend over time can correlate without being related/)).toBeTruthy();
});
it("shows partial source errors and counts without hiding available data", () => {
  current.sources = [
    ...fixture,
    {
      id: "money",
      label: "Money",
      status: "error",
      days: 0,
      series: [],
      message: "Check your connection.",
    },
  ];
  render(
    <InsightsApp>
      <Sources />
    </InsightsApp>,
  );
  expect(screen.getByText(/Some sources couldn't be read/)).toBeTruthy();
  expect(screen.getByText(/Could not read/)).toBeTruthy();
  expect(screen.getByText("Check your connection.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Health" })).toBeTruthy();
});
