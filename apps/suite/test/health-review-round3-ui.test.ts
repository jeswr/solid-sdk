// AUTHORED-BY Codex GPT-6
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { loadMetric, type MetricId } from "../src/apps/health/lib/data/metrics";
import { loadRecords, saveRecord } from "../src/apps/health/lib/data/records";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));
// Install the DOM before loading Radix's browser-dependent portal hooks.
const { MeasurementSheet } = await import("../src/apps/health/components/measurement-sheet");
const { RecordsView } = await import("../src/apps/health/components/records-view");
const { HealthProvider, useHealth } = await import("../src/apps/health/state/health-context");
const ROOT = "https://form.health.test/";
const OWNER = `${ROOT}profile#me`;
let context: ReturnType<typeof useHealth>;
function Probe() {
  context = useHealth();
  return null;
}
function Entry({ metric }: { metric: MetricId }) {
  const [open, setOpen] = useState(true);
  return h(
    "div",
    null,
    h("button", { onClick: () => setOpen(true) }, "New draft"),
    h(MeasurementSheet, { metric: open ? metric : null, onClose: () => setOpen(false) }),
  );
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", window.matchMedia);
});
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
  return { store, session };
}
async function fill(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(id);
  if (!input) throw new Error(`Missing input ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  const form = document.querySelector('[role="dialog"] form');
  if (!form) throw new Error("Missing form");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it.each([
  "steps",
  "blood-pressure",
] as const)("keeps a %s draft ID across lost-response retries and changes it for the next draft", async (metric) => {
  let lose = true;
  const { store, session } = await setup((pod) => async (input, init) => {
    const response = await pod.fetch(input, init);
    if (lose && init?.method === "PUT" && /observations\/\d{4}-\d{2}\.ttl$/.test(String(input))) {
      lose = false;
      throw new Error("Response lost after commit");
    }
    return response;
  });
  const view = await mount(
    h(HealthProvider, {
      session,
      children: [h(Probe, { key: "probe" }), h(Entry, { key: "entry", metric })],
    }),
  );
  await eventually(() => expect(context.boot.status).toBe("ready"));
  await fill("#hlt-value", metric === "steps" ? "1000" : "120");
  if (metric === "blood-pressure") await fill("#hlt-second", "80");
  await submit();
  await eventually(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Couldn't save this measurement",
    ),
  );
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const now = new Date();
  const range = {
    start: new Date(now.getTime() - 86400000),
    end: new Date(now.getTime() + 86400000),
  };
  const kind = metric === "steps" ? "steps" : "systolic";
  const saved = await loadMetric(store, kind, range);
  expect(saved.entries).toHaveLength(1);
  expect(saved.buckets[0]?.value).toBe(metric === "steps" ? 1000 : 120);
  if (metric === "blood-pressure")
    expect((await loadMetric(store, "diastolic", range)).entries).toHaveLength(1);
  const newDraft = view.host.querySelector("button");
  if (!newDraft) throw new Error("Missing new draft button");
  await click(newDraft);
  await fill("#hlt-value", metric === "steps" ? "1000" : "120");
  if (metric === "blood-pressure") await fill("#hlt-second", "80");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const again = await loadMetric(store, kind, range);
  expect(again.entries).toHaveLength(2);
  expect(new Set(again.entries.map((entry) => entry.iri)).size).toBe(2);
});

it("labels and preserves the actual timezone when editing an Auckland medication", async () => {
  const { store, session } = await setup();
  await saveRecord(
    store,
    OWNER,
    "medications",
    "auckland",
    {
      name: "Auckland prescription",
      dose: "As prescribed",
      note: "",
      frequency: "daily",
      date: "2026-11-01",
      time: "08:00",
      timeZone: "Pacific/Auckland",
    },
    { create: true },
    new Date("2026-11-01T12:00:00Z"),
  );
  const view = await mount(
    h(HealthProvider, { session, children: h(RecordsView, { kind: "medications" }) }),
  );
  let edit: HTMLButtonElement | undefined;
  await eventually(() => {
    edit = [...view.host.querySelectorAll("button")].find(
      (item) => item.textContent === "Edit Auckland prescription",
    );
    expect(edit).toBeDefined();
  });
  await click(edit as HTMLButtonElement);
  expect(document.querySelector('label[for="hlt-time"]')?.textContent).toBe(
    "Reminder time (Pacific/Auckland)",
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Times use Pacific/Auckland.",
  );
  await fill("#hlt-time", "09:00");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const record = (await loadRecords(store, "medications"))[0];
  expect(record).toMatchObject({ time: "09:00", timeZone: "Pacific/Auckland" });
  expect(record?.reminders.length).toBeGreaterThan(0);
  for (const at of record?.reminders ?? [])
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Pacific/Auckland",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(at),
    ).toBe("09:00");
});

it("retries a new record with its original ID after the create response is lost", async () => {
  let lose = true;
  const { store, session } = await setup((pod) => async (input, init) => {
    const response = await pod.fetch(input, init);
    if (lose && init?.method === "PUT" && /conditions\/[^/]+\.ttl$/.test(String(input))) {
      lose = false;
      throw new Error("Response lost after commit");
    }
    return response;
  });
  const view = await mount(
    h(HealthProvider, { session, children: h(RecordsView, { kind: "conditions" }) }),
  );
  const add = [...view.host.querySelectorAll("button")].find(
    (item) => item.textContent === "Add condition",
  );
  if (!add) throw new Error("Missing add condition");
  await click(add);
  await fill("#hlt-record-name", "Seasonal allergy");
  await submit();
  await eventually(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Couldn't save this record",
    ),
  );
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect((await loadRecords(store, "conditions")).map((record) => record.name)).toEqual([
    "Seasonal allergy",
  ]);
});
