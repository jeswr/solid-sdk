// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isDate } from "./date-value.js";
import {
  type Frequency,
  frequencies,
  type RecurrenceRule,
  validateRecurrence,
  type Weekday,
  weekdays,
} from "./recurrence.js";

export interface RecurrenceEditorProps {
  label?: string;
  locale: string;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** Initial due date; omitted BY parts otherwise default to the caller's DTSTART. */
  startDate: string;
  disabled?: boolean;
}
const frequencyLabels = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

function NumberField({
  label,
  value,
  onChange,
  max = 2_147_483_647,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valid = /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= max;
  const error = valid ? "" : `Enter a whole number from 1 to ${max}.`;
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  return (
    <div className="suite-date-stack">
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        className="suite-date-control"
        type="number"
        min={1}
        max={max}
        step={1}
        value={text}
        required
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : `${id}-error`}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (/^\d+$/.test(next) && Number(next) >= 1 && Number(next) <= max)
            onChange(Number(next));
        }}
      />
      {!valid && (
        <p id={`${id}-error`} role="alert" className="suite-date-error">
          {error}
        </p>
      )}
    </div>
  );
}
function weekdayName(day: Weekday, locale: string, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 5 + weekdays.indexOf(day))),
  );
}
export function recurrenceSummary(rule: RecurrenceRule | null, locale: string): string {
  if (!rule) return "Does not repeat";
  const unit = frequencyLabels[rule.freq];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.byDay)
    text += ` on ${rule.bySetPos ? `${rule.bySetPos === -1 ? "last" : ["", "first", "second", "third", "fourth", "fifth"][rule.bySetPos]} ` : ""}${rule.byDay.map((d) => weekdayName(d, locale)).join(", ")}`;
  if (rule.byMonth)
    text += ` in ${rule.byMonth.map((m) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)))).join(", ")}`;
  else if (rule.freq === "YEARLY" && rule.byMonthDay) text += " in all months";
  if (rule.byMonthDay)
    text += ` on ${rule.byMonthDay.map((d) => (d === -1 ? "the last day" : `day ${d}`)).join(", ")}`;
  if (rule.count) text += `, ${rule.count} ${rule.count === 1 ? "occurrence" : "occurrences"}`;
  if (rule.until)
    text += `, until ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(rule.until.length === 10 ? `${rule.until}T12:00:00Z` : rule.until))}`;
  return text;
}

