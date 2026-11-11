// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";
import { createDiaryStore } from "../lib/data/diary";
import { writeSamples } from "../lib/data/import";
import { saveRecord } from "../lib/data/records";
import { createHealthDataStore } from "../lib/data/store";
import { importGpx } from "../lib/data/workouts";
import type { Measurement } from "../lib/model";

const pending = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureSample(session: PodSession, now = new Date()): Promise<void> {
  const existing = pending.get(session.fetch);
  if (existing) return existing;
  const task = seed(session, now).catch((error: unknown) => {
    pending.delete(session.fetch);
    throw error;
  });
  pending.set(session.fetch, task);
  return task;
}
async function seed(session: PodSession, now: Date) {
  if (session.mode !== "demo") return;
  const store = createHealthDataStore(session.fetch, session.storageUrl, session.webId);
  const exists = await session.fetch(store.base, { method: "HEAD", redirect: "error" });
  if (exists.ok) return;
  if (exists.status !== 404) throw new Error("Couldn't check your Health storage");
  const samples: Measurement[] = [];
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  for (let day = 59; day >= 0; day--) {
    const at = new Date(today.getTime() - day * 86400000);
    const add = (kind: Measurement["kind"], value: number, source = "Apple Health") =>
      samples.push({
        iri: `${store.base}observations/sample#sample-${kind}-${day}`,
        kind,
        value,
        at,
        source,
      });
    add("steps", 6200 + ((day * 137) % 3800));
    add("heartRate", 61 + (day % 7));
    add("sleep", (7 + (day % 5) * 0.2) * 3600);
    if (day % 3 === 0) add("weight", 73.2 + day * 0.025, "Manual entry");
    if (day % 10 === 0) {
      add("systolic", 116 + (day % 9), "Manual entry");
      add("diastolic", 74 + (day % 6), "Manual entry");
    }
  }
  await writeSamples(store, samples, session.webId, () => {});
  const draft = {
    name: "Vitamin D",
    dose: "1 tablet",
    note: "Sample record — replace with your own information.",
    date: today.toISOString().slice(0, 10),
    frequency: "daily" as const,
    time: "08:00",
    timeZone: "UTC",
  };
  await saveRecord(
    store,
    session.webId,
    "medications",
    "sample-vitamin",
    draft,
    { create: true },
    now,
  );
  await saveRecord(
    store,
    session.webId,
    "medications",
    "sample-weekly",
    {
      ...draft,
      name: "Weekly supplement",
      dose: "As recorded on the label",
      frequency: "weekly",
      time: "08:00",
    },
    { create: true },
    now,
  );
  await saveRecord(
    store,
    session.webId,
    "conditions",
    "sample-condition",
    { ...draft, name: "Seasonal hay fever", dose: "", frequency: "none", date: "2024-04-01" },
    { create: true },
    now,
  );
  for (const [id, name, date] of [
    ["influenza", "Influenza", "2025-10-12"],
    ["tetanus", "Tetanus booster", "2023-05-20"],
  ]) {
    await saveRecord(
      store,
      session.webId,
      "immunisations",
      `sample-${id}`,
      { ...draft, name: name as string, date: date as string, dose: "", frequency: "none" },
      { create: true },
      now,
    );
  }
  for (let day = 1; day <= 3; day++)
    await importGpx(
      store,
      `sample-run-${day}`,
      sampleGpx(new Date(today.getTime() - day * 86400000)),
    );
  const diary = createDiaryStore(session.fetch, session.storageUrl, session.webId);
  for (let day = 6; day >= 0; day--) {
    for (const [hour, foods, tags] of [
      [8, ["Porridge", "Banana"], ["breakfast", "oats"]],
      [12, day % 2 ? ["Lentil soup", "Bread"] : ["Rice", "Roast vegetables"], ["lunch"]],
      [18, ["Baked potato", "Salad"], ["dinner"]],
    ] as const) {
      const at = new Date(today.getTime() - day * 86400000 + hour * 3600000);
      if (at > now) continue;
      await diary.save(
        {
          kind: "meal",
          at,
          foods: [...foods],
          ingredients: "",
          tags: [...tags],
          note: "Sample diary entry",
        },
        `sample-meal-${day}-${hour}`,
      );
    }
    if (day === 5 || day === 3 || day === 1)
      await diary.save(
        {
          kind: "symptom",
          at: new Date(today.getTime() - day * 86400000 + 16 * 3600000),
          symptomType: day === 3 ? "headache" : "bloating",
          severity: day === 3 ? 3 : 4,
          durationMinutes: 60,
          note: "Sample diary entry — no cause inferred.",
        },
        `sample-symptom-${day}`,
      );
  }
}
export function sampleGpx(date: Date): string {
  const points = Array.from(
    { length: 14 },
    (_, index) =>
      `<trkpt lat="${51.5 + index * 0.0006}" lon="${-0.12 + Math.sin(index / 3) * 0.002}"><ele>${25 + Math.sin(index / 3) * 8}</ele><time>${new Date(date.getTime() + index * 90000).toISOString()}</time></trkpt>`,
  ).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="Solid Suite" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Riverside run</name><trkseg>${points}</trkseg></trk></gpx>`;
}
