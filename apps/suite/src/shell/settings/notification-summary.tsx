// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jeswr/suite-ui";
import { useId } from "react";
import type { Preferences } from "../lib/settings-preferences";
import { usePreferences } from "./preferences";

export function NotificationSummarySettings() {
  const { value, update } = usePreferences("summary");
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Summary</h2>
      <p>
        Bundle notifications into a short summary. Your first summary is ready when you turn this
        on.
      </p>
      <label htmlFor={`${id}-schedule`}>Summary schedule</label>
      <Select
        value={value.mode}
        onValueChange={(mode) => update({ ...value, mode: mode as Preferences["summary"]["mode"] })}
      >
        <SelectTrigger id={`${id}-schedule`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="hourly">Every hour</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="twice-daily">Twice a day</SelectItem>
        </SelectContent>
      </Select>
      {(value.mode === "daily" || value.mode === "twice-daily") && (
        <div className="settings-choice-row">
          <label htmlFor={`${id}-time`}>
            Summary time
            <Input
              id={`${id}-time`}
              type="time"
              value={value.time}
              onChange={(event) => update({ ...value, time: event.target.value })}
            />
          </label>
          {value.mode === "twice-daily" && (
            <label htmlFor={`${id}-second`}>
              Second summary time
              <Input
                id={`${id}-second`}
                type="time"
                value={value.secondTime}
                onChange={(event) => update({ ...value, secondTime: event.target.value })}
              />
            </label>
          )}
        </div>
      )}
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={value.urgentImmediately}
          onChange={(event) => update({ ...value, urgentImmediately: event.target.checked })}
        />
        Deliver urgent notifications immediately
      </label>
      <p>Summary times use this device's time zone and respect quiet hours.</p>
    </section>
  );
}
