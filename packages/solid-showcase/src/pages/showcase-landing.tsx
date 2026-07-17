// AUTHORED-BY Claude Fable 5
import { StatCard } from "@jeswr/solid-showcase-kit";
import { DemoIdentityCard } from "../components/demo-identity-card.js";
import { EcosystemMap } from "../components/ecosystem-map.js";
import type { WalkthroughDocument } from "../schema.js";

export interface ShowcaseLandingProps {
  document: WalkthroughDocument;
}

/**
 * The landing page, entirely document-driven: hero, the quantified-anchor stat row with
 * public sources, the interactive ecosystem map, the chapter cards (plus the compliance
 * lens card when configured), and the copy-ready demo identity.
 */
export function ShowcaseLanding({ document: doc }: ShowcaseLandingProps) {
  const { site, anchors, chapters, compliance, persona } = doc;
  const firstChapter = chapters[0];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pt-14 pb-24">
      <section aria-labelledby="hero-heading">
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          {site.organization}
        </p>
        <h1
          className="max-w-3xl font-semibold text-4xl text-foreground tracking-tight sm:text-5xl"
          id="hero-heading"
        >
          {site.heroTitle}
        </h1>
        <p className="mt-4 max-w-3xl font-medium text-foreground text-xl">{site.heroLead}</p>
        <p className="mt-4 max-w-3xl text-lg text-muted-foreground">{site.heroParagraph}</p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          {firstChapter !== undefined && (
            <a
              className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90"
              data-cta-start-tour=""
              href={`/chapters/${firstChapter.slug}`}
            >
              {site.startCtaLabel ?? "Start the tour"}
            </a>
          )}
          <a
            className="rounded-lg border border-border px-5 py-3 font-semibold text-foreground text-sm hover:bg-muted"
            href="#ecosystem"
          >
            {site.exploreCtaLabel ?? "Explore the ecosystem"}
          </a>
        </div>
      </section>

      {anchors.length > 0 && (
        <section aria-labelledby="anchors-heading">
          <h2
            className="font-semibold text-2xl text-foreground tracking-tight"
            id="anchors-heading"
          >
            Why now — the numbers
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {anchors.map((anchor) => (
              <StatCard key={anchor.id} label={anchor.label} value={anchor.value} />
            ))}
          </div>
          <ul className="mt-5 flex flex-col gap-3" data-anchor-sources="">
            {anchors.map((anchor) => (
              <li className="text-muted-foreground text-sm" key={anchor.id}>
                <span className="font-medium text-foreground">{anchor.value}</span> —{" "}
                {anchor.detail}{" "}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href={anchor.source.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Source: {anchor.source.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ecosystem-heading" id="ecosystem">
        <h2
          className="font-semibold text-2xl text-foreground tracking-tight"
          id="ecosystem-heading"
        >
          The ecosystem
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Every application maps to a seat a real party holds in the journey. Click a seat to see
          who holds it, what the demo shows in its colours, and — where an app exists — launch it
          live.
        </p>
        <div className="mt-6">
          <EcosystemMap registry={doc.registry} />
        </div>
      </section>

      <section aria-labelledby="chapters-heading" id="chapters">
        <h2 className="font-semibold text-2xl text-foreground tracking-tight" id="chapters-heading">
          The journey — {chapters.length} scene{chapters.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          One persona — {persona.name}, a fictional identity — carries the whole journey. Each scene
          names the public rule or industry fact it dramatizes.
        </p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chapters.map((chapter) => (
            <li key={chapter.slug}>
              <a
                className="flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60"
                data-chapter-card={chapter.slug}
                href={`/chapters/${chapter.slug}`}
              >
                <p className="text-muted-foreground text-sm">Scene {chapter.scene}</p>
                <p className="mt-1 font-semibold text-card-foreground">{chapter.title}</p>
                <p className="mt-2 text-muted-foreground text-sm">{chapter.lead}</p>
              </a>
            </li>
          ))}
          {compliance !== undefined && (
            <li>
              <a
                className="flex h-full flex-col rounded-xl border border-border border-dashed bg-card p-5 transition-colors hover:border-primary/60"
                data-chapter-card="compliance"
                href="/compliance"
              >
                <p className="text-muted-foreground text-sm">Reviewer lens</p>
                <p className="mt-1 font-semibold text-card-foreground">{compliance.title}</p>
                <p className="mt-2 text-muted-foreground text-sm">{compliance.nonAffiliation}</p>
              </a>
            </li>
          )}
        </ol>
      </section>

      <section aria-labelledby="identity-heading" className="max-w-xl">
        <h2 className="font-semibold text-2xl text-foreground tracking-tight" id="identity-heading">
          The demo identity
        </h2>
        <p className="mt-2 text-muted-foreground">
          Values a presenter can copy in seconds — every one of them simulated.
        </p>
        <div className="mt-5">
          <DemoIdentityCard persona={persona} />
        </div>
      </section>
    </main>
  );
}
