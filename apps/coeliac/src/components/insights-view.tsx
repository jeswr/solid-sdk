// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Insights / Correlations view (DESIGN §4). Reads the account's cached diary and
 * runs the PURE inference engine, then renders — in the engine's own safety
 * precedence:
 *
 *   1. Safety rails FIRST, strongest-first (emergency / alarm / persistence /
 *      restriction-anxiety / pre-diagnosis-gluten). Rules, never "correlated away".
 *   2. Ranked, evidence-carrying suspicions — a PATTERN, never a diagnosis, never
 *      `confirmed` (that needs a supervised protocol). Each carries its counts + the
 *      always-attached honesty caveat.
 *   3. One proposal — the single best next step (expansion-biased; one active
 *      challenge at a time; pre-diagnosis gluten blocked).
 *   4. Due re-challenges — time-boxed exclusions the engine proactively offers to
 *      re-test, so the avoid-list shrinks (orthorexia guard).
 *
 * This component renders the engine's output; it invents no inference of its own and
 * frames nothing as certainty. Emergency rails reuse the full {@link EmergencyRail}
 * guidance so a potentially-fatal reaction is never shown as a data point.
 */
import { PATTERN_NOT_DIAGNOSIS } from "@/lib/inference/types";
import type {
  AnalysisResult,
} from "@/lib/inference/analyze";
import type {
  EliminationProposal,
  ReviewSurfacing,
  SafetyRail,
  SuspicionScore,
} from "@/lib/inference/types";
import { triggerLabel } from "@/lib/off/exposure-display";
import { useInsights } from "@/lib/session/use-insights";
import { EmergencyRail } from "./emergency-rail";

const CONFIDENCE_LABEL: Record<SuspicionScore["confidence"], string> = {
  emerging: "Emerging",
  suspected: "Suspected",
  likely: "Likely",
};

const RAIL_TONE: Record<SafetyRail["severity"], string> = {
  emergency: "danger",
  urgent: "warn",
  advisory: "info",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function SafetyRailCard({ rail }: { rail: SafetyRail }) {
  // Anaphylaxis gets the full, unmistakable emergency guidance — never a one-liner.
  if (rail.kind === "emergency-anaphylaxis") return <EmergencyRail />;
  return (
    <aside
      className={`insight-rail insight-rail--${RAIL_TONE[rail.severity]}`}
      role={rail.severity === "emergency" ? "alert" : "note"}
    >
      <p className="insight-rail__message">{rail.message}</p>
    </aside>
  );
}

function SuspicionCard({ suspicion }: { suspicion: SuspicionScore }) {
  const {
    trigger,
    confidence,
    exposureCount,
    followedCount,
    followedRate,
    lagWindowMin,
    lagWindowMax,
    confounded,
    confounders,
    evidence,
    disclaimer,
  } = suspicion;
  return (
    <li className={`suspicion suspicion--${confidence}`}>
      <div className="suspicion__head">
        <span className="suspicion__trigger">{triggerLabel(trigger)}</span>
        <span className={`suspicion__confidence suspicion__confidence--${confidence}`}>
          {CONFIDENCE_LABEL[confidence]}
        </span>
      </div>
      <p className="suspicion__stat">
        Symptoms followed <strong>{followedCount}</strong> of your{" "}
        <strong>{exposureCount}</strong> {triggerLabel(trigger).toLowerCase()} exposures (
        {pct(followedRate)}), within a {lagWindowMin}–{lagWindowMax}h window.
      </p>
      {confounded && confounders.length > 0 ? (
        <p className="suspicion__confounded">
          Often occurs alongside {confounders.map(triggerLabel).join(", ")} — a supervised test is
          the only way to separate them.
        </p>
      ) : null}
      <p className="suspicion__evidence">
        Based on {evidence.length} matched exposure{evidence.length === 1 ? "" : "s"}.
      </p>
      <p className="suspicion__disclaimer">{disclaimer}</p>
    </li>
  );
}

function ProposalCard({ proposal }: { proposal: EliminationProposal }) {
  if (proposal.kind === "none") return null;
  const heading =
    proposal.kind === "eliminate"
      ? "Suggested next step"
      : proposal.kind === "re-challenge"
        ? "Ready to re-test"
        : "Hold steady";
  return (
    <section className="proposal" aria-label="Suggested next step">
      <h2>{heading}</h2>
      <p className="proposal__rationale">{proposal.rationale}</p>
      <p className="proposal__note">
        This is a suggestion, not an instruction — talk it through with your clinician or dietitian
        before changing your diet.
      </p>
    </section>
  );
}

function ReviewCard({ review }: { review: ReviewSurfacing }) {
  return (
    <li className="review">
      <span className="review__trigger">{triggerLabel(review.trigger)}</span>
      <span className="review__message">{review.message}</span>
    </li>
  );
}

function InsightsBody({ result }: { result: AnalysisResult }) {
  const { safetyRails, suspicions, proposal, reviews } = result;
  return (
    <>
      {safetyRails.length > 0 ? (
        <section className="insights__rails" aria-label="Safety guidance">
          {safetyRails.map((rail) => (
            <SafetyRailCard key={`${rail.kind}-${rail.severity}`} rail={rail} />
          ))}
        </section>
      ) : null}

      <section className="insights__suspicions" aria-label="Possible patterns">
        <h2>Possible patterns</h2>
        {suspicions.length === 0 ? (
          <p className="insights__none">
            No patterns stand out yet. Keep logging meals and symptoms — the more you record, the
            clearer any lag-based association becomes.
          </p>
        ) : (
          <ul className="suspicion-list">
            {suspicions.map((s) => (
              <SuspicionCard key={s.trigger} suspicion={s} />
            ))}
          </ul>
        )}
      </section>

      <ProposalCard proposal={proposal} />

      {reviews.length > 0 ? (
        <section className="insights__reviews" aria-label="Foods ready to re-test">
          <h2>Ready to re-test</h2>
          <ul className="review-list">
            {reviews.map((r) => (
              <ReviewCard key={`${r.trigger}-${r.conclusionId ?? ""}`} review={r} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function InsightsView() {
  const { result, mealCount, symptomCount, loaded } = useInsights();

  return (
    <div className="insights">
      <h1>Insights</h1>
      <p className="insights__caveat">{PATTERN_NOT_DIAGNOSIS}</p>

      {!loaded ? (
        <p className="insights__loading">Analysing your diary…</p>
      ) : mealCount === 0 || symptomCount === 0 ? (
        <p className="insights__empty">
          Insights need both meals and symptoms to look for patterns. Log a few meals and any
          symptoms you notice, then check back — everything is analysed on your device, from your
          own pod.
        </p>
      ) : result ? (
        <>
          <p className="insights__scope">
            Analysed {mealCount} meal{mealCount === 1 ? "" : "s"} and {symptomCount} symptom
            {symptomCount === 1 ? "" : "s"} from your diary.
          </p>
          <InsightsBody result={result} />
        </>
      ) : null}
    </div>
  );
}
