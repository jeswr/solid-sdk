// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { useId } from "react";
import { DEMO_FIELD_HINT } from "./disclaimers.js";

export interface DemoLockedFieldProps {
  label: string;
  /** The prefilled demo-persona value. */
  value: string;
  name?: string | undefined;
  /**
   * Locked (default) renders a read-only input. Editable fields stay prefilled and keep
   * the "do not enter real information" hint. Free-entry fields for government-ID or
   * date-of-birth formats are banned outright — do not build them with or without this
   * component.
   */
  editable?: boolean | undefined;
  /**
   * Supplemental hint text appended AFTER the mandatory hint. The
   * "do not enter real information" warning itself always renders and cannot be
   * replaced or removed.
   */
  hint?: string | undefined;
  className?: string | undefined;
}

/**
 * Demo-locked form field: prefilled from a demo persona, read-only by default, and
 * always accompanied by a "do not enter real information" hint wired via aria-describedby.
 */
export function DemoLockedField({
  label,
  value,
  name,
  editable = false,
  hint,
  className,
}: DemoLockedFieldProps) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className={cn("grid gap-1.5", className)} data-demo-locked-field="">
      <label className="text-sm font-medium" htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={hintId}
        className={cn(
          "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground",
          !editable && "bg-muted text-muted-foreground",
        )}
        id={inputId}
        name={name}
        type="text"
        {...(editable ? { defaultValue: value } : { readOnly: true, value })}
      />
      <p className="text-xs text-muted-foreground" id={hintId}>
        {hint === undefined ? DEMO_FIELD_HINT : `${DEMO_FIELD_HINT} ${hint}`}
      </p>
    </div>
  );
}
