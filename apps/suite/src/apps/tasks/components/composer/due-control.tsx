// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@jeswr/suite-ui";
import { DatePickerPopover, type DateTimeValue } from "@jeswr/suite-ui/date-time";
import { useState } from "react";
import { type ComposeContext, type ComposeDue, parseQuickAdd } from "../../lib/compose/quick-add";

export function DueControl({
  label,
  value,
  context,
  onChange,
}: {
  label: string;
  value: ComposeDue | undefined;
  context: ComposeContext;
  onChange: (due: ComposeDue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(context.now);
  const dateValue: DateTimeValue | null = !value
    ? null
    : value.allDay
      ? { kind: "date", date: value.allDay }
      : { kind: "dateTime", dateTime: value.date.toISOString() };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setNow(new Date());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="tsk-composer-popover" aria-label="Due date" align="start">
        <div className="tsk-date-presets">
          {[
            ["Today", "today"],
            ["Tomorrow", "tomorrow"],
            ["Next week", "in 7 days"],
          ].map(([copy, phrase]) => (
            <Button
              key={copy}
              type="button"
              variant="ghost"
              onClick={() => {
                onChange(
                  parseQuickAdd(`Task ${phrase}`, {
                    ...context,
                    now: new Date(),
                    keepText: new Set(),
                  }).due ?? null,
                );
                setOpen(false);
              }}
            >
              {copy}
            </Button>
          ))}
        </div>
        <DatePickerPopover
          label="Pick date"
          locale={context.locale ?? "en-GB"}
          today={now}
          value={dateValue}
          onChange={(next) => {
            onChange(
              next?.kind === "date"
                ? { date: new Date(`${next.date}T00:00:00`), allDay: next.date }
                : next
                  ? { date: new Date(next.dateTime) }
                  : null,
            );
          }}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          No due date
        </Button>
      </PopoverContent>
    </Popover>
  );
}
