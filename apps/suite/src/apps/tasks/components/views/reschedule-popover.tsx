// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Popover, PopoverAnchor, PopoverContent } from "@jeswr/suite-ui";
import { DatePickerPopover, type DateTimeValue } from "@jeswr/suite-ui/date-time";
import { type ReactNode, useState } from "react";
import { addDays, localDayKey } from "../../lib/views/days";
import { useNow } from "../../state/clock";

/** A day-only choice deliberately retains each task's existing wall time. */
export function ReschedulePopover({
  open,
  onOpenChange,
  onSelect,
  children,
  onCloseFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (dayKey: string) => void;
  children: ReactNode;
  onCloseFocus?: () => void;
}) {
  const now = useNow();
  const [picked, setPicked] = useState<DateTimeValue | null>(null);
  const select = (key: string) => {
    onOpenChange(false);
    onSelect(key);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        aria-label="Reschedule"
        align="end"
        className="tsk-reschedule-popover"
        onCloseAutoFocus={(event) => {
          if (onCloseFocus) {
            event.preventDefault();
            onCloseFocus();
          }
        }}
      >
        <div className="tsk-date-presets">
          {[
            ["Today", 0],
            ["Tomorrow", 1],
            ["Next week", 7],
          ].map(([label, offset]) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              onClick={() => select(localDayKey(addDays(now, Number(offset))))}
            >
              {label}
            </Button>
          ))}
        </div>
        <DatePickerPopover
          label="Pick date"
          locale="en-GB"
          today={now}
          value={picked}
          onChange={setPicked}
        />
        <Button
          type="button"
          disabled={!picked}
          onClick={() => {
            if (picked)
              select(picked.kind === "date" ? picked.date : localDayKey(new Date(picked.dateTime)));
          }}
        >
          Reschedule
        </Button>
      </PopoverContent>
    </Popover>
  );
}
