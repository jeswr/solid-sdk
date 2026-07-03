// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Symptom quick-log (DESIGN §5.1.4): tap a symptom chip + a severity slider,
 * onset = now — two taps. Selecting a breathing/anaphylaxis chip triggers the
 * EMERGENCY RAIL (DESIGN §4.4) — it goes straight to emergency guidance, never
 * "we'll correlate it". A non-emergency symptom is logged optimistically with a
 * "Saving…/Saved" indicator.
 */
import { isEmergencySymptomType, type SymptomType, SYMPTOM_TYPES } from "@jeswr/solid-health-diary";
import { useState } from "react";
import { triggerLabel } from "@/lib/off/exposure-display";
import { useDiaryActions } from "@/lib/session/use-diary-actions";
import { EmergencyRail } from "./emergency-rail";

type Phase = "idle" | "saving" | "saved" | "error";

export function SymptomQuickLog({ onLogged }: { onLogged?: () => void }) {
  const { logSymptom } = useDiaryActions();
  const [selected, setSelected] = useState<SymptomType | null>(null);
  const [severity, setSeverity] = useState(5);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isEmergency = selected != null && isEmergencySymptomType(selected);

  async function log() {
    if (!selected) return;
    setPhase("saving");
    setErrorMsg(null);
    try {
      const { syncing } = await logSymptom({ symptomType: selected, severity });
      setPhase("saved");
      onLogged?.();
      await syncing;
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message);
    }
  }

  return (
    <section className="symptom-log" aria-label="Log a symptom">
      <h2>How do you feel?</h2>
      <div className="chips" role="group" aria-label="Symptom">
        {SYMPTOM_TYPES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${selected === s ? "chip--on" : ""} ${
              isEmergencySymptomType(s) ? "chip--emergency" : ""
            }`}
            aria-pressed={selected === s}
            onClick={() => {
              setSelected(s);
              setPhase("idle");
            }}
          >
            {triggerLabel(s)}
          </button>
        ))}
      </div>

      {isEmergency ? (
        <EmergencyRail />
      ) : selected ? (
        <div className="symptom-log__detail">
          <label className="severity">
            Severity: <output aria-live="polite">{severity}</output>/10
            <input
              type="range"
              min={0}
              max={10}
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              aria-label="Severity from 0 to 10"
            />
          </label>
          <button type="button" className="btn btn--primary" onClick={log} disabled={phase === "saving"}>
            {phase === "saving" ? "Saving…" : phase === "saved" ? "Saved ✓" : `Log ${triggerLabel(selected)}`}
          </button>
          <span aria-live="polite" className="symptom-log__status">
            {phase === "saved"
              ? "Saved to your pod — onset now"
              : phase === "error"
                ? `Couldn't sync: ${errorMsg} (will retry)`
                : ""}
          </span>
        </div>
      ) : (
        <p className="symptom-log__hint">Tap a symptom to log it — onset is set to now.</p>
      )}
    </section>
  );
}
