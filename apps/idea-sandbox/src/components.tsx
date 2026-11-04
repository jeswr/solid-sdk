// AUTHORED-BY Claude Opus 5.5
import type { CallResult, GateDecision, Outcome, StepResult } from "@jeswr/agent-sandbox";
import { type ReactNode, useState } from "react";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  permit: "Allowed",
  review: "Review",
  stop: "Stop",
};
export const OUTCOME_TEXT: Record<Outcome, string> = {
  permit: "Allowed: it went ahead",
  review: "Held for a person",
  stop: "Stopped",
};

/** The outcome a call actually had. */
export function outcomeOfResult(result: CallResult): Outcome {
  return result.status === "held" ? "review" : result.status === "stopped" ? "stop" : "permit";
}

export function Chip({ outcome, children }: { outcome: Outcome; children?: ReactNode }) {
  return (
    <span className={`chip chip-${outcome}`}>
      <span className="chip-dot" aria-hidden="true" />
      {children ?? OUTCOME_LABEL[outcome]}
    </span>
  );
}

const STEP_NAMES: Record<StepResult["step"], string> = {
  catalogue: "Is the tool offered?",
  global: "The agent's rules",
  "data-read": "Rules on the records it read",
  "data-send": "Rules on the data it carries",
  limits: "Limits",
  judge: "AI model",
  approval: "A person",
};

/** The gate's reasoning, step by step. */
export function Steps({ decision }: { decision: GateDecision }) {
  return (
    <ol className="steps">
      {decision.steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed, ordered list per decision.
        <li key={i} className={`step step-${s.outcome}`}>
          <span className="step-mark" role="img" aria-label={OUTCOME_LABEL[s.outcome]}>
            {s.outcome === "permit" ? "✓" : s.outcome === "review" ? "?" : "✕"}
          </span>
          <span>
            <strong>{STEP_NAMES[s.step]}.</strong> {s.explanation}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Json({ value, max = 900 }: { value: unknown; max?: number }) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const [open, setOpen] = useState(text.length <= max);
  return (
    <div className="json">
      <pre>{open ? text : `${text.slice(0, max)}…`}</pre>
      {text.length > max && (
        <button type="button" className="text-button" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

export function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {intro && <p className="intro">{intro}</p>}
      {children}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  );
}
