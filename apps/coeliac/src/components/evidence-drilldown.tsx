// AUTHORED-BY Claude Sonnet 5
/**
 * Evidence tap-through DRILL-DOWN (DESIGN §4.1, suite-tracker-ov8g deliverable 1)
 * — per suspicion, the exact meal↔symptom exposure pairings the engine matched to
 * compute its lift/confidence, so a user can inspect the real events behind a
 * pattern instead of trusting an opaque score. Reuses the engine's OWN
 * {@link EvidencePairing}/{@link EvidenceSymptom} shape verbatim (`./types`) — no
 * new evidence shape is invented for this view. A native `<details>` disclosure
 * (no bespoke open/close state or ARIA plumbing needed — accessible by
 * construction).
 */
import type { EvidencePairing } from "@/lib/inference/types";
import { triggerLabel } from "@/lib/off/exposure-display";

const EXPOSURE_LEVEL_LABEL: Record<EvidencePairing["exposureLevel"], string> = {
  present: "Contains",
  trace: "May contain (traces)",
  "possible-undeclared": "Possibly undeclared",
};

function formatDateTime(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function EvidenceDrilldown({ evidence }: { evidence: readonly EvidencePairing[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="evidence-drilldown">
      <summary className="evidence-drilldown__summary">
        See the {evidence.length} matched exposure{evidence.length === 1 ? "" : "s"}
      </summary>
      <ul className="evidence-drilldown__list">
        {evidence.map((pairing, i) => (
          <li key={`${pairing.mealId ?? "meal"}-${i}`} className="evidence-drilldown__item">
            <p className="evidence-drilldown__meal">
              <span className="evidence-drilldown__level">
                {EXPOSURE_LEVEL_LABEL[pairing.exposureLevel]}
              </span>{" "}
              — {formatDateTime(pairing.ingestedAt)}
            </p>
            <ul className="evidence-drilldown__symptoms">
              {pairing.symptoms.map((s, si) => (
                <li key={s.symptomId ?? `${i}-${si}`}>
                  {triggerLabel(s.symptomType)}
                  {s.severity !== undefined ? ` (severity ${s.severity}/10)` : ""} —{" "}
                  {s.lagHours.toFixed(1)}h later
                </li>
              ))}
            </ul>
            {pairing.coPresentTriggers.length > 0 ? (
              <p className="evidence-drilldown__confounders">
                Also present in this window: {pairing.coPresentTriggers.map(triggerLabel).join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
