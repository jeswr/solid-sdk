// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { loadDashboard } from "../src/apps/health/lib/data/dashboard";
import { loadMetric } from "../src/apps/health/lib/data/metrics";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
const { ImportView } = await import("../src/apps/health/components/import-view");
const { MeasurementSheet } = await import("../src/apps/health/components/measurement-sheet");
const { HealthProvider } = await import("../src/apps/health/state/health-context");

it("announces Apple Health and GPX preview counts in regions mounted before selection", async () => {
  const root = "https://preview.health.test/";
  const owner = `${root}profile#me`;
  const pod = createDemoPod({ root });
  await createHealthDataStore(pod.fetch, root, owner).initialize();
  const session: PodSession = {
    mode: "demo",
    webId: owner,
    displayName: "Alice",
    storageUrl: root,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(h(HealthProvider, { session, children: h(ImportView) }));
  const apple = view.host.querySelector(
    '[role="status"][aria-label="Apple Health preview status"]',
  );
  const gpx = view.host.querySelector('[role="status"][aria-label="GPX preview status"]');
  expect(apple?.textContent).toBe("");
  expect(gpx?.textContent).toBe("");
  const select = async (id: string, files: File[]) => {
    const input = view.host.querySelector<HTMLInputElement>(id);
    if (!input) throw new Error(`Missing input ${id}`);
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  };
  const fixture = async (name: string) =>
    readFile(new URL(`../e2e/health/fixtures/${name}`, import.meta.url), "utf8");
  await select("#hlt-apple-file", [new File([await fixture("export.xml")], "export.xml")]);
  expect(apple?.isConnected).toBe(true);
  expect(apple?.textContent).toBe(
    "Apple Health preview complete. 50 measurements ready to import.",
  );
  expect(apple?.getAttribute("aria-atomic")).toBe("true");
  await select("#hlt-apple-file", [new File(["<HealthData/>"], "empty.xml")]);
  expect(apple?.textContent).toBe("Apple Health preview complete. 0 measurements ready to import.");
  await select("#hlt-apple-file", [new File(["invalid"], "export.zip")]);
  expect(apple?.textContent).toBe("");
  const route = await fixture("route.gpx");
  await select("#hlt-gpx-files", [new File([route], "first.gpx")]);
  expect(gpx?.isConnected).toBe(true);
  expect(gpx?.textContent).toBe("GPX preview complete. 1 workout ready to import.");
  expect(gpx?.getAttribute("aria-atomic")).toBe("true");
  await select("#hlt-gpx-files", [new File([route], "first.gpx"), new File([route], "second.gpx")]);
  expect(gpx?.textContent).toBe("GPX preview complete. 2 workouts ready to import.");
  await select("#hlt-gpx-files", [new File(["<gpx/>"], "invalid.gpx")]);
  expect(gpx?.textContent).toBe("");
  // Previewing (including empty and invalid files) never writes observations or routes.
  expect(
    pod.snapshot().resources.filter(([url]) => /observations\/[^/]+\.ttl$|route\.gpx$/.test(url)),
  ).toEqual([]);
});

it.each([
  ["Pacific/Auckland", "2026-10-31T20:15:30.123Z", "today", "2026-10-31T20:15:30.123Z"],
  ["Pacific/Auckland", "2026-10-31T20:15:30.123Z", "31 Oct 2026", "2026-10-30T23:00:00.000Z"],
  ["America/New_York", "2026-11-01T06:30:00.000Z", "today", "2026-11-01T06:30:00.000Z"],
  ["America/New_York", "2026-11-01T06:30:00.000Z", "31 Oct 2026", "2026-10-31T16:00:00.000Z"],
])("saves a date-only measurement from the actual form in %s (%s / %s)", async (zone, instant, text, expected) => {
  vi.stubEnv("TZ", zone);
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  try {
    const root = "https://date.health.test/";
    const owner = `${root}profile#me`;
    const pod = createDemoPod({ root });
    const store = createHealthDataStore(pod.fetch, root, owner);
    await store.initialize();
    const session: PodSession = {
      mode: "demo",
      webId: owner,
      displayName: "Alice",
      storageUrl: root,
      fetch: pod.fetch,
      subscribe: pod.subscribe,
      reset: async () => {},
    };
    const onClose = vi.fn();
    const view = await mount(
      h(HealthProvider, { session, children: h(MeasurementSheet, { metric: "weight", onClose }) }),
    );
    const fill = async (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) throw new Error(`Missing input ${selector}`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await fill("#hlt-value", "86.7");
    await fill(".suite-date-control", text);
    const form = document.querySelector('[role="dialog"] form');
    if (!form) throw new Error("Missing measurement form");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(onClose).toHaveBeenCalledOnce();
    });
    const metric = await loadMetric(store, "weight", {
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-03T00:00:00Z"),
    });
    expect(metric.entries).toHaveLength(1);
    expect(metric.latest?.at.toISOString()).toBe(expected);
    expect(
      (await loadDashboard(store, new Date(instant))).find((card) => card.id === "weight")?.latest
        ?.value,
    ).toBe(86.7);
    await view.unmount();
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});
