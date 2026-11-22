// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { BookmarkRepository } from "@jeswr/solid-bookmark/pod";

type SampleSession = { mode: string; storageUrl: string; fetch: typeof fetch };
const pending = new WeakMap<typeof fetch, Map<string, Promise<void>>>();
/** A dedicated marker distinguishes this demo from Home's existing W3C bookmark fixture. */
export function ensureSample(
  options: SampleSession,
  repository: BookmarkRepository,
  now = new Date(),
): Promise<void> {
  if (options.mode !== "demo") return Promise.resolve();
  let sessions = pending.get(options.fetch);
  if (!sessions) {
    sessions = new Map();
    pending.set(options.fetch, sessions);
  }
  const previous = sessions.get(options.storageUrl);
  if (previous) return previous;
  const task = seed(options, repository, now).catch((error: unknown) => {
    sessions.delete(options.storageUrl);
    throw error;
  });
  sessions.set(options.storageUrl, task);
  return task;
}
async function seed(
  options: SampleSession,
  repository: BookmarkRepository,
  now: Date,
): Promise<void> {
  const marker = new URL("bookmarks/.suite-demo.json", options.storageUrl);
  const response = await options.fetch(marker, {
    method: "HEAD",
    redirect: "error",
  });
  if (response.ok) return;
  if (response.status !== 404) throw new Error("Couldn't check sample bookmarks");
  const existing = new Set((await repository.list()).items.map((record) => record.data.url));
  const samples = [
    {
      url: "https://example.org/journal/quiet-gardens",
      title: "A small guide to quieter gardens",
      description: "Make room for wildlife, even on a balcony.",
      tags: ["gardening", "weekend"],
      notes: "Try the container planting idea next spring.",
    },
    {
      url: "https://example.net/design/everyday-objects",
      title: "The stories behind everyday objects",
      description: "A fictional design journal from the North Quay studio.",
      tags: ["design", "reading"],
    },
    {
      url: "https://example.org/kitchen/bread",
      title: "A slow Sunday loaf",
      description: "A relaxed recipe for a rainy afternoon.",
      tags: ["cooking", "weekend"],
      archived: true,
    },
    {
      url: "https://example.com/routes/coastal-path",
      title: "Along the coastal path",
      description: "Ideas for a walking weekend in the fictional town of Bracken Bay.",
      tags: ["outdoors", "weekend"],
    },
    {
      url: "https://example.net/essays/digital-gardens",
      title: "Keeping a digital garden",
      description: "Notes on collecting ideas without losing them.",
      tags: ["design", "reading"],
      archived: true,
    },
    {
      url: "https://example.com/learn/night-sky",
      title: "Getting to know the night sky",
      description: "A beginner's guide from the fictional Mere Observatory.",
      tags: ["learning", "outdoors"],
    },
  ];
  for (const [index, sample] of samples.entries())
    if (!existing.has(sample.url))
      await repository.create({ ...sample, created: new Date(now.getTime() - index * 86_400_000) });
  const saved = await options.fetch(marker, {
    method: "PUT",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "if-none-match": "*",
    },
    body: JSON.stringify({ version: 1 }),
  });
  if (!saved.ok && saved.status !== 412) throw new Error("Couldn't finish sample bookmarks");
}
