// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { type DeckRepository, deckFromMarkdown } from "@jeswr/solid-slides";
import type { PodSession } from "@/lib/session/pod-session";

const SAMPLES = ["sample-garden.ttl", "sample-studio.ttl"] as const;
const seeding = new WeakMap<typeof fetch, Promise<void>>();
export function seedSlides(session: PodSession, repository: DeckRepository): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const existing = seeding.get(session.fetch);
  if (existing) return existing;
  const task = (async () => {
    const { decks, broken } = await repository.list();
    const samples = SAMPLES.map((name) => new URL(name, repository.container).href);
    if (decks.length && !broken.some((entry) => samples.includes(entry.url))) return;
    const garden = deckFromMarkdown(
      "# A greener neighbourhood\nLittle Lantern community garden\n???\nWelcome everyone to our fictional autumn gathering.\n---\n# What we grew together\n- 18 raised beds\n- A home for pollinators\n- Saturday seed swaps\nNote: Pause for questions.\n---\n# Next season\nPlant something small. Share what grows.",
    );
    garden.theme = "warm";
    const studio = deckFromMarkdown(
      "# Paper Moon Studio\nSmall ideas, carefully made\n---\n# A simple plan\n1. Listen to the community\n2. Make a rough prototype\n3. Try it together\n???\nThese are fictional projects for exploring Slides.\n---\n# Thank you\nWhat shall we make next?",
    );
    studio.theme = "dark";
    // Idempotent: an interrupted seed leaves an empty or broken sample, which is replaced.
    await repository.ensure(garden, SAMPLES[0]);
    await repository.ensure(studio, SAMPLES[1]);
  })().catch((error: unknown) => {
    seeding.delete(session.fetch);
    throw error;
  });
  seeding.set(session.fetch, task);
  return task;
}
