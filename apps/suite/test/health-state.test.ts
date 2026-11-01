// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { writeSamples } from "../src/apps/health/lib/data/import";
import { addMeasurement } from "../src/apps/health/lib/data/metrics";
import { loadRecords, saveRecord } from "../src/apps/health/lib/data/records";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { addRecord, emptyHealthDocument } from "../src/apps/health/lib/model";
import {
  HealthProvider,
  useHealth,
  useMetric,
  useRecords,
} from "../src/apps/health/state/health-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: notifications }));
const ROOT = "https://state.health.test/",
  OWNER = `${ROOT}profile#me`;
let context: ReturnType<typeof useHealth>;
let metric: ReturnType<typeof useMetric>;
let records: ReturnType<typeof useRecords>;
function Probe() {
  context = useHealth();
  metric = useMetric("weight", "7d");
  records = useRecords("medications");
  return h("div", null, context.boot.status);
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
function sessionFor(pod: ReturnType<typeof createDemoPod>, fetch = pod.fetch): PodSession {
  return {
    mode: "demo",
    webId: OWNER,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
}
it.each([
  "",
  "users/",
  "users/alice/",
  "users/alice/health/",
  "users/alice/health/observations/",
])("refreshes external record and trend edits after a notification for /%s", async (path) => {
  const root = `${ROOT}users/alice/`;
  const pod = createDemoPod({ root });
  const store = createHealthDataStore(pod.fetch, root, OWNER);
  const at = new Date();
  const original = {
    name: "Original medication",
    dose: "As prescribed",
    note: "",
    date: at.toISOString().slice(0, 10),
    frequency: "none" as const,
    time: "08:00",
    timeZone: "UTC",
  };
  await addMeasurement(store, "weight", "weight", 71, "kg", at);
  await saveRecord(store, OWNER, "medications", "original", original, { create: true }, at);
  let notify!: (url: string) => void;
  const unsubscribe = vi.fn();
  const view = await mount(
    h(HealthProvider, {
      session: {
        mode: "extension",
        webId: OWNER,
        displayName: "Alice",
        storageUrl: root,
        fetch: pod.fetch,
        publicFetch: pod.fetch,
        disconnect: async () => {},
        subscribe(listener) {
          notify = listener;
          return unsubscribe;
        },
      },
      children: h(Probe),
    }),
  );
  await eventually(() => {
    expect(context.boot.status).toBe("ready");
    if (metric.status !== "ready" || records.status !== "ready")
      throw new Error("Health data not ready");
    expect(metric.data.latest?.value).toBe(71);
    expect(records.data[0]?.name).toBe("Original medication");
  });
  if (metric.status !== "ready" || records.status !== "ready")
    throw new Error("Health data not ready");
  const entry = metric.data.latest;
  const record = records.data[0];
  if (!entry || !record?.etag) throw new Error("Missing stored entries");
  // The session intentionally emits no per-resource events, like extension focus sync.
  await writeSamples(store, [{ ...entry, value: 83 }], OWNER, () => {});
  await saveRecord(
    store,
    OWNER,
    "medications",
    record.id,
    { ...original, name: "External edit" },
    { etag: record.etag },
    at,
    record.iri,
  );
  expect(metric.data.latest?.value).toBe(71);
  expect(records.data[0]?.name).toBe("Original medication");
  const revision = context.revision;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await act(async () => {
      for (const unrelated of [
        `${root}drive/`,
        `${ROOT}users/ali/`,
        `${ROOT}users/alice`,
        `${root}health-other/`,
        "https://other.health.test/",
      ])
        notify(unrelated);
      await vi.advanceTimersByTimeAsync(101);
    });
    expect(context.revision).toBe(revision);
    await act(async () => {
      notify(`${ROOT}${path}`);
      notify(`${ROOT}${path}`);
      await vi.advanceTimersByTimeAsync(101);
    });
  } finally {
    vi.useRealTimers();
  }
  await eventually(() => {
    expect(context.revision).toBe(revision + 1);
    if (metric.status !== "ready" || records.status !== "ready")
      throw new Error("Health data not refreshed");
    expect(metric.data.latest?.value).toBe(83);
    expect(records.data[0]?.name).toBe("External edit");
  });
  await view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it("rolls back only a failed queued entry, then reconciles external changes through the subscription", async () => {
  notifications.error.mockClear();
  notifications.success.mockClear();
  const pod = createDemoPod({ root: ROOT });
  const waiting = deferred<Response>();
  let delay = false,
    intercepted = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (
      delay &&
      !intercepted &&
      init?.method === "PUT" &&
      String(input).includes("/observations/")
    ) {
      intercepted = true;
      return waiting.promise;
    }
    return pod.fetch(input, init);
  };
  const store = createHealthDataStore(fetch, ROOT, OWNER);
  await store.initialize();
  await mount(h(HealthProvider, { session: sessionFor(pod, fetch), children: h(Probe) }));
  await eventually(() => {
    expect(context.boot.status).toBe("ready");
    expect(metric.status).toBe("empty");
  });
  delay = true;
  const now = new Date();
  let first: Promise<void>, second: Promise<void>;
  await act(async () => {
    first = context.add("weight", 71, "kg", now, "First");
    // Attach rejection handling immediately; settlement is asserted below.
    void first.catch(() => {});
    second = context.add("weight", 72, "kg", new Date(now.getTime() + 1000), "Second");
  });
  expect(metric.status).toBe("ready");
  if (metric.status === "ready") expect(metric.data.entries).toHaveLength(2);
  await act(async () => {
    waiting.resolve(new Response(null, { status: 500 }));
    await Promise.allSettled([first, second]);
  });
  await eventually(() => {
    expect(context.saving).toBe(0);
    if (metric.status !== "ready") throw new Error("Metric not ready");
    expect(metric.data.entries).toHaveLength(1);
    expect(metric.data.latest?.value).toBe(72);
    expect(context.pending).toHaveLength(0);
  });
  expect(notifications.error).toHaveBeenCalledOnce();
  expect(notifications.success).toHaveBeenCalledOnce();
  await act(async () => {
    await addMeasurement(store, "external", "weight", 73, "kg", new Date(now.getTime() + 2000));
  });
  await eventually(() => {
    if (metric.status !== "ready") throw new Error("Metric not ready");
    expect(metric.data.latest?.value).toBe(73);
  });
});

it("refreshes after a 412, preserves external record edits and writes pressure as one pair", async () => {
  notifications.error.mockClear();
  const pod = createDemoPod({ root: ROOT });
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  await store.initialize();
  await mount(h(HealthProvider, { session: sessionFor(pod), children: h(Probe) }));
  await eventually(() => expect(context.boot.status).toBe("ready"));
  const draft = {
    name: "Original",
    dose: "As recorded",
    date: new Date().toISOString().slice(0, 10),
    frequency: "daily" as const,
    time: "08:00",
    timeZone: "UTC",
    note: "",
  };
  await act(async () => {
    await context.save("medications", draft);
  });
  await eventually(() => {
    if (records.status !== "ready") throw new Error("Records not ready");
    expect(records.data[0]?.etag).toBeTruthy();
  });
  if (records.status !== "ready") throw new Error("Records not ready");
  const stale = records.data[0];
  if (!stale) throw new Error("Missing record");
  const { saveRecord } = await import("../src/apps/health/lib/data/records");
  await saveRecord(
    store,
    OWNER,
    "medications",
    stale.id,
    { ...draft, name: "Changed elsewhere" },
    { etag: stale.etag as string },
    new Date(),
  );
  await act(async () => {
    await expect(
      context.save("medications", { ...draft, name: "My stale edit" }, stale),
    ).rejects.toMatchObject({ status: 412 });
  });
  await eventually(() => {
    if (records.status !== "ready") throw new Error("Records not ready");
    expect(records.data[0]?.name).toBe("Changed elsewhere");
  });
  expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"));
  const at = new Date();
  await act(async () => {
    await context.add("blood-pressure", 120, "mmHg", at, "Paired", 80);
  });
  const range = { start: new Date(at.getTime() - 1000), end: new Date(at.getTime() + 1000) };
  expect((await store.metric("systolic", range))[0]?.value).toBe(120);
  expect((await store.metric("diastolic", range))[0]?.value).toBe(80);
});

it("keeps privacy initialization failures in the blocking error state", async () => {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(`${ROOT}health/`, { method: "PUT" });
  const fetch: typeof globalThis.fetch = (input, init) =>
    init?.method === "PUT" && String(input).endsWith(".acl")
      ? Promise.resolve(new Response(null, { status: 403 }))
      : pod.fetch(input, init);
  await mount(h(HealthProvider, { session: sessionFor(pod, fetch), children: h(Probe) }));
  await eventually(() => expect(context.boot.status).toBe("error"));
  expect(pod.has(`${ROOT}health/observations/`)).toBe(false);
});

it.each([
  "edit",
  "delete",
])("retires a completed optimistic record after a delayed refresh sees an external %s", async (change) => {
  const pod = createDemoPod({ root: ROOT });
  const gate = deferred<void>();
  const started = deferred<void>();
  let delay = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (delay && !init?.method && String(input) === `${ROOT}health/medications/`) {
      started.resolve();
      await gate.promise;
    }
    return pod.fetch(input, init);
  };
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  await store.initialize();
  const iri = `${store.base}medications/legacy.record.ttl#medication`;
  const document = emptyHealthDocument();
  addRecord(document, {
    iri,
    kind: "medications",
    patient: OWNER,
    name: "Legacy medication",
    reference: `${iri}-concept`,
    reminders: [],
  });
  await store.write("medications/legacy.record.ttl", document, { create: true });
  await mount(h(HealthProvider, { session: sessionFor(pod, fetch), children: h(Probe) }));
  await eventually(() => {
    expect(context.boot.status).toBe("ready");
    if (records.status !== "ready") throw new Error("Records not ready");
    expect(records.data[0]?.name).toBe("Legacy medication");
  });
  if (records.status !== "ready" || !records.data[0]) throw new Error("Missing record");
  const original = records.data[0];
  const draft = { ...original, name: "Local edit", date: new Date().toISOString().slice(0, 10) };
  delay = true;
  await act(async () => {
    await context.save("medications", draft, original);
  });
  await started.promise;
  expect(context.recordEdits).toHaveLength(1);
  if (records.status !== "ready") throw new Error("Records not ready");
  expect(records.data.map((record) => record.iri)).toEqual([iri]);
  expect(records.data[0]?.name).toBe("Local edit");
  const saved = (await loadRecords(store, "medications"))[0];
  if (!saved?.etag) throw new Error("Missing saved record");
  if (change === "edit")
    await saveRecord(
      store,
      OWNER,
      "medications",
      saved.id,
      { ...draft, name: "External edit" },
      { etag: saved.etag },
      new Date(),
      saved.iri,
    );
  else
    await pod.fetch(saved.iri.split("#")[0] as string, {
      method: "DELETE",
      headers: { "if-match": saved.etag },
    });
  delay = false;
  await act(async () => {
    gate.resolve();
  });
  await eventually(() => {
    expect(context.recordEdits).toHaveLength(0);
    if (records.status !== "ready" && records.status !== "empty")
      throw new Error("Records not refreshed");
    expect(records.data.map((record) => record.name)).toEqual(
      change === "edit" ? ["External edit"] : [],
    );
  });
});
