// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EntryData, JournalStore } from "@jeswr/solid-journal";
import type { PodSession } from "@/lib/session/pod-session";

const seeding = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function sampleEntries(now = new Date()): EntryData[] {
  const stories = [
    [
      "A little room to breathe",
      "Took the long way through Willow Park. The leaves were **golden**, and I left my phone in my pocket.\n\nSmall thing to remember: a quiet walk can change the whole afternoon.",
      "good",
      "outdoors",
    ],
    [
      "Made something with my hands",
      "Spent an hour at the fictional Moss Lane pottery studio. My bowl leans to one side, but it is mine.\n\n- Try again next week\n- Enjoy the practice",
      "great",
      "creativity",
    ],
    [
      "A slower kind of day",
      "Work felt noisy today. I made soup, put on a favourite album and let the evening be simple. Tomorrow is a fresh page.",
      "okay",
      "reflection",
    ],
    [
      "What I want to keep",
      "Coffee by the window, a good book, and time to think.\n\n> Make space for the ordinary things.",
      "good",
      "gratitude",
    ],
  ] as const;
  const entries: EntryData[] = [];
  for (let day = 0; day < 65; day++) {
    if (day % 7 === 5 || day % 7 === 6) continue;
    const [title, text, mood, tag] = stories[day % stories.length] as (typeof stories)[number];
    const created = new Date(now);
    created.setDate(created.getDate() - day);
    created.setHours(18, 30, 0, 0);
    entries.push({
      created,
      modified: created,
      title: `${title}${day ? ` · ${day + 1}` : ""}`,
      text,
      mood,
      tags: [tag],
      location: "Willowbridge",
      weather: day % 2 ? "Cloudy, 12°C" : "Bright and cool",
    });
  }
  const lastYear = new Date(now);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  entries.push({
    created: lastYear,
    title: "A year ago, a new beginning",
    text: "The first page of a new notebook. I hoped to find a little time each day to notice what matters.",
    mood: "great",
    tags: ["reflection"],
  });
  return entries;
}
export function ensureSample(
  session: PodSession,
  store: JournalStore,
  now = new Date(),
): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const existing = seeding.get(session.fetch);
  if (existing) return existing;
  const task = (async () => {
    if ((await store.list()).length) return;
    for (const entry of sampleEntries(now)) await store.save(entry);
  })().catch((error: unknown) => {
    seeding.delete(session.fetch);
    throw error;
  });
  seeding.set(session.fetch, task);
  return task;
}
