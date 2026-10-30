// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Calendar } from "./calendar.js";
import { type DateTimeValue, formatDateTime, localDate, valueDate } from "./date-value.js";

export interface DatePickerPopoverProps {
  label: string;
  locale: string;
  value: DateTimeValue | null;
  onChange: (value: DateTimeValue | null) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
  /** Clock seam used for an empty calendar's initial month. */
  today?: Date;
}
export function DatePickerPopover({
  label,
  locale,
  value,
  onChange,
  disabled = false,
  defaultOpen = false,
  today,
}: DatePickerPopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen && !disabled);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const [clock] = useState(() => today ?? new Date());
  const [emptyAllDay, setEmptyAllDay] = useState(true);
  const [time, setTime] = useState("09:00");
  const date = value ? valueDate(value) : undefined;
  const allDay = value ? value.kind === "date" : emptyAllDay;
  const currentTime =
    value?.kind === "dateTime" && date
      ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : time;
  const select = (selected: Date, dayOnly: boolean, hours = currentTime) => {
    if (disabled) return;
    if (dayOnly) onChange({ kind: "date", date: localDate(selected) });
    else {
      const [h, m] = hours.split(":").map(Number);
      const next = new Date(selected);
      next.setHours(h ?? 9, m ?? 0, 0, 0);
      onChange({ kind: "dateTime", dateTime: next.toISOString() });
    }
  };
  return (
    <div className="suite-date-stack">
      <span id={`${id}-label`}>{label}</span>
      <Popover.Root open={open && !disabled} onOpenChange={(next) => setOpen(next && !disabled)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="suite-date-button"
            aria-labelledby={`${id}-label ${id}-value`}
          >
            <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
            <span id={`${id}-value`}>
              {value
                ? `${formatDateTime(value, locale)}${allDay ? " · All day" : ""}`
                : "Choose a date"}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={label}
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="suite-date-popover"
          >
            <div className="suite-date-stack">
              <Calendar
                accountLocale={locale}
                mode="single"
                selected={date}
                defaultMonth={date ?? clock}
                today={clock}
                disabled={disabled}
                autoFocus
                onSelect={(selected) => {
                  if (selected) select(selected, allDay);
                }}
              />
              <label className="suite-date-check">
                <input
                  type="checkbox"
                  checked={allDay}
                  disabled={disabled}
                  onChange={(event) => {
                    if (disabled) return;
                    const next = event.target.checked;
                    setEmptyAllDay(next);
                    setTime(currentTime);
                    if (date) select(date, next);
                  }}
                />{" "}
                All day
              </label>
              <label className="suite-date-stack" htmlFor={`${id}-time`}>
                Time
                <input
                  id={`${id}-time`}
                  className="suite-date-control"
                  type="time"
                  value={currentTime}
                  disabled={disabled || allDay || !date}
                  required={!allDay}
                  onChange={(event) => {
                    if (disabled) return;
                    const next = event.target.value;
                    if (!/^\d{2}:\d{2}$/.test(next)) return;
                    setTime(next);
                    if (date) select(date, false, next);
                  }}
                />
              </label>
              {!date && <p className="suite-date-note">Choose a day to set a time.</p>}
              <div className="suite-date-actions">
                <button
                  className="suite-date-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
                <Popover.Close asChild>
                  <button className="suite-date-button suite-date-primary" type="button">
                    Done
                  </button>
                </Popover.Close>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="suite-date-sr-only" role="status">
        {value
          ? `${formatDateTime(value, locale)}${allDay ? " · All day" : ""}`
          : "No date selected"}
      </span>
    </div>
  );
}
