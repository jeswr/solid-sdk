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
import Link from "next/link";
import { useCallback, useState } from "react";
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
import type { ContextClusterSurfacing } from "@/lib/inference/context-cluster";
import type { StoredProtocol } from "@/lib/cache/diary-store";
import { nextAction } from "@/lib/protocol/fsm";
import { storedProtocolToData } from "@/lib/protocol/persist";
import { triggerLabel } from "@/lib/off/exposure-display";
import { useGenetics } from "@/lib/session/use-genetics";
import { useInsights } from "@/lib/session/use-insights";
import { useProtocolActions } from "@/lib/session/use-protocol-actions";
import { useProtocols } from "@/lib/session/use-protocols";
import { EmergencyRail } from "./emergency-rail";
import { MedicalDisclaimer } from "./medical-disclaimer";

const PHASE_LABEL: Record<string, string> = {
  baseline: "Baseline",
  eliminate: "Eliminating",
  washout: "Washout",
  reintroduce: "Reintroducing",
  observe: "Observing",
  concluded: "Concluded",
};

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

/** Human label for a meal context (`restaurant` → "Eating out"). */
const CONTEXT_LABEL: Record<string, string> = {
  restaurant: "Eating out",
  home: "At home",
  work: "At work",
  travel: "Travelling",
  other: "Other",
};

/**
 * The eating-out clustering surface (DESIGN §2.2/§4). Inference-adjacent, so it
 * shows counts (never a causal claim) and carries the "pattern not a diagnosis"
 * caveat. Rendered only when the engine returns a surfacing (enough restaurant
 * meals). The `clustered` flag drives the emphasis; a non-clustered breakdown is
 * framed neutrally, never as "you react to eating out".
 */
function ContextClusterCard({ cluster }: { cluster: ContextClusterSurfacing }) {
  return (
    <section
      className={`context-cluster ${cluster.clustered ? "context-cluster--flagged" : ""}`}
      aria-label="Where your reactions happen"
    >
      <h2>Where your reactions happen</h2>
      <p className="context-cluster__message">{cluster.message}</p>
      <ul className="context-cluster__breakdown">
        {cluster.byContext
          .filter((r) => r.mealCount > 0)
          .map((r) => (
            <li key={r.context} className="context-cluster__row">
              <span className="context-cluster__ctx">{CONTEXT_LABEL[r.context] ?? r.context}</span>
              <span className="context-cluster__rate">
                {r.followedCount}/{r.mealCount} meals followed by a symptom ({pct(r.followedRate)})
              </span>
            </li>
          ))}
      </ul>
      <p className="context-cluster__disclaimer">{cluster.disclaimer}</p>
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

/** A compact summary of the active challenges — phase + what to do next (DESIGN §3). */
function ActiveChallenges({ active }: { active: StoredProtocol[] }) {
  if (active.length === 0) return null;
  return (
    <section className="insights__active" aria-label="Active challenges">
      <h2>Your active challenge{active.length === 1 ? "" : "s"}</h2>
      <ul className="active-challenge-list">
        {active.map((p) => {
          const na = nextAction(storedProtocolToData(p));
          return (
            <li key={p.ulid} className="active-challenge">
              <span className="active-challenge__trigger">{triggerLabel(p.targetTrigger)}</span>
              <span className="active-challenge__phase">{PHASE_LABEL[p.phase] ?? p.phase}</span>
              <span className="active-challenge__next">{na.detail}</span>
            </li>
          );
        })}
      </ul>
      <p className="active-challenge__link">
        <Link href="/protocols">Open your challenges</Link> to record the next step.
      </p>
    </section>
  );
}

function InsightsBody({ result }: { result: AnalysisResult }) {
  const { safetyRails, suspicions, proposal, reviews, contextCluster } = result;
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

      {contextCluster ? <ContextClusterCard cluster={contextCluster} /> : null}

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

/**
 * A careful, NPV-only genetics signal (Phase 3c). Shown only when a summary is
 * recorded. A DQ2/DQ8-ABSENT result is a genuine "coeliac unlikely" signal — but it
 * is STILL NOT a diagnosis, and a PRESENT result is explicitly NOT confirmation
 * (DQ2/DQ8 is common). Everything else stays neutral. Links to the Genetics view for
 * the full framing.
 */
function GeneticSignal() {
  const { summary, loaded } = useGenetics();
  if (!loaded || !summary) return null;
  const risk = summary.coeliacGeneticRisk;
  let tone = "info";
  let text: string;
  if (risk === "risk-haplotype-absent") {
    tone = "ok";
    text =
      "Your recorded HLA summary found no DQ2/DQ8 risk variant, which makes coeliac disease very " +
      "unlikely. This is NOT a diagnosis and does not fully rule it out — discuss with your clinician.";
  } else if (risk === "risk-haplotype-present") {
    text =
      "Your recorded HLA summary found a DQ2/DQ8 variant. This is COMMON and is NOT confirmation of " +
      "coeliac — most carriers never develop it. Only a clinician can diagnose coeliac.";
  } else {
    text =
      "Your recorded HLA summary is incomplete or inconclusive, so it tells us little either way. " +
      "See Genetics for the full picture.";
  }
  return (
    <aside className={`insights__genetics insights__genetics--${tone}`} role="note">
      <p>{text}</p>
      <Link href="/genetics">View genetics</Link>
    </aside>
  );
}

export function InsightsView() {
  const { result, mealCount, symptomCount, loaded, refresh } = useInsights();
  const protocols = useProtocols();
  const { startChallenge } = useProtocolActions();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const proposal = result?.proposal;
  const canStart = protocols.active.length === 0;

  const onStart = useCallback(
    async (trigger: string) => {
      setBusy(true);
      setNotice(null);
      const repaint = () => Promise.all([refresh(), protocols.refresh()]);
      try {
        const res = await startChallenge(
          { trigger: trigger as Parameters<typeof startChallenge>[0]["trigger"] },
          protocols.safety,
        );
        // A refusal (gluten / emergency / one-at-a-time) is surfaced; nothing was written.
        // Otherwise the cache is already written (optimistic) — the pod write finishes
        // in the background and repaints on settle; we do NOT await it.
        if ("refused" in res) setNotice(res.message);
        else void res.syncing.catch(() => {}).finally(() => void repaint());
      } finally {
        await repaint();
        setBusy(false);
      }
    },
    [startChallenge, protocols, refresh],
  );

  return (
    <div className="insights">
      <h1>Insights</h1>
      <MedicalDisclaimer>{PATTERN_NOT_DIAGNOSIS}</MedicalDisclaimer>

      <ActiveChallenges active={protocols.active} />
      <GeneticSignal />

      {notice ? (
        <aside className="insights__notice" role="note">
          {notice}
        </aside>
      ) : null}

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
          {proposal && proposal.kind === "eliminate" && proposal.trigger && canStart ? (
            <div className="insights__start">
              <button type="button" disabled={busy} onClick={() => onStart(proposal.trigger as string)}>
                Start a {triggerLabel(proposal.trigger)} challenge
              </button>
              <p className="insights__start-note">
                Starts a structured elimination-and-reintroduction test you run at your own pace.
                It&apos;s a suggestion, not an instruction — talk it through with your clinician or
                dietitian first.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
