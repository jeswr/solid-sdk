// AUTHORED-BY Codex GPT-6.1-Sol
import { buildMeal, buildSymptom, storeToTurtle } from "@jeswr/solid-health-diary";
import { expect, it } from "vitest";
import {
  createDiaryStore,
  type DiaryReadFailure,
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
  const scores = likelyDiaryTriggers(entries, new Date(at.getTime() + 100 * 3600000));
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
it("reports corrupt legacy records and caches them like month records until invalidated", async () => {
  const pod = await legacyFixture();
  pod.put(pod.url, "not turtle {");
  const failures: DiaryReadFailure[] = [];
  expect(await pod.diary.list(undefined, { failures, cached: true })).toHaveLength(2);
  expect(failures.map((failure) => failure.url)).toEqual([pod.url]);
  pod.put(
    pod.url,
    await storeToTurtle(buildMeal(pod.url, { startTime: at, items: [{ name: "Recovered" }] })),
  );
  expect(await pod.diary.list(undefined, { cached: true })).toHaveLength(2);
  pod.diary.invalidate();
  expect(await pod.diary.list(undefined, { cached: true })).toHaveLength(3);
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
