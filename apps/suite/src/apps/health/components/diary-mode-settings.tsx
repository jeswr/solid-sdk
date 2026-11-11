// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { TRIGGER_SLUGS, type TriggerSlug } from "@jeswr/solid-health-diary";
import { Button } from "@jeswr/suite-ui";
import { useDiaryMode } from "../state/diary-mode-context";

export function DiaryModeSettings() {
  const mode = useDiaryMode();
  const disabled = mode.loading || mode.saving;
  return (
    <section className="hlt-diary-window" aria-label="Food intolerance settings">
      <label>
        <input
          type="checkbox"
          checked={mode.enabled}
          disabled={disabled}
          onChange={(event) => {
            void mode.save({ ...mode.preferences, enabled: event.target.checked });
          }}
        />
        Track a food intolerance
      </label>
      {mode.enabled && (
        <>
          <label htmlFor="hlt-diary-trigger">Trigger class</label>
          <select
            id="hlt-diary-trigger"
            value={mode.trigger}
            disabled={disabled}
            onChange={(event) => {
              mode.chooseTrigger(event.target.value as TriggerSlug);
            }}
          >
            {TRIGGER_SLUGS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {trigger.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </>
      )}
      {mode.visitOnly && (
        <div>
          <p>Food intolerance tracking is on for this visit.</p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              void mode.save({ enabled: true, trigger: mode.trigger });
            }}
          >
            Keep it on
          </Button>
        </div>
      )}
      {mode.loading && <p role="status">Loading diary settings</p>}
      {mode.error && <p role="alert">{mode.error}</p>}
    </section>
  );
}
