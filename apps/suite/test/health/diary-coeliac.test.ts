// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.2-Astra
import { buildMeal, buildSymptom, storeToTurtle } from "@jeswr/solid-health-diary";
import { NS } from "@jeswr/suite-vocab";
import { expect, it, vi } from "vitest";
import {
  createDiaryStore,
  type DiaryEntry,
  type DiaryReadFailure,
  diaryExposures,
  likelyDiaryTriggers,
  MANUAL_EXPOSURE_NOTE,
} from "../../src/apps/health/lib/data/diary";
import { createDiaryPreferencesStore } from "../../src/apps/health/lib/data/diary-preferences";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { BASE, OWNER, podFixture } from "./pod-fixture";

const storage = new URL("../", BASE).href;
const at = new Date("2026-11-01T12:00:00Z");
async function legacyFixture() {
  const pod = podFixture();
  for (const path of [
    "diary/",
    "diary/meals/",
    "diary/meals/2026/",
    "diary/meals/2026/11/",
    "diary/symptoms/",
    "diary/symptoms/2026/",
    "diary/symptoms/2026/11/",
    "diary/2026-11/",
  ]) {
    pod.resources.set(new URL(path, BASE).href, {
      body: "",
      etag: '"1"',
      type: "text/turtle",
      container: true,
    });
  }
  const url = `${BASE}diary/meals/2026/11/legacy.ttl`,
    symptomUrl = `${BASE}diary/symptoms/2026/11/legacy.ttl`,
    modern = `${BASE}diary/2026-11/modern.ttl`;
  pod.put(
    url,
    await storeToTurtle(
      buildMeal(url, {
        startTime: at,
        items: [{ name: "Bread" }],
        exposures: [{ trigger: "gluten", exposureLevel: "present" }],
      }),
    ),
  );
  pod.put(
    symptomUrl,
    await storeToTurtle(
      buildSymptom(symptomUrl, {
        onset: new Date(at.getTime() + 4 * 3600000),
        symptomType: "bloating",
        severity: 4,
      }),
    ),
  );
  pod.put(
    modern,
    await storeToTurtle(buildMeal(modern, { startTime: at, items: [{ name: "Rice" }] })),
  );
  return { ...pod, diary: createDiaryStore(pod.fetch, storage, OWNER), url, symptomUrl, modern };
}
it("reads both diary layouts with model parsers, filters ranges, retains exposures and refuses legacy writes", async () => {
  const pod = await legacyFixture();
  const entries = await pod.diary.list({ start: at, end: new Date(at.getTime() + 5 * 3600000) });
  expect(entries).toHaveLength(3);
  const legacy = entries.find((entry) => entry.url === pod.url);
  expect(legacy).toMatchObject({
    kind: "meal",
    foods: ["Bread"],
    readOnly: true,
    exposures: [{ trigger: "gluten", exposureLevel: "present" }],
  });
  expect(entries.find((entry) => entry.url === pod.symptomUrl)).toMatchObject({
    kind: "symptom",
    severity: 4,
    readOnly: true,
  });
  expect(entries.find((entry) => entry.url === pod.modern)?.readOnly).toBe(false);
  expect(
    await pod.diary.list({
      start: new Date(at.getTime() + 1),
      end: new Date(at.getTime() + 4 * 3600000),
    }),
  ).toEqual([]);
  if (!legacy) throw new Error("Missing legacy entry");
  await expect(pod.diary.save(legacy, "edit", legacy)).rejects.toThrow("read-only");
  await expect(pod.diary.remove(legacy)).rejects.toThrow("read-only");
  await expect(pod.diary.restore(legacy)).rejects.toThrow("Invalid diary entry URL");
  expect(pod.calls.every((call) => call.method === "GET")).toBe(true);
  const { suspicions: scores } = likelyDiaryTriggers(
    entries,
    new Date(at.getTime() + 100 * 3600000),
  );
  expect(scores[0]).toMatchObject({
    trigger: "gluten",
    exposureCount: 1,
    followedCount: 1,
    attributedSymptomCount: 1,
  });
  expect(scores[0]?.evidence[0]?.symptoms[0]?.lagHours).toBe(4);
});
it("reads direct legacy documents and reports failures per document and container", async () => {
  const pod = await legacyFixture();
  const direct = `${BASE}diary/meals/direct.ttl`;
  pod.put(
    direct,
    await storeToTurtle(buildMeal(direct, { startTime: at, items: [{ name: "Soup" }] })),
  );
  pod.faults.set(`GET ${pod.url}`, () => new Response(null, { status: 503 }));
  pod.faults.set(`GET ${BASE}diary/symptoms/2026/11/`, () => new Response(null, { status: 403 }));
  const failures: DiaryReadFailure[] = [];
  const entries = await pod.diary.list(undefined, { failures });
  expect(entries.map((entry) => entry.url).sort()).toEqual([direct, pod.modern].sort());
  expect(failures.map((failure) => failure.url).sort()).toEqual(
    [pod.url, `${BASE}diary/symptoms/2026/11/`].sort(),
  );
  expect(pod.calls.every((call) => call.method === "GET")).toBe(true);
});
it("reports corrupt legacy records without caching failed document reads", async () => {
  const pod = await legacyFixture();
  pod.put(pod.url, "not turtle {");
  const failures: DiaryReadFailure[] = [];
  expect(await pod.diary.list(undefined, { failures, cached: true })).toHaveLength(2);
  expect(failures.map((failure) => failure.url)).toEqual([pod.url]);
  pod.put(
    pod.url,
    await storeToTurtle(buildMeal(pod.url, { startTime: at, items: [{ name: "Recovered" }] })),
  );
  expect(await pod.diary.list(undefined, { cached: true })).toHaveLength(3);
  expect(pod.calls.filter((call) => call.url === pod.url)).toHaveLength(2);
});
it("refreshes legacy membership on focus, reuses documents and drops removed URLs", async () => {
  const pod = await legacyFixture();
  const list = () => pod.diary.list(undefined, { cached: true });
  pod.resources.delete(pod.modern);
  await list();
  const added = `${BASE}diary/meals/2026/11/new.ttl`;
  const body = await storeToTurtle(
    buildMeal(added, { startTime: at, items: [{ name: "New meal" }] }),
  );
  pod.put(added, body);
  pod.diary.invalidate(storage);
  pod.calls.length = 0;
  expect((await list()).map((entry) => entry.url)).toContain(added);
  expect(pod.calls.filter((call) => !call.url.endsWith("/"))).toMatchObject([{ url: added }]);
  pod.resources.delete(added);
  pod.diary.invalidate(storage);
  expect((await list()).map((entry) => entry.url)).not.toContain(added);
  pod.put(added, body);
  pod.diary.invalidate(storage);
  pod.calls.length = 0;
  expect((await list()).map((entry) => entry.url)).toContain(added);
  expect(pod.calls.filter((call) => call.url === added)).toHaveLength(1);
});
it.each([
  "document",
  "month folder",
])("retries a failed legacy %s on the next cached listing", async (target) => {
  const pod = await legacyFixture();
  const url = target === "document" ? pod.url : new URL(".", pod.url).href;
  pod.faults.set(`GET ${url}`, () => new Response(null, { status: 503 }));
  const failures: DiaryReadFailure[] = [];
  expect(await pod.diary.list(undefined, { cached: true, failures })).toHaveLength(2);
  expect(failures.map((failure) => failure.url)).toEqual([url]);
  pod.faults.delete(`GET ${url}`);
  pod.calls.length = 0;
  const retried: DiaryReadFailure[] = [];
  const entries = await pod.diary.list(undefined, { cached: true, failures: retried });
  expect(entries.map((entry) => entry.url).sort()).toEqual(
    [pod.modern, pod.url, pod.symptomUrl].sort(),
  );
  expect(retried).toEqual([]);
  expect(pod.calls.map((call) => call.url)).toEqual(
    target === "document" ? [pod.url] : [url, pod.url],
  );
});
it("prioritizes a save's reads ahead of queued legacy listing reads within six slots", async () => {
  const pod = createDemoPod({ root: storage });
  const draft = { kind: "meal" as const, at, foods: ["Rice"], ingredients: "", tags: [], note: "" };
  const existing = await createDiaryStore(pod.fetch, storage, OWNER).save(draft, "priority");
  const folder = `${BASE}diary/meals/`;
  await pod.fetch(folder, { method: "PUT", headers: { "content-type": "text/turtle" }, body: "" });
  for (let i = 0; i < 18; i++) {
    const url = `${folder}old-${i}.ttl`;
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await storeToTurtle(buildMeal(url, { startTime: at, items: [{ name: "Old" }] })),
    });
  }
  let blocked = true,
    active = 0,
    maximum = 0,
    wrote = false;
  const waiting: (() => void)[] = [],
    reads: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT" && url === existing.url) wrote = true;
    if (!init?.method && (url === existing.url || url.startsWith(folder)) && url.endsWith(".ttl")) {
      reads.push(url);
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (blocked && url.startsWith(folder))
          await new Promise<void>((resolve) => waiting.push(resolve));
        return await pod.fetch(input, init);
      } finally {
        active--;
      }
    }
    return pod.fetch(input, init);
  };
  const diary = createDiaryStore(fetch, storage, OWNER);
  const listing = diary.list();
  await vi.waitFor(() => expect(waiting).toHaveLength(6));
  reads.length = 0;
  const saving = diary.save({ ...draft, note: "Priority edit" }, "priority", existing);
  try {
    waiting.shift()?.();
    await vi.waitFor(() => expect(wrote).toBe(true));
    waiting.shift()?.();
    await vi.waitFor(() => expect(reads.filter((url) => url === existing.url)).toHaveLength(2));
    expect(reads[0]).toBe(existing.url);
    expect(maximum).toBe(6);
    expect((await saving).note).toBe("Priority edit");
  } finally {
    blocked = false;
    for (const release of waiting) release();
    await Promise.all([listing, saving]);
  }
});
it("prunes UTC legacy history outside the widened range and bounds every listing to six GETs", async () => {
  const pod = await legacyFixture();
  pod.resources.delete(pod.url);
  pod.resources.delete(pod.symptomUrl);
  for (const kind of ["meals", "symptoms"]) {
    for (const year of [2023, 2024, 2025, 2026]) {
      const parent = `${BASE}diary/${kind}/${year}/`;
      pod.resources.set(parent, { body: "", etag: '"1"', type: "text/turtle", container: true });
      for (const month of ["01", "02", "03", "04", "05", "06"]) {
        const folder = `${parent}${month}/`;
        pod.resources.set(folder, { body: "", etag: '"1"', type: "text/turtle", container: true });
        for (let i = 0; i < 8; i++) pod.put(`${folder}old-${i}.ttl`, "");
      }
    }
  }
  // Enough modern documents to exercise the same pool as the legacy walk.
  for (let i = 0; i < 12; i++) pod.put(`${BASE}diary/2026-11/empty-${i}.ttl`, "");
  let active = 0,
    maximum = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await pod.fetch(input, init);
    } finally {
      active--;
    }
  };
  const diary = createDiaryStore(fetch, storage, OWNER);
  const range = { start: new Date("2026-11-09T00:00:00Z"), end: new Date("2026-11-16T00:00:00Z") };
  expect(await diary.list(range, { cached: true })).toEqual([]);
  expect(pod.calls).toHaveLength(21); // root, modern month + 13 docs, two legacy root/year/month paths
  expect(maximum).toBe(6);
  expect(pod.calls.every(({ url }) => !/\/(202[345]|0[1-6])\//.test(url))).toBe(true);
  maximum = 0;
  await diary.list();
  expect(maximum).toBe(6);
});
it("keeps legacy documents across suite saves/removes and invalidates only the notified legacy path or Retry", async () => {
  const pod = createDemoPod({ root: storage });
  const folder = `${storage}health/diary/meals/2026/11/`,
    url = `${folder}legacy.ttl`;
  for (const path of [
    "health/diary/",
    "health/diary/meals/",
    "health/diary/meals/2026/",
    "health/diary/meals/2026/11/",
  ]) {
    await pod.fetch(`${storage}${path}`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
  }
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await storeToTurtle(buildMeal(url, { startTime: at, items: [{ name: "Bread" }] })),
  });
  const gets: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (!init?.method || init.method === "GET") gets.push(String(input));
    return pod.fetch(input, init);
  };
  const diary = createDiaryStore(fetch, storage, OWNER);
  const list = () => diary.list(undefined, { cached: true });
  await list();
  expect(gets.filter((value) => value === url)).toHaveLength(1);
  const saved = await diary.save(
    { kind: "meal", at, foods: ["Rice"], ingredients: "", tags: [], note: "" },
    "modern",
  );
  diary.invalidate(diary.base); // the provider's refresh after a suite mutation/notification
  await list();
  await diary.remove(saved);
  await list();
  expect(gets.filter((value) => value === url)).toHaveLength(1);
  diary.invalidate(`${diary.base}symptoms/`);
  await list();
  expect(gets.filter((value) => value === url)).toHaveLength(1);
  diary.invalidate(folder);
  await list();
  expect(gets.filter((value) => value === url)).toHaveLength(2);
  diary.invalidate();
  await list();
  expect(gets.filter((value) => value === url)).toHaveLength(3);
});
it("widens legacy UTC buckets across month and year boundaries", async () => {
  const pod = await legacyFixture();
  const url = `${BASE}diary/meals/2025/12/boundary.ttl`;
  for (const folder of [`${BASE}diary/meals/2025/`, `${BASE}diary/meals/2025/12/`]) {
    pod.resources.set(folder, { body: "", etag: '"1"', type: "text/turtle", container: true });
  }
  pod.put(
    url,
    await storeToTurtle(
      buildMeal(url, {
        startTime: new Date("2026-01-01T00:30:00Z"),
        items: [{ name: "Midnight snack" }],
      }),
    ),
  );
  expect(
    await pod.diary.list({
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-01-02T00:00:00Z"),
    }),
  ).toMatchObject([{ url }]);
});
it("defaults preferences off with gluten, persists them privately and isolates storage roots", async () => {
  const pod = createDemoPod({ root: storage });
  const preferences = createDiaryPreferencesStore(pod.fetch, storage, OWNER);
  expect(await preferences.read()).toEqual({ enabled: false, trigger: "gluten" });
  await preferences.save({ enabled: true, trigger: "lactose" });
  expect(await createDiaryPreferencesStore(pod.fetch, storage, OWNER).read()).toEqual({
    enabled: true,
    trigger: "lactose",
  });
  const other = createDemoPod({ root: "https://other-health.test/" });
  expect(
    await createDiaryPreferencesStore(
      other.fetch,
      "https://other-health.test/",
      "https://other-health.test/profile#me",
    ).read(),
  ).toEqual({ enabled: false, trigger: "gluten" });
  await preferences.save({ enabled: false, trigger: "lactose" });
  expect((await preferences.read()).enabled).toBe(false);
});
it("never overwrites unreadable preferences", async () => {
  const pod = podFixture();
  const preferences = createDiaryPreferencesStore(pod.fetch, storage, OWNER);
  pod.faults.set(`GET ${preferences.url}`, () => new Response(null, { status: 403 }));
  await expect(preferences.read()).rejects.toThrow();
  await expect(preferences.save({ enabled: true, trigger: "gluten" })).rejects.toThrow();
  expect(pod.calls.some((call) => call.method === "PUT")).toBe(false);
});
it("rejects a stored trigger outside the diary vocabulary", async () => {
  const pod = podFixture();
  const preferences = createDiaryPreferencesStore(pod.fetch, storage, OWNER);
  pod.put(
    preferences.url,
    JSON.stringify({
      "@id": `${preferences.url}#it`,
      [`${NS.HEALTH}diaryTriggerClass`]: "unknown",
    }),
    "application/ld+json",
  );
  await expect(preferences.read()).rejects.toThrow("Invalid diary trigger class");
});
it("rejects invalid preference values before contacting the pod", async () => {
  const pod = podFixture();
  const preferences = createDiaryPreferencesStore(pod.fetch, storage, OWNER);
  // @ts-expect-error Exercise runtime validation for a non-boolean setting.
  await expect(preferences.save({ enabled: "false", trigger: "gluten" })).rejects.toThrow(
    "Invalid diary preferences",
  );
  // @ts-expect-error Exercise runtime validation for an unknown trigger.
  await expect(preferences.save({ enabled: true, trigger: "unknown" })).rejects.toThrow(
    "Invalid diary preferences",
  );
  expect(pod.calls).toEqual([]);
});
it("refuses to replace existing preferences when the pod omits their ETag", async () => {
  const pod = podFixture();
  const preferences = createDiaryPreferencesStore(pod.fetch, storage, OWNER);
  pod.faults.set(
    `GET ${preferences.url}`,
    () => new Response("", { headers: { "content-type": "text/turtle" } }),
  );
  await expect(preferences.save({ enabled: true, trigger: "gluten" })).rejects.toThrow(
    "Refresh diary settings before saving",
  );
  expect(pod.calls).toMatchObject([{ method: "GET", url: preferences.url }]);
});
it("preserves stronger product exposures and gives manual observations precedence on ties", () => {
  const id = `${BASE}diary/2026-11/meal.ttl#item-0`;
  const items = [{ id, name: "Bread", traceAllergen: ["en:gluten"] }];
  const manual = { trigger: "gluten", exposureLevel: "trace", note: MANUAL_EXPOSURE_NOTE } as const;
  expect(diaryExposures(items, [{ ...manual, exposureLevel: "possible-undeclared" }])).toEqual([
    { trigger: "gluten", exposureLevel: "trace", derivedFrom: [id] },
  ]);
  expect(diaryExposures(items, [manual])).toEqual([manual]);
});
it("round-trips suspected and present exposures, preserves them on edit and removes them explicitly", async () => {
  const pod = createDemoPod({ root: storage });
  const diary = createDiaryStore(pod.fetch, storage, OWNER);
  const draft = {
    kind: "meal" as const,
    at,
    foods: ["Bread"],
    ingredients: "",
    tags: [],
    note: "",
    exposures: [
      {
        trigger: "gluten" as const,
        exposureLevel: "possible-undeclared" as const,
        note: MANUAL_EXPOSURE_NOTE,
      },
    ],
  };
  const saved = await diary.save(draft, "manual");
  expect(saved.kind === "meal" && saved.exposures).toMatchObject(draft.exposures);
  const updated = await diary.save({ ...saved, note: "Suspected" }, "manual", saved);
  expect(updated.kind === "meal" && updated.exposures).toMatchObject(draft.exposures);
  const present = await diary.save(
    {
      ...draft,
      exposures: [{ trigger: "gluten", note: MANUAL_EXPOSURE_NOTE, exposureLevel: "present" }],
    },
    "manual",
    updated,
  );
  expect(present.kind === "meal" && present.exposures?.[0]?.exposureLevel).toBe("present");
  const removed = await diary.save({ ...draft, exposures: [] }, "manual", present);
  expect(removed.kind === "meal" && (removed.exposures ?? [])).toEqual([]);
});

