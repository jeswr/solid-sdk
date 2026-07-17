// AUTHORED-BY Claude Fable 5
import type { WalkthroughDocument } from "../schema.js";

export interface ShowcaseCompliancePageProps {
  document: WalkthroughDocument;
}

/**
 * The compliance/reviewer lens, deliberately UNBRANDED — neutral grayscale styling, no
 * authority name in the chrome, no seal-like imagery — with the document's mandatory
 * non-affiliation statement rendered prominently. Content is the journey's public-rule
 * beats rendered as a reviewer-facing checklist. Only route here when
 * `document.compliance` is configured — rendering without it throws.
 */
export function ShowcaseCompliancePage({ document: doc }: ShowcaseCompliancePageProps) {
  const lens = doc.compliance;
  if (lens === undefined) {
    throw new Error(
      "This walkthrough document configures no compliance lens — do not route to the compliance page.",
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-10 pb-24" data-compliance-view="">
      <header className="border-neutral-400 border-b-2 pb-6">
        <p className="font-medium text-neutral-500 text-sm uppercase tracking-[0.2em]">
          Reviewer lens — illustrative
        </p>
        <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-tight sm:text-4xl">
          {lens.title}
        </h1>
        <p className="mt-4 rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 font-medium text-neutral-800 text-sm">
          {lens.nonAffiliation}
        </p>
        <p className="mt-4 text-muted-foreground">
          The demo journey dramatizes public rules. This view renders those beats the way a reviewer
          would read them: the rule, its public source, and what the subject-held record makes
          checkable.
        </p>
      </header>

      <ol className="mt-8 flex flex-col gap-5">
        {lens.checks.map((check, index) => (
          <li
            className="rounded-lg border border-neutral-300 bg-white p-5"
            data-compliance-check={check.id}
            key={check.id}
          >
            <div className="flex items-baseline gap-3">
              <span aria-hidden="true" className="font-mono text-neutral-400 text-sm tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-lg text-neutral-900">{check.rule}</h2>
                <p className="mt-1 text-neutral-500 text-sm">
                  <a
                    className="underline underline-offset-2 hover:text-neutral-800"
                    href={check.citationUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {check.citation}
                  </a>
                </p>
                <p className="mt-3 text-neutral-700 text-sm">{check.observe}</p>
                <p className="mt-3 text-sm">
                  <a
                    className="font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
                    href={`/chapters/${check.chapterSlug}`}
                  >
                    Dramatized in scene {check.scene} →
                  </a>
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-neutral-500 text-sm">
        All rules referenced are public. {lens.nonAffiliation}
      </p>
    </main>
  );
}
