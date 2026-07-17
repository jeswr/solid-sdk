// AUTHORED-BY Claude Fable 5
import { ChapterPlayer } from "../components/chapter-player.js";
import { chapterBySlug } from "../document.js";
import type { WalkthroughDocument } from "../schema.js";

export interface ShowcaseChapterPageProps {
  document: WalkthroughDocument;
  slug: string;
}

/**
 * One chapter: scene navigation pills, the chapter header (scene number, title, lead,
 * anchor), the keyboard-navigable chapter player, and previous/next navigation. Guard the
 * slug with {@link chapterBySlug} in your route (e.g. Next `notFound()`) — an unknown
 * slug here throws.
 */
export function ShowcaseChapterPage({ document: doc, slug }: ShowcaseChapterPageProps) {
  const chapter = chapterBySlug(doc, slug);
  if (chapter === undefined) {
    throw new Error(`Unknown chapter slug "${slug}" — guard routes with chapterBySlug().`);
  }
  const { chapters, compliance } = doc;
  const index = chapters.findIndex((entry) => entry.slug === chapter.slug);
  const previous = index > 0 ? chapters[index - 1] : undefined;
  const next = index < chapters.length - 1 ? chapters[index + 1] : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-10 pb-24">
      <nav aria-label="Chapters" className="flex flex-wrap items-center gap-2 text-sm">
        <a className="text-muted-foreground underline-offset-2 hover:underline" href="/#chapters">
          All chapters
        </a>
        {chapters.map((entry) => (
          <a
            aria-current={entry.slug === chapter.slug ? "page" : undefined}
            className={
              entry.slug === chapter.slug
                ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground text-xs"
                : "rounded-full border border-border px-3 py-1 text-muted-foreground text-xs hover:bg-muted"
            }
            href={`/chapters/${entry.slug}`}
            key={entry.slug}
          >
            {entry.scene}
          </a>
        ))}
        {compliance !== undefined && (
          <a
            className="rounded-full border border-border border-dashed px-3 py-1 text-muted-foreground text-xs hover:bg-muted"
            href="/compliance"
          >
            {compliance.title}
          </a>
        )}
      </nav>

      <header className="mt-8">
        <p className="text-muted-foreground text-sm">
          Scene {chapter.scene} of {chapters.length}
        </p>
        <h1 className="mt-1 font-semibold text-3xl text-foreground tracking-tight sm:text-4xl">
          {chapter.title}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">{chapter.lead}</p>
        <p className="mt-3 rounded-lg border border-border bg-muted/50 px-4 py-2 text-foreground text-sm">
          <span className="font-semibold">Anchor:</span> {chapter.anchor}
        </p>
      </header>

      <div className="mt-8">
        <ChapterPlayer chapter={chapter} registry={doc.registry} />
      </div>

      <nav
        aria-label="Chapter navigation"
        className="mt-10 flex items-center justify-between gap-3"
      >
        {previous !== undefined ? (
          <a
            className="rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted"
            data-previous-chapter=""
            href={`/chapters/${previous.slug}`}
          >
            ← Scene {previous.scene}: {previous.title}
          </a>
        ) : (
          <span />
        )}
        {next !== undefined ? (
          <a
            className="rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted"
            data-next-chapter=""
            href={`/chapters/${next.slug}`}
          >
            Scene {next.scene}: {next.title} →
          </a>
        ) : compliance !== undefined ? (
          <a
            className="rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted"
            data-next-chapter=""
            href="/compliance"
          >
            The reviewer lens: {compliance.title} →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
