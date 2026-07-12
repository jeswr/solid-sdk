// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Trials view (Phase 3b §4). Surfaces RECRUITING coeliac trials with their
 * location + an eligibility SUMMARY.
 *
 * HARD RAIL (§4.3): trials are shown as information to DISCUSS WITH A CLINICIAN.
 * The app NEVER says "you match / you qualify / you should enrol", never
 * auto-matches eligibility against pod data, and the CTA is "Read on
 * ClinicalTrials.gov" — never "Apply" / "Enrol". Eligibility text is verbatim +
 * read-only. Acceptance tests assert no enrolment verdict is ever rendered.
 */
import { eligibilitySummary, type TrialStudy } from "@/lib/knowledge/trials";
import { useTrials } from "@/lib/session/use-trials";
import { KnowledgeTabs, MedicalDisclaimer } from "./medical-disclaimer";

const DISCUSS_FRAMING =
  "Recruiting trials are shown for information only. Whether a trial is right for you is a decision for you and your doctor — discuss it with your clinician. This app does not check whether you are eligible.";

function locationLine(study: TrialStudy): string | undefined {
  const countries = [...new Set(study.locations.map((l) => l.country).filter((c): c is string => !!c))];
  if (countries.length === 0) return undefined;
  if (countries.length <= 3) return countries.join(", ");
  return `${countries.slice(0, 3).join(", ")} + ${countries.length - 3} more`;
}

function TrialCard({ study }: { study: TrialStudy }) {
  const elig = eligibilitySummary(study.eligibilityCriteria);
  const where = locationLine(study);
  const phases = study.phases.length ? study.phases.join(", ") : study.studyType;
  return (
    <li className="trial-card">
      <h3 className="trial-card__title">{study.briefTitle}</h3>
      <p className="trial-card__meta">
        {study.overallStatus ? <span className="trial-card__status">{study.overallStatus}</span> : null}
        {phases ? <span className="trial-card__phase">{phases}</span> : null}
        {where ? <span className="trial-card__where">{where}</span> : null}
      </p>
      {elig ? (
        <details className="trial-card__eligibility">
          <summary>Eligibility criteria (for information — read the full text on the study page)</summary>
          <p className="trial-card__eligibility-text">{elig}</p>
        </details>
      ) : null}
      <p className="trial-card__discuss">{DISCUSS_FRAMING}</p>
      <a
        className="trial-card__cta"
        href={study.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Read on ClinicalTrials.gov
      </a>
    </li>
  );
}

export function TrialsView() {
  const { studies, allStudies, loading, error, fromCache, countryName, setCountryName, availableCountries } =
    useTrials();
  return (
    <div className="knowledge trials">
      <h1>Clinical trials</h1>
      <MedicalDisclaimer>
        These are officially registered, currently recruiting trials from
        ClinicalTrials.gov. They are information to discuss with your clinician — never a
        recommendation to take part.
      </MedicalDisclaimer>
      <KnowledgeTabs />

      {availableCountries.length > 0 ? (
        <div className="trials__filter">
          <label htmlFor="trials-country">Show trials in</label>
          <select
            id="trials-country"
            value={countryName ?? ""}
            onChange={(e) => setCountryName(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">All countries ({allStudies.length})</option>
            {availableCountries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {fromCache ? (
        <p className="knowledge__offline" role="note">
          Showing saved trials — we couldn&apos;t reach the registry just now.
        </p>
      ) : null}

      {loading && allStudies.length === 0 ? (
        <p className="knowledge__loading">Looking for recruiting trials…</p>
      ) : error && allStudies.length === 0 ? (
        <p className="knowledge__error" role="note">
          {error}
        </p>
      ) : studies.length === 0 ? (
        <p className="knowledge__empty">
          {allStudies.length === 0
            ? "No recruiting coeliac trials are listed right now."
            : `No recruiting trials in ${countryName}. Choose "All countries" to see every listed trial.`}
        </p>
      ) : (
        <ul className="trial-list">
          {studies.map((s) => (
            <TrialCard key={s.nctId} study={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
