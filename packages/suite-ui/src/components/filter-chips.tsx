// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

export interface FilterChip {
  id: string;
  label: string;
  disabled?: boolean;
}
export interface FilterChipsProps {
  label: string;
  options: readonly FilterChip[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  resultCount: number;
}

export function FilterChips({ label, options, value, onChange, resultCount }: FilterChipsProps) {
  return (
    <div className="suite-filter-chips">
      <fieldset className="suite-chip-row">
        <legend className="suite-sr-only">{label}</legend>
        {options.map((option) => (
          <button
            key={option.id}
            className="suite-chip"
            type="button"
            aria-pressed={value.includes(option.id)}
            disabled={option.disabled}
            onClick={() =>
              onChange(
                value.includes(option.id)
                  ? value.filter((id) => id !== option.id)
                  : [...value, option.id],
              )
            }
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className="suite-button suite-small suite-ghost"
          disabled={!value.length}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      </fieldset>
      <p className="suite-hint" role="status" aria-live="polite" aria-atomic="true">
        {resultCount} {resultCount === 1 ? "result" : "results"}
      </p>
    </div>
  );
}
