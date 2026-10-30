// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type DateTimeValue, formatDateTime, parseDateTime } from "./date-value.js";
import { useLocalTimeZone } from "./use-local-time-zone.js";

export interface DateTimeFieldProps {
  label: string;
  /** Pass the active account's locale. */
  locale: string;
  value: DateTimeValue | null;
  onChange: (value: DateTimeValue | null) => void;
  referenceDate?: Date;
  disabled?: boolean;
  /** An initial draft, useful when restoring an unfinished edit. */
  initialText?: string;
}
export function DateTimeField({
  label,
  locale,
  value,
  onChange,
  referenceDate,
  disabled = false,
  initialText,
}: DateTimeFieldProps) {
  const id = useId();
  const timeZone = useLocalTimeZone();
  const input = useRef<HTMLInputElement>(null);
  const [clock] = useState(() => new Date());
  const signature = JSON.stringify(value);
  const emitted = useRef(signature);
  const [text, setText] = useState(
    initialText ?? (value ? formatDateTime(value, locale, timeZone ?? "UTC") : ""),
  );
  const [editing, setEditing] = useState(initialText !== undefined);
  const previousLocale = useRef(locale);
  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    if (!editing) return;
    const result = parseDateTime(text, locale, referenceDate ?? clock);
    if (result.status !== "invalid") {
      const next = result.status === "valid" ? result.value : null;
      emitted.current = JSON.stringify(next);
      onChange(next);
    }
  }, [locale, editing, text, referenceDate, clock, onChange]);
  useEffect(() => {
    if (emitted.current !== signature) {
      setText(value ? formatDateTime(value, locale, timeZone ?? "UTC") : "");
      setEditing(false);
      emitted.current = signature;
    }
  }, [signature, value, locale, timeZone]);
  const parsed =
    editing && timeZone !== undefined ? parseDateTime(text, locale, referenceDate ?? clock) : null;
  const error = parsed?.status === "invalid" ? parsed.message : "";
  const interpreted = parsed?.status === "valid" ? parsed.value : !editing ? value : null;
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  return (
    <div className="suite-date-field suite-date-stack">
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        className="suite-date-control"
        type="text"
        value={editing ? text : value ? formatDateTime(value, locale, timeZone ?? "UTC") : ""}
        disabled={disabled}
        placeholder="Tomorrow 5pm"
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint ${id}-result`}
        onChange={(event) => {
          const draft = event.target.value;
          setText(draft);
          setEditing(true);
          const result = parseDateTime(draft, locale, referenceDate ?? clock);
          if (result.status !== "invalid") {
            const next = result.status === "valid" ? result.value : null;
            emitted.current = JSON.stringify(next);
            onChange(next);
          }
        }}
      />
      <p id={`${id}-hint`} className="suite-date-note">
        Try tomorrow 5pm or next Mon.
      </p>
      <p
        id={`${id}-result`}
        role={error ? "alert" : "status"}
        className={error ? "suite-date-error" : "suite-date-note"}
      >
        {error ||
          (interpreted
            ? `${formatDateTime(interpreted, locale, timeZone ?? "UTC")}${interpreted.kind === "date" ? " · All day" : ""}`
            : "No date selected")}
      </p>
    </div>
  );
}
