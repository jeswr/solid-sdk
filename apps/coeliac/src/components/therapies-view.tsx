// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The drug-pipeline explainer (Phase 3b §4.4). A STATIC, dated, honest catalog.
 *
 * HEADER TRUTH: the gluten-free diet is still the only treatment; there is no
 * approved disease-modifying drug (sourced from the guidelines + reviews, NOT an
 * openFDA 404). No candidate is described as effective; larazotide + Nexvax2 are
 * shown as failed/discontinued; enzyme supplements are flagged as adjuncts with
 * weak evidence. The live "recruiting now" half is pulled from CT.gov for the named
 * candidates; the framing stays static + human-reviewed.
 */
import type { EvidenceStage, Therapy } from "@/lib/knowledge/therapies";
import { NO_APPROVED_DRUG_HEADER, THERAPIES, THERAPIES_AS_OF } from "@/lib/knowledge/therapies";
import { useTherapyTrials } from "@/lib/session/use-therapy-trials";
import { KnowledgeTabs, MedicalDisclaimer } from "./medical-disclaimer";

const STAGE_LABEL: Record<EvidenceStage, string> = {
  "phase-1": "Phase 1 (early)",
  "phase-2": "Phase 2",
  "phase-2b": "Phase 2b",
  "phase-3": "Phase 3",
  recruiting: "Recruiting",
  discontinued: "Discontinued / failed",
  supplement: "Supplement — not a treatment",
};

const STAGE_TONE: Record<EvidenceStage, string> = {
  "phase-1": "info",
  "phase-2": "info",
  "phase-2b": "info",
  "phase-3": "info",
  recruiting: "ok",
  discontinued: "danger",
  supplement: "warn",
};

function TherapyCard({ therapy, liveCount }: { therapy: Therapy; liveCount?: number }) {
  return (
    <li className={`therapy therapy--${STAGE_TONE[therapy.stage]}`}>
      <div className="therapy__head">
        <h3 className="therapy__name">{therapy.name}</h3>
        <span className={`therapy__stage therapy__stage--${STAGE_TONE[therapy.stage]}`}>
          {STAGE_LABEL[therapy.stage]}
        </span>
      </div>
      <p className="therapy__mechanism">{therapy.mechanism}</p>
      <p className="therapy__status">{therapy.status}</p>
      <p className="therapy__note">{therapy.note}</p>
      {therapy.recruiting && therapy.ctgovTerm ? (
        <p className="therapy__live">
          {typeof liveCount === "number" && liveCount > 0
            ? `${liveCount} recruiting study${liveCount === 1 ? "" : "s"} on ClinicalTrials.gov right now — `
            : "Search recruiting trials — "}
          <a
            href={`https://clinicaltrials.gov/search?term=${encodeURIComponent(therapy.ctgovTerm)}&aggFilters=status:rec`}
            target="_blank"
            rel="noopener noreferrer"
          >
            see them on ClinicalTrials.gov
          </a>
          . Discuss any trial with your clinician — this is not a recommendation to take part.
        </p>
      ) : null}
      {therapy.sources.length > 0 ? (
        <p className="therapy__sources">
          Sources:{" "}
          {therapy.sources.map((s, i) => (
            <span key={s}>
              {i > 0 ? " · " : ""}
              <a href={s} target="_blank" rel="noopener noreferrer">
                {sourceLabel(s)}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export function TherapiesView() {
  const { byTerm } = useTherapyTrials();
  return (
    <div className="knowledge therapies">
      <h1>Drug pipeline</h1>
      <MedicalDisclaimer>
        Every candidate below is experimental. Evidence stages and dates are shown honestly, including
        the ones that have already failed. Nothing here is a treatment you can take.
      </MedicalDisclaimer>
      <KnowledgeTabs />

      <section className="therapies__header" aria-label="Treatment status">
        <p className="therapies__truth">{NO_APPROVED_DRUG_HEADER}</p>
        <p className="therapies__asof">Pipeline reviewed {THERAPIES_AS_OF}.</p>
      </section>

      <ul className="therapy-list">
        {THERAPIES.map((t) => (
          <TherapyCard
            key={t.id}
            therapy={t}
            liveCount={t.ctgovTerm ? byTerm[t.ctgovTerm]?.length : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
