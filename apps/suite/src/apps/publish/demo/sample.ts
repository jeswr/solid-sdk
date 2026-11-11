// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PageData, PublishRepository, SiteData } from "@jeswr/solid-publish";
import type { PodSession } from "@/lib/session/pod-session";

const seeding = new WeakMap<typeof fetch, Promise<void>>();
export async function ensureSample(
  session: PodSession,
  repository: PublishRepository,
): Promise<void> {
  if (session.mode !== "demo") return;
  let task = seeding.get(session.fetch);
  if (!task) {
    task = seed(repository).catch((error: unknown) => {
      seeding.delete(session.fetch);
      throw error;
    });
    seeding.set(session.fetch, task);
  }
  await task;
}
async function seed(repository: PublishRepository) {
  if ((await repository.listSites()).length) return;
  const at = new Date("2026-11-08T10:00:00Z");
  const data: SiteData = {
    name: "The little field journal",
    description: "Small discoveries from a fictional riverside town.",
    author: "Rowan Fern",
    theme: "journal",
    inLanguage: "en-GB",
    created: at,
    modified: at,
  };
  let site = await repository.createSite("field-journal", data);
  const stories = [
    [
      "a-slower-sunday",
      "A slower Sunday",
      "A flask of tea, a riverside path and nowhere to hurry.",
      "## The long way home\n\nI took the riverside path with a flask of tea. The reeds were full of tiny movements.\n\nSometimes a good day needs very little planning.\n\n- Leave the phone in a pocket\n- Look for something you have never noticed\n- Take the long way home",
      "post",
      "published",
    ],
    [
      "bread-and-beginnings",
      "Bread and beginnings",
      "Notes from an enthusiastic beginner's kitchen.",
      "## A small experiment\n\nThe first loaf was rather flat. The second was **much better**.\n\n> Make something, notice what happened, try again.\n\nThat seems a useful recipe for more than bread.",
      "post",
      "published",
    ],
    [
      "winter-window-box",
      "A winter window box",
      "A few ideas for keeping a little green through winter.",
      "## Plans for November\n\nA pot of rosemary, a few hardy flowers and a little patience.\n\nThis is a draft. There is still time to change the plan.",
      "post",
      "draft",
    ],
    [
      "about",
      "About this journal",
      "A fictional corner of the web, written by Rowan Fern.",
      "Hello, I'm **Rowan** — a fictional writer, bread maker and riverside wanderer.\n\nThis sample journal shows how a few words can become a small website. Everything here is made up.\n\nThanks for visiting.",
      "page",
      "published",
    ],
  ] as const;
  for (const [position, [slug, title, summary, body, kind, status]] of stories.entries()) {
    const page: PageData = {
      slug,
      title,
      summary,
      body,
      kind,
      status: "draft",
      position,
      modified: at,
      keywords: kind === "post" ? ["small things"] : [],
    };
    const saved = await repository.createPage(site, slug, page);
    if (status === "published") {
      // Fictional demo bytes only; real sites always require the UI confirmation.
      const published = await repository.publish(
        site,
        saved,
        { ...page, published: new Date(at.getTime() - position * 86400000) },
        true,
      );
      site = published.site;
    }
  }
}
