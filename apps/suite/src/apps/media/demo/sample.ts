// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { MediaEntry, MediaRepository } from "@jeswr/solid-media-log";

/** Fictional works and creators, written through the same repository as manual items. */
export function sampleMedia(year: number): MediaEntry[] {
  return [
    {
      title: "The Last Lighthouse",
      kind: "film",
      creator: "Rowan Vale",
      year: 2025,
      status: "finished",
      finished: `${year}-01-18`,
      rating: 4.5,
      review: "A quiet, beautiful story about finding your way home.",
      source: "Demo",
    },
    {
      title: "Paper Moons",
      kind: "film",
      creator: "Ellis Fen",
      year: 2024,
      status: "finished",
      finished: `${year}-03-09`,
      rating: 4,
      source: "Demo",
      repeatCount: 1,
    },
    {
      title: "After the Rain",
      kind: "film",
      creator: "Mira Ash",
      year: 2026,
      status: "want",
      source: "Demo",
    },
    {
      title: "The Orchard Letters",
      kind: "book",
      creator: "Aster Reed",
      year: 2023,
      status: "in-progress",
      progress: 147,
      progressUnit: "page",
      source: "Demo",
    },
    {
      title: "A Map of Small Things",
      kind: "book",
      creator: "Finley Moss",
      year: 2024,
      status: "finished",
      finished: `${year}-02-24`,
      rating: 5,
      review: "The kind of book you want to lend to everyone.",
      source: "Demo",
    },
    {
      title: "Signal from Elsewhere",
      kind: "tv",
      creator: "North Window Studio",
      year: 2025,
      status: "in-progress",
      progress: 4,
      progressUnit: "episode",
      source: "Demo",
    },
    {
      title: "Harbour Days",
      kind: "tv",
      year: 2025,
      status: "finished",
      finished: `${year}-04-06`,
      rating: 3.5,
      source: "Demo",
    },
    {
      title: "Mosslight Valley",
      kind: "game",
      creator: "Pebble Lantern",
      year: 2025,
      status: "in-progress",
      rating: 4.5,
      source: "Demo",
    },
    {
      title: "The Clockwork Coast",
      kind: "game",
      creator: "Copper Kite",
      year: 2024,
      status: "finished",
      finished: `${year}-05-19`,
      rating: 4,
      source: "Demo",
    },
    {
      title: "Beyond the Blue Door",
      kind: "book",
      creator: "Sage Wren",
      year: 2022,
      status: "abandoned",
      progress: 68,
      progressUnit: "page",
      source: "Demo",
    },
  ];
}
const seeds = new WeakMap<MediaRepository, Promise<void>>();
export function ensureMediaSample(
  repository: MediaRepository,
  mode: string,
  now = new Date(),
): Promise<void> {
  if (mode !== "demo") return Promise.resolve();
  const previous = seeds.get(repository);
  if (previous) return previous;
  const task = (async () => {
    const existing = await repository.load();
    const known = new Set(
      existing.records.map((record) => (record.data.source === "Demo" ? record.data.title : "")),
    );
    for (const entry of sampleMedia(now.getUTCFullYear()))
      if (!known.has(entry.title)) await repository.save(entry);
  })().catch((error: unknown) => {
    seeds.delete(repository);
    throw error;
  });
  seeds.set(repository, task);
  return task;
}
