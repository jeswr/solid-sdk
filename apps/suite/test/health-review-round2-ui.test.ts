// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { Dashboard } from "../src/apps/health/components/dashboard";
import { ImportView } from "../src/apps/health/components/import-view";
import { WorkoutsView, WorkoutView } from "../src/apps/health/components/workouts-view";
import { sampleGpx } from "../src/apps/health/demo/sample";
import { writeSamples } from "../src/apps/health/lib/data/import";
import { loadMeasurements } from "../src/apps/health/lib/data/metrics";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { importGpx } from "../src/apps/health/lib/data/workouts";
import { HealthProvider, useHealth } from "../src/apps/health/state/health-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";

const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: notifications,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/health/components/health-app", () => ({ useMeasurement: () => vi.fn() }));

const ROOT = "https://review.health.test/",
  OWNER = `${ROOT}profile#me`;
let context: ReturnType<typeof useHealth>;
function Probe() {
  context = useHealth();
  return null;
}
async function eventually(assert: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      assert();
    },
    { timeout: 5000 },
  );
}
async function setup(
  fetchFor?: (pod: ReturnType<typeof createDemoPod>) => typeof globalThis.fetch,
) {
  const pod = createDemoPod({ root: ROOT });
  const fetch = fetchFor?.(pod) ?? pod.fetch;
  const store = createHealthDataStore(fetch, ROOT, OWNER);
  await store.initialize();
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, store, session };
}

it("acknowledges every saved pressure observation and shows later server changes on the dashboard", async () => {
  const { store, session } = await setup();
  const view = await mount(
    h(HealthProvider, {
      session,
      children: [h(Probe, { key: "probe" }), h(Dashboard, { key: "dashboard" })],
    }),
  );
  await eventually(() => expect(context.boot.status).toBe("ready"));
  const at = new Date(Date.now() - 1000);
  await act(async () => {
    await context.add("blood-pressure", 120, "mmHg", at, "Pair", 80);
  });
  await eventually(() => {
    expect(
      view.host.querySelector('[data-testid="health-card-blood-pressure"]')?.textContent,
    ).toContain("120 / 80");
    expect(context.pending).toHaveLength(0);
  });
  const range = { start: new Date(at.getTime() - 1000), end: new Date(at.getTime() + 1000) };
  const diastolic = (await loadMeasurements(store, range)).find(
    (entry) => entry.kind === "diastolic",
  );
  if (!diastolic) throw new Error("Missing diastolic reading");
  await act(async () => {
    await writeSamples(store, [{ ...diastolic, value: 90 }], OWNER, () => {});
  });
  await eventually(() =>
    expect(
      view.host.querySelector('[data-testid="health-card-blood-pressure"]')?.textContent,
    ).toContain("120 / 90"),
  );
});

it.each([
  "before",
  "after",
])("retries a GPX index failure %s commit without reselecting files or duplicating completed workouts", async (when) => {
  let fail = true;
  const indexPaths = new Set<string>(),
    routePaths: string[] = [];
  const { pod, session } = await setup((pod) => async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT" && url.endsWith("/route.gpx")) routePaths.push(url);
    if (init?.method === "PUT" && url.endsWith("/index.ttl")) {
      indexPaths.add(url);
      if (fail && indexPaths.size === 2) {
        if (when === "after") {
          await pod.fetch(input, init);
          throw new Error("Index response lost after commit");
        }
        return new Response(null, { status: 500 });
      }
    }
    return pod.fetch(input, init);
  });
  const view = await mount(
    h(HealthProvider, {
      session,
      children: [h(Probe, { key: "probe" }), h(ImportView, { key: "import" })],
    }),
  );
  await eventually(() => expect(context.boot.status).toBe("ready"));
  const input = view.host.querySelector<HTMLInputElement>("#hlt-gpx-files");
  if (!input) throw new Error("Missing file input");
  Object.defineProperty(input, "files", {
    value: [
      new File([sampleGpx(new Date())], "first.gpx"),
      new File([sampleGpx(new Date())], "second.gpx"),
    ],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const button = (label: string) => {
    const element = [...view.host.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    if (!element) throw new Error(`Missing button: ${label}`);
    return element;
  };
  await click(button("Import 2 workouts"));
  await eventually(() =>
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
      "1 of 2 workouts complete. 1 additional route is saved",
    ),
  );
  expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining("route was saved"));
  expect(input.disabled).toBe(true);
  fail = false;
  await click(button("Retry remaining workouts"));
  await eventually(() => expect(view.host.textContent).toContain("2 workouts imported."));
  expect(routePaths).toHaveLength(3);
  expect(routePaths[1]).toBe(routePaths[2]);
  expect(indexPaths.size).toBe(2);
  expect(pod.snapshot().resources.filter(([url]) => url.endsWith("/route.gpx"))).toHaveLength(2);
  expect(view.host.querySelectorAll('ul[aria-label="Imported workouts"] a')).toHaveLength(2);
});

it("keeps workout summaries visible with a route error and allows retrying the route", async () => {
  let fail = false;
  const { store, session } = await setup(
    (pod) => async (input, init) =>
      fail && !init?.method && String(input).endsWith("/route.gpx")
        ? new Response(null, { status: 404 })
        : pod.fetch(input, init),
  );
  const workout = await importGpx(store, "unavailable", sampleGpx(new Date()));
  fail = true;
  const view = await mount(h(HealthProvider, { session, children: h(WorkoutsView) }));
  await eventually(() =>
    expect(view.host.querySelector(".hlt-workout-row")?.textContent).toContain("Not recorded"),
  );
  await view.render(
    h(HealthProvider, {
      session,
      children: h(WorkoutView, { reference: encodeRef(workout.value) }),
    }),
  );
  await eventually(() => {
    expect(view.host.querySelector(".hlt-stats")?.textContent).toContain("Distance");
    expect(view.host.textContent).toContain("Couldn't load the workout route");
  });
  fail = false;
  const retry = [...view.host.querySelectorAll("button")].find(
    (item) => item.textContent === "Retry",
  );
  if (!retry) throw new Error("Missing route retry");
  await click(retry);
  await eventually(() =>
    expect(view.host.querySelector('svg[aria-label^="Workout route"]')).not.toBeNull(),
  );
  expect(view.host.textContent).not.toContain("Couldn't load the workout route");
});
