// AUTHORED-BY Claude Fable 5
"use client";
/**
 * The DietPlan view (DESIGN §2.2 entity 9) — "what am I currently avoiding, and
 * why". Every entry is GROUNDED: a confirmed reaction from a completed test, or a
 * running elimination. Nothing here is a diagnosis, so the medical-disclaimer frame
 * is present. The engine is expansion-biased — a time-boxed exclusion whose review
 * date has passed is surfaced with a "ready to re-test" prompt so the avoid-list can
 * SHRINK as the gut heals. Gluten (coeliac) is lifelong and is never review-flagged.
 */
import Link from "next/link";
import type { PlanExclusion } from "@/lib/inference/diet-plan";
import { triggerLabel } from "@/lib/off/exposure-display";
import { useDietPlan } from "@/lib/session/use-diet-plan";
import { MedicalDisclaimer } from "./medical-disclaimer";

const VERDICT_TEXT: Record<string, string> = {
  reacts: "your own test found you react to it",
  "dose-dependent": "your own test found you react to it above a certain amount",
  inconclusive: "your test was inconclusive",
  tolerated: "tolerated",
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ExclusionRow({ exclusion }: { exclusion: PlanExclusion }) {
  const label = triggerLabel(exclusion.trigger);
  return (
    <li className={`plan-item ${exclusion.reviewDue ? "plan-item--review-due" : ""}`}>
      <div className="plan-item__head">
        <span className="plan-item__trigger">{label}</span>
        {exclusion.timeBoxed ? (
          <span className="plan-item__tag">can ease over time</span>
        ) : (
          <span className="plan-item__tag plan-item__tag--lifelong">lifelong</span>
        )}
      </div>
      <p className="plan-item__why">
        {exclusion.reason === "confirmed-reaction"
          ? `You're avoiding ${label.toLowerCase()} because ${VERDICT_TEXT[exclusion.verdict ?? "reacts"]}.`
          : `You're currently leaving ${label.toLowerCase()} out as part of an elimination test in progress.`}
      </p>
      {exclusion.note ? <p className="plan-item__note">{exclusion.note}</p> : null}
      {exclusion.reviewDue ? (
        <p className="plan-item__review">
          It&apos;s worth carefully re-testing this now — sensitivities like it often ease as your
          gut heals. <Link href="/protocols">Start a re-challenge</Link>. Talk to your clinician if
          you&apos;re unsure.
        </p>
      ) : exclusion.reviewAfter ? (
        <p className="plan-item__review-later">
          Worth re-testing after {fmtDate(exclusion.reviewAfter)}.
        </p>
      ) : null}
    </li>
  );
}

export function DietPlanView() {
  const { plan, loaded } = useDietPlan();

  return (
    <div className="diet-plan">
      <h1>Your diet plan</h1>
      <MedicalDisclaimer>
        This is the set of foods you&apos;re currently avoiding, built from your own logged tests —
        not a prescription. It&apos;s decision support, not diagnosis; agree any diet change with
        your clinician or dietitian.
      </MedicalDisclaimer>

      {!loaded ? (
        <p className="diet-plan__loading">Loading your plan…</p>
      ) : plan.exclusions.length === 0 ? (
        <p className="diet-plan__empty">
          You&apos;re not avoiding anything based on your own tests yet. That&apos;s the goal — the
          fewer foods you have to leave out, the better. As you run elimination challenges, anything
          they confirm will appear here with the reason why.
        </p>
      ) : (
        <>
          {plan.reviewDueCount > 0 ? (
            <p className="diet-plan__review-lead" role="note">
              {plan.reviewDueCount} of your exclusions {plan.reviewDueCount === 1 ? "is" : "are"}{" "}
              ready to re-test — your avoid-list may be able to shrink.
            </p>
          ) : null}
          <ul className="plan-list">
            {plan.exclusions.map((e) => (
              <ExclusionRow key={e.trigger} exclusion={e} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
