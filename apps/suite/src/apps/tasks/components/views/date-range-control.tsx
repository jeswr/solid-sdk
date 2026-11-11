// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { DateTimeField, type DateTimeValue } from "@jeswr/suite-ui/date-time";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { replaceQuery } from "../../lib/route/replace-query";
import {
  completedRanges,
  type DateRange,
  parseDateRange,
  presetRange,
  type RangePreset,
  upcomingRanges,
  validRange,
} from "../../lib/views/date-ranges";
import { localDayKey } from "../../lib/views/days";
import { useTasksPreferences } from "../../state/preferences";

export function useTaskDateRange(kind: "upcoming" | "completed", now: Date) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { preferences } = useTasksPreferences();
  const fallback = presetRange(kind === "upcoming" ? "next7" : "last7", now, preferences.weekStart);
  const range = parseDateRange(new URLSearchParams(params.toString()), fallback);
  const change = (next: DateRange) => {
    const query = new URLSearchParams(params.toString());
    query.set("from", next.from);
    query.set("to", next.to);
    replaceQuery(pathname, query);
  };
  return { range, change, weekStart: preferences.weekStart };
}

export function DateRangeControl({
  kind,
  now,
  range,
  onChange,
}: {
  kind: "upcoming" | "completed";
  now: Date;
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { preferences } = useTasksPreferences();
  const options = kind === "upcoming" ? upcomingRanges : completedRanges;
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(range);
  useEffect(() => setDraft({ from: range.from, to: range.to }), [range.from, range.to]);
  const selected =
    Object.keys(options).find((key) => {
      const preset = presetRange(key as RangePreset, now, preferences.weekStart);
      return preset.from === range.from && preset.to === range.to;
    }) ?? "custom";
  const update = (bound: "from" | "to", value: DateTimeValue | null) => {
    const date =
      value === null
        ? ""
        : value.kind === "date"
          ? value.date
          : localDayKey(new Date(value.dateTime));
    const next = { ...draft, [bound]: date };
    setDraft(next);
    if (validRange(next)) onChange(next);
  };
  return (
    <div className="tsk-date-range">
      <label>
        Date range
        <select
          value={custom ? "custom" : selected}
          onChange={(event) => {
            const value = event.target.value;
            setCustom(value === "custom");
            setDraft(range);
            if (value !== "custom")
              onChange(presetRange(value as RangePreset, now, preferences.weekStart));
          }}
        >
          {Object.entries(options).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {(custom || selected === "custom") && (
        <>
          <DateTimeField
            label="From"
            locale="en-GB"
            referenceDate={now}
            value={draft.from ? { kind: "date", date: draft.from } : null}
            onChange={(value) => update("from", value)}
          />
          <DateTimeField
            label="To"
            locale="en-GB"
            referenceDate={now}
            value={draft.to ? { kind: "date", date: draft.to } : null}
            onChange={(value) => update("to", value)}
          />
          {!validRange(draft) && <p role="alert">Enter a From date on or before the To date.</p>}
        </>
      )}
    </div>
  );
}
