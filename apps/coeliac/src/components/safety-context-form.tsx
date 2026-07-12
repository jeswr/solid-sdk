// AUTHORED-BY Claude Sonnet 5
"use client";
/**
 * SafetyContext UI inputs (DESIGN §4.4, suite-tracker-ov8g deliverable 2) — feeds
 * EXACTLY the fields {@link import("@/lib/inference/types").SafetyContext} already
 * accepts: the confirmed-coeliac toggle, the alarm-symptom checklist, and the
 * strict-adherence toggle. Nothing here invents a field the engine doesn't
 * consume — the alarm checklist keys are drawn directly from
 * `SafetyContext["alarmFlags"]`, not hard-coded separately, so the two can never
 * drift. A change is handed to the caller (`InsightsView`), which persists it via
 * `useSafetyContextCache` (WebID-scoped, cache-only, never networked).
 */
import type { SafetyContext } from "@/lib/inference/types";

type AlarmFlags = NonNullable<SafetyContext["alarmFlags"]>;

const ALARM_LABELS: Record<keyof AlarmFlags, string> = {
  unintendedWeightLoss: "Unintended weight loss",
  giBleeding: "Gastrointestinal bleeding",
  persistentVomiting: "Persistent vomiting",
  dysphagia: "Difficulty swallowing",
  anaemia: "Anaemia",
};

const ALARM_KEYS = Object.keys(ALARM_LABELS) as (keyof AlarmFlags)[];

export interface SafetyContextFormProps {
  value: SafetyContext;
  onChange: (next: SafetyContext) => void;
}

export function SafetyContextForm({ value, onChange }: SafetyContextFormProps) {
  const flags: AlarmFlags = value.alarmFlags ?? {};
  return (
    <details className="safety-context-form">
      <summary className="safety-context-form__summary">Tell the app about your situation</summary>
      <p className="safety-context-form__note">
        These answers stay on THIS DEVICE only — never sent anywhere — and change how Insights
        frames what it shows you (e.g. whether it can suggest a gluten test).
      </p>
      <label className="safety-context-form__toggle">
        <input
          type="checkbox"
          checked={value.coeliacDiagnosed === true}
          onChange={(e) => onChange({ ...value, coeliacDiagnosed: e.target.checked })}
        />
        I have a CONFIRMED coeliac diagnosis (blood test + biopsy)
      </label>
      <label className="safety-context-form__toggle">
        <input
          type="checkbox"
          checked={value.strictAdherence === true}
          onChange={(e) => onChange({ ...value, strictAdherence: e.target.checked })}
        />
        I follow my diet strictly and still get symptoms
      </label>
      <fieldset className="safety-context-form__alarms">
        <legend>Have you had any of these recently? (please see a doctor if so)</legend>
        {ALARM_KEYS.map((key) => (
          <label key={key} className="safety-context-form__toggle">
            <input
              type="checkbox"
              checked={flags[key] === true}
              onChange={(e) => onChange({ ...value, alarmFlags: { ...flags, [key]: e.target.checked } })}
            />
            {ALARM_LABELS[key]}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
