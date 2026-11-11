// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@jeswr/suite-ui";
import { Bell, BellPlus } from "lucide-react";
import { useState } from "react";
import { formatReminder, reminderInput, reminderPreset } from "../lib/reminders/dates";

export function ReminderChip({
  value,
  now = new Date(),
}: {
  value: string | undefined;
  now?: Date;
}) {
  if (!value) return null;
  return (
    <div className="notes-labels">
      <span
        className="notes-chip notes-reminder-chip"
        data-overdue={Date.parse(value) <= now.getTime()}
      >
        <Bell size={12} aria-hidden="true" />
        <time dateTime={value}>{formatReminder(value, now)}</time>
      </span>
    </div>
  );
}

export function ReminderPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: string | undefined;
  disabled?: boolean;
  onChange: (reminder: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [input, setInput] = useState("");
  const choose = (reminder: string | null) => {
    if (disabled) return;
    setOpen(false);
    onChange(reminder);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setPicking(false);
        setInput(value ? reminderInput(value) : "");
      }}
    >
      <PopoverTrigger asChild>
        <IconButton label="Remind me" variant="ghost" disabled={disabled}>
          {value ? (
            <Bell size={18} aria-hidden="true" />
          ) : (
            <BellPlus size={18} aria-hidden="true" />
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="notes-popover notes-reminder-picker" aria-label="Note reminder">
        {(
          [
            ["today", "Later today"],
            ["tomorrow", "Tomorrow"],
            ["week", "Next week"],
          ] as const
        ).map(([preset, label]) => (
          <Button
            key={preset}
            variant="ghost"
            disabled={disabled}
            onClick={() => choose(reminderPreset(preset, new Date()).toISOString())}
          >
            {label}
          </Button>
        ))}
        <Button variant="ghost" disabled={disabled} onClick={() => setPicking(true)}>
          Pick date &amp; time
        </Button>
        {picking && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (Number.isFinite(Date.parse(input))) choose(new Date(input).toISOString());
            }}
          >
            <Input
              type="datetime-local"
              aria-label="Reminder date and time"
              value={input}
              disabled={disabled}
              onChange={(event) => setInput(event.target.value)}
              required
            />
            <Button type="submit" disabled={disabled || !Number.isFinite(Date.parse(input))}>
              Save
            </Button>
          </form>
        )}
        {value && (
          <Button variant="ghost" disabled={disabled} onClick={() => choose(null)}>
            Remove reminder
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
