// AUTHORED-BY Claude Sonnet 5
/**
 * Reintroduction/elimination protocol SCHEDULE rendering (DESIGN §3, RESEARCH
 * §2.4, suite-tracker-ov8g deliverable 4) — a timeline view of the dose-escalation
 * ladder the engine already computes ({@link ReintroductionSchedule} /
 * {@link ReintroductionStep}, `../lib/inference/reintroduction`), never raw JSON.
 * `AnalysisResult.reintroductionSchedule` is only ever present for the ONE active
 * challenge (one-active-challenge invariant), so this renders a single schedule.
 */
import type { ReintroductionSchedule } from "@/lib/inference/types";
import { triggerLabel } from "@/lib/off/exposure-display";

const DOSE_LABEL: Record<string, string> = {
  small: "Small dose",
  moderate: "Moderate dose",
  full: "Full dose",
};

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function ReintroductionTimeline({ schedule }: { schedule: ReintroductionSchedule }) {
  if (schedule.steps.length === 0) return null;
  return (
    <section className="reintro-timeline" aria-label="Reintroduction schedule">
      <h2>Reintroduction schedule — {triggerLabel(schedule.trigger)}</h2>
      <p className="reintro-timeline__washout">
        {schedule.washoutDays} day{schedule.washoutDays === 1 ? "" : "s"} of washout before the first
        dose, then each dose is observed for a reaction before the next.
      </p>
      <ol className="reintro-timeline__steps">
        {schedule.steps.map((step) => (
          <li key={step.step} className="reintro-timeline__step">
            <span className="reintro-timeline__dose">{DOSE_LABEL[step.dose] ?? step.dose}</span>
            <span className="reintro-timeline__dates">
              {formatDate(step.scheduledFor)} — observe until {formatDate(step.observeUntil)}
            </span>
          </li>
        ))}
      </ol>
      <p className="reintro-timeline__note">
        A suggested schedule — adjust it with your clinician or dietitian; it is not a prescription.
      </p>
    </section>
  );
}
