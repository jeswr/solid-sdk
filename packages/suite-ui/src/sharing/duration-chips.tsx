// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { RadioGroup } from "radix-ui";
import { useId } from "react";
import type { DisabledReason } from "./role-select.js";

export type SharingDuration = "until-revoked" | "day" | "month" | "year" | "custom";
export const sharingDurations = [
  ["until-revoked", "Until revoked"],
  ["day", "1 day"],
  ["month", "1 month"],
  ["year", "1 year"],
  ["custom", "Custom"],
] as const;
export type DurationChipsProps = {
  value: SharingDuration;
  onChange: (value: SharingDuration) => void;
  customDate?: string;
  onCustomDateChange?: (date: string) => void;
} & DisabledReason;

export function DurationChips({
  value,
  onChange,
  customDate = "",
  onCustomDateChange,
  disabled = false,
  reason,
}: DurationChipsProps) {
  const id = useId();
  return (
    <fieldset
      className="su-fieldset su-stack"
      disabled={disabled}
      title={disabled ? reason : undefined}
      aria-describedby={disabled ? `${id}-reason` : undefined}
    >
      <legend className="su-label">Duration</legend>
      <RadioGroup.Root
        className="su-wrap"
        value={value}
        disabled={disabled}
        aria-label="Duration"
        aria-describedby={disabled ? `${id}-reason` : undefined}
        onValueChange={(next) => onChange(next as SharingDuration)}
      >
        {sharingDurations.map(([key, label]) => (
          <RadioGroup.Item className="su-chip" value={key} key={key}>
            {label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {value === "custom" && (
        <label className="su-stack" htmlFor={`${id}-date`}>
          Access ends on
          <input
            className="su-input"
            type="date"
            id={`${id}-date`}
            value={customDate}
            disabled={disabled}
            onChange={(event) => onCustomDateChange?.(event.target.value)}
          />
        </label>
      )}
      {disabled && (
        <p className="su-muted" id={`${id}-reason`}>
          {reason}
        </p>
      )}
    </fieldset>
  );
}