export function RecurrenceEditor({
  label = "Repeat",
  locale,
  value,
  onChange,
  startDate,
  disabled = false,
}: RecurrenceEditorProps) {
  const id = useId();
  const signature = JSON.stringify(value);
  const emitted = useRef(signature);
  const [rule, setRule] = useState<RecurrenceRule | null>(value);
  const [dateError, setDateError] = useState(false);
  const [untilText, setUntilText] = useState(rule?.until?.slice(0, 10) ?? "");
  useEffect(() => {
    if (emitted.current !== signature) {
      setRule(value);
      setDateError(false);
      setUntilText(value?.until?.slice(0, 10) ?? "");
      emitted.current = signature;
    }
  }, [signature, value]);
  useEffect(() => setUntilText(rule?.until?.slice(0, 10) ?? ""), [rule?.until]);
  if (!isDate(startDate)) throw new RangeError("startDate must be a valid YYYY-MM-DD date");
  const safeStart = startDate;
  const seed = new Date(`${safeStart}T12:00:00`);
  const weekday = weekdays[(seed.getDay() + 6) % 7] as Weekday;
  const selectedWeekdays = rule?.byDay ?? [weekday];
  const update = (next: RecurrenceRule | null) => {
    setRule(next);
    if (next) {
      try {
        validateRecurrence(next);
      } catch {
        return;
      }
    }
    emitted.current = JSON.stringify(next);
    onChange(next);
  };
  const end = rule?.count !== undefined ? "after" : rule?.until ? "on" : "never";
  const invalidWeek = rule?.freq === "WEEKLY" && rule.byDay?.length === 0;
  const showMonthDay =
    rule?.freq === "YEARLY" || (rule?.freq === "MONTHLY" && rule.bySetPos === undefined);
  const allMonths = rule?.freq === "YEARLY" && !rule.byMonth && rule.byMonthDay !== undefined;
  return (
    <fieldset className="suite-recurrence suite-date-stack" disabled={disabled}>
      <legend>{label}</legend>
      <label className="suite-date-stack" htmlFor={`${id}-frequency`}>
        Frequency
        <select
          id={`${id}-frequency`}
          className="suite-date-control"
          value={rule?.freq ?? "none"}
          onChange={(event) => {
            setDateError(false);
            const freq = event.target.value as Frequency | "none";
            if (freq === "none") {
              update(null);
              return;
            }
            const next: RecurrenceRule = {
              freq,
              interval: rule?.interval ?? 1,
              ...(rule?.count !== undefined ? { count: rule.count } : {}),
              ...(rule?.until ? { until: rule.until } : {}),
            };
            if (freq === "WEEKLY") next.byDay = [weekday];
            if (freq === "MONTHLY" || freq === "YEARLY") next.byMonthDay = [seed.getDate()];
            if (freq === "YEARLY") next.byMonth = [seed.getMonth() + 1];
            update(next);
          }}
        >
          <option value="none">Does not repeat</option>
          {frequencies.map((freq) => (
            <option key={freq} value={freq}>
              {freq.charAt(0) + freq.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      {rule && (
        <>
          <NumberField
            label={`Repeat every (${frequencyLabels[rule.freq]}s)`}
            value={rule.interval}
            onChange={(interval) => update({ ...rule, interval })}
          />
          {rule.freq === "WEEKLY" && (
            <fieldset className="suite-date-stack suite-date-subgroup">
              <legend>On weekdays</legend>
              <div className="suite-date-weekdays">
                {weekdays.map((day) => (
                  <label key={day} className="suite-date-check">
                    <input
                      type="checkbox"
                      checked={selectedWeekdays.includes(day)}
                      aria-invalid={Boolean(invalidWeek)}
                      required={Boolean(invalidWeek)}
                      aria-describedby={invalidWeek ? `${id}-week-error` : undefined}
                      onChange={(event) => {
                        const byDay = weekdays.filter((d) =>
                          d === day ? event.target.checked : selectedWeekdays.includes(d),
                        );
                        update({ ...rule, byDay });
                      }}
                    />
                    <span title={weekdayName(day, locale, "long")}>{weekdayName(day, locale)}</span>
                    <span className="suite-date-sr-only">
                      {" "}
                      ({weekdayName(day, locale, "long")})
                    </span>
                  </label>
                ))}
              </div>
              {invalidWeek && (
                <p id={`${id}-week-error`} role="alert" className="suite-date-error">
                  Choose at least one weekday.
                </p>
              )}
            </fieldset>
          )}
          {rule.freq === "MONTHLY" && (
            <>
              <label className="suite-date-stack" htmlFor={`${id}-monthly`}>
                Monthly pattern
                <select
                  id={`${id}-monthly`}
                  className="suite-date-control"
                  value={rule.bySetPos !== undefined ? "weekday" : "day"}
                  onChange={(event) => {
                    const { byDay: _day, bySetPos: _pos, byMonthDay: _monthDay, ...rest } = rule;
                    update(
                      event.target.value === "weekday"
                        ? { ...rest, byDay: [weekday], bySetPos: Math.ceil(seed.getDate() / 7) }
                        : { ...rest, byMonthDay: [seed.getDate()] },
                    );
                  }}
                >
                  <option value="day">Day of the month</option>
                  <option value="weekday">Nth weekday</option>
                </select>
              </label>
              {rule.bySetPos !== undefined && (
                <div className="suite-date-columns">
                  <label className="suite-date-stack" htmlFor={`${id}-ordinal`}>
                    Which week
                    <select
                      id={`${id}-ordinal`}
                      className="suite-date-control"
                      value={rule.bySetPos}
                      onChange={(event) =>
                        update({ ...rule, bySetPos: Number(event.target.value) })
                      }
                    >
                      {["First", "Second", "Third", "Fourth", "Fifth", "Last"].map((word, i) => (
                        <option key={word} value={i === 5 ? -1 : i + 1}>
                          {word}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="suite-date-stack" htmlFor={`${id}-weekday`}>
                    Weekday
                    <select
                      id={`${id}-weekday`}
                      className="suite-date-control"
                      value={rule.byDay?.[0]}
                      onChange={(event) =>
                        update({ ...rule, byDay: [event.target.value as Weekday] })
                      }
                    >
                      {weekdays.map((day) => (
                        <option key={day} value={day}>
                          {weekdayName(day, locale, "long")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
          {showMonthDay && (
            <label className="suite-date-stack" htmlFor={`${id}-day`}>
              Day of month
              <select
                id={`${id}-day`}
                className="suite-date-control"
                value={rule.byMonthDay?.[0] ?? seed.getDate()}
                onChange={(event) =>
                  update({
                    ...rule,
                    byMonthDay: [Number(event.target.value)],
                    ...(rule.freq === "YEARLY" && !rule.byMonth && !rule.byMonthDay
                      ? { byMonth: [seed.getMonth() + 1] }
                      : {}),
                  })
                }
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
                <option value={-1}>Last day</option>
              </select>
            </label>
          )}
          {rule.freq === "YEARLY" && (
            <label className="suite-date-stack" htmlFor={`${id}-month`}>
              Month
              <select
                id={`${id}-month`}
                className="suite-date-control"
                value={allMonths ? "all" : (rule.byMonth?.[0] ?? seed.getMonth() + 1)}
                onChange={(event) => update({ ...rule, byMonth: [Number(event.target.value)] })}
              >
                {allMonths && (
                  <option value="all" disabled>
                    All months
                  </option>
                )}
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
                      new Date(Date.UTC(2026, month - 1, 1)),
                    )}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showMonthDay && <p className="suite-date-note">Months without this day are skipped.</p>}
          <label className="suite-date-stack" htmlFor={`${id}-ends`}>
            Ends
            <select
              id={`${id}-ends`}
              className="suite-date-control"
              value={end}
              onChange={(event) => {
                const { count: _count, until: _until, ...rest } = rule;
                setDateError(false);
                update(
                  event.target.value === "after"
                    ? { ...rest, count: 10 }
                    : event.target.value === "on"
                      ? { ...rest, until: safeStart }
                      : rest,
                );
              }}
            >
              <option value="never">Never</option>
              <option value="after">After a number of occurrences</option>
              <option value="on">On a date</option>
            </select>
          </label>
          {end === "after" && (
            <NumberField
              label="Occurrences"
              value={rule.count as number}
              onChange={(count) => update({ ...rule, count })}
            />
          )}
          {end === "on" && (
            <div className="suite-date-stack">
              <label htmlFor={`${id}-until`}>End date</label>
              <input
                id={`${id}-until`}
                className="suite-date-control"
                type="date"
                value={untilText}
                required
                aria-invalid={dateError}
                aria-describedby={dateError ? `${id}-date-error` : undefined}
                onChange={(event) => {
                  const next = event.target.value;
                  setUntilText(next);
                  const valid = isDate(next);
                  setDateError(!valid);
                  if (valid) update({ ...rule, until: next });
                }}
              />
              {dateError && (
                <p id={`${id}-date-error`} role="alert" className="suite-date-error">
                  Enter an end date.
                </p>
              )}
            </div>
          )}
        </>
      )}
      <p role="status" className="suite-date-note">
        {invalidWeek
          ? "Choose weekdays to finish this repeat pattern."
          : recurrenceSummary(rule, locale)}
      </p>
    </fieldset>
  );
}
