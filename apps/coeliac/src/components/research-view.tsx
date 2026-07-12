// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Research view (Phase 3a §3). Shows, in credibility order:
 *   1. the curated, cited clinical GUIDELINES (the authoritative anchor);
 *   2. the latest CREDIBLE literature from Europe PMC, ranked by a pure,
 *      interpretable score whose inputs (type, date, citations) are SHOWN.
 *
 * Honesty-first: preprints are excluded by default and retracted items are
 * hard-excluded upstream (`rankLiterature`); the app never paraphrases a finding
 * into a new medical claim — it shows the title + metadata + the canonical link and
 * the reader judges the source. The not-medical-advice frame is always present.
 */
import { DIAGNOSIS_KEY_MESSAGE, GUIDELINES } from "@/lib/knowledge/guidelines";
import type { RankedLiterature } from "@/lib/knowledge/literature";
import { useLiterature } from "@/lib/session/use-literature";
import { KnowledgeTabs, MedicalDisclaimer } from "./medical-disclaimer";

function pubTypeLabel(r: RankedLiterature): string {
  const t = r.result.pubTypes.find((x) =>
    ["guideline", "meta-analysis", "systematic review", "review", "randomized controlled trial", "clinical trial"].some(
      (m) => x.includes(m),
    ),
  );
  return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : "Research article";
}

function LiteratureCard({ item }: { item: RankedLiterature }) {
  const { result } = item;
  return (
    <li className="lit-card">
      <h3 className="lit-card__title">
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          {result.title}
        </a>
      </h3>
      <p className="lit-card__meta">
        <span className="lit-card__type">{pubTypeLabel(item)}</span>
        {result.journalTitle ? <span className="lit-card__journal">{result.journalTitle}</span> : null}
        {result.pubYear ? <span className="lit-card__year">{result.pubYear}</span> : null}
        {result.isOpenAccess ? <span className="lit-card__oa">Open access</span> : null}
        {item.matchedTrigger ? (
          <span className="lit-card__matched" title="Boosted because it mentions something you track">
            Relevant to you
          </span>
        ) : null}
      </p>
      {result.authorString ? <p className="lit-card__authors">{result.authorString}</p> : null}
      <p className="lit-card__why">
        Rank score {item.score.toFixed(2)} — from its type, recency
        {result.citedByCount > 0 ? `, and ${result.citedByCount} citations` : ""}. Read the source to
        judge it for yourself.
      </p>
    </li>
  );
}

export function ResearchView() {
  const { ranked, hitCount, loading, error, fromCache } = useLiterature();
  return (
    <div className="knowledge research">
      <h1>Latest research</h1>
      <MedicalDisclaimer>
        We only ever show peer-reviewed literature (Europe PMC) and the official clinical guidelines —
        never open web results. Preprints and retracted papers are filtered out.
      </MedicalDisclaimer>
      <KnowledgeTabs />

      <section className="research__guidelines" aria-label="Clinical guidelines">
        <h2>Clinical guidelines</h2>
        <p className="research__key-message">{DIAGNOSIS_KEY_MESSAGE}</p>
        <ul className="guideline-list">
          {GUIDELINES.map((g) => (
            <li key={g.id} className="guideline">
              <h3 className="guideline__title">
                <a href={g.url} target="_blank" rel="noopener noreferrer">
                  {g.title}
                </a>
              </h3>
              <p className="guideline__org">
                {g.org} · {g.year}
              </p>
              <p className="guideline__summary">{g.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="research__literature" aria-label="Recent literature">
        <h2>Recent literature</h2>
        {fromCache ? (
          <p className="knowledge__offline" role="note">
            Showing saved results — we couldn&apos;t reach the research index just now.
          </p>
        ) : null}
        {loading && ranked.length === 0 ? (
          <p className="knowledge__loading">Finding the latest credible research…</p>
        ) : error && ranked.length === 0 ? (
          <p className="knowledge__error" role="note">
            {error} The clinical guidelines above are always available.
          </p>
        ) : ranked.length === 0 ? (
          <p className="knowledge__empty">No matching peer-reviewed articles right now.</p>
        ) : (
          <>
            <p className="research__count">
              Showing {ranked.length} of {hitCount.toLocaleString()} indexed articles, most credible
              and current first.
            </p>
            <ul className="lit-list">
              {ranked.map((item) => (
                <LiteratureCard key={`${item.result.source}:${item.result.id}`} item={item} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
