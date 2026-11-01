// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { enGB, enUS } from "react-day-picker/locale";

/** Minimal single-month shadcn Calendar anatomy, backed by React DayPicker. */
export function Calendar({ accountLocale, ...props }: DayPickerProps & { accountLocale: string }) {
  return (
    <DayPicker
      showOutsideDays
      locale={accountLocale.toLowerCase() === "en-gb" ? enGB : enUS}
      className="suite-calendar"
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.75} />
          ) : (
            <ChevronRight aria-hidden="true" size={16} strokeWidth={1.75} />
          ),
      }}
      {...props}
    />
  );
}