it("keeps the pre-diagnosis gluten warning and emergency rail with the likely triggers", async () => {
  const pod = await legacyFixture();
  const entries = await pod.diary.list();
  const soon = new Date(at.getTime() + 100 * 3600000);
  const rails = likelyDiaryTriggers(entries, soon).safetyRails.map((rail) => rail.kind);
  expect(rails).toContain("pre-diagnosis-gluten");
  expect(likelyDiaryTriggers(entries, soon, { coeliacDiagnosed: true }).safetyRails).toEqual([]);
  const emergency: DiaryEntry = {
    kind: "symptom",
    readOnly: false,
    url: `${BASE}diary/2026-11/e.ttl`,
    etag: null,
    at: new Date(at.getTime() + 3600000),
    symptomType: "anaphylaxis",
    severity: null,
    durationMinutes: null,
    note: "",
  };
  const withEmergency = likelyDiaryTriggers([...entries, emergency], soon);
  expect(withEmergency.safetyRails[0]?.kind).toBe("emergency-anaphylaxis");
});
it("does not count exposures whose follow-up window is still open as not followed", async () => {
  const pod = await legacyFixture();
  const entries = await pod.diary.list();
  const recent: DiaryEntry = {
    kind: "meal",
    readOnly: false,
    url: `${BASE}diary/2026-11/recent.ttl`,
    etag: null,
    at: new Date(at.getTime() + 99 * 3600000),
    foods: ["Bread"],
    ingredients: "",
    tags: [],
    note: "",
    exposures: [{ trigger: "gluten", exposureLevel: "present" }],
  };
  const now = new Date(at.getTime() + 100 * 3600000);
  const gluten = likelyDiaryTriggers([...entries, recent], now).suspicions.find(
    (score) => score.trigger === "gluten",
  );
  expect(gluten).toMatchObject({ exposureCount: 1, followedCount: 1 });
});
it("derives missing exposures from item data and ignores future meals", () => {
  const meal: DiaryEntry = {
    kind: "meal",
    url: `${BASE}diary/2026-11/plain.ttl`,
    etag: null,
    at,
    foods: ["Milk"],
    ingredients: "",
    tags: [],
    note: "",
  };
  const now = new Date(at.getTime() + 100 * 3600000);
  const result = likelyDiaryTriggers(
    [
      meal,
      {
        ...meal,
        url: `${BASE}diary/2026-11/scanned.ttl`,
        items: [{ name: "Milk", declaredAllergen: ["en:milk"] }],
      },
      {
        ...meal,
        url: `${BASE}diary/2026-11/future.ttl`,
        at: new Date(now.getTime() + 1),
        foods: ["Bread"],
        exposures: [{ trigger: "gluten", exposureLevel: "present" }],
      },
    ],
    now,
  );
  expect(result.suspicions).toMatchObject([{ trigger: "lactose", exposureCount: 1 }]);
  expect(result.safetyRails).toEqual([]);
});
