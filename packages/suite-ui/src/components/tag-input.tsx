// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface TagOption {
  id: string;
  label: string;
}
export interface TagInputProps {
  label: string;
  options: readonly TagOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** Supplied options are local; persistence and suggestion fetching belong to the consumer. */
export function TagInput({ label, options, value, onChange, disabled = false }: TagInputProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const matches = options.filter(
    (option) =>
      !value.includes(option.id) &&
      option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const activeIndex = matches.findIndex((option) => option.id === active);
  useEffect(() => {
    if (open && activeIndex >= 0)
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);
  const selected = value.map(
    (tag) => options.find((option) => option.id === tag) ?? { id: tag, label: tag },
  );
  function add(option: TagOption) {
    onChange([...value, option.id]);
    setQuery("");
    setActive(undefined);
    setOpen(false);
    setAnnouncement(`${option.label} added`);
    input.current?.focus();
  }
  function remove(tag: TagOption) {
    onChange(value.filter((item) => item !== tag.id));
    setAnnouncement(`${tag.label} removed`);
    input.current?.focus();
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Handles focus leaving the entire composite, not pointer activation.
    <div
      className="suite-field suite-tags"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(undefined);
        }
      }}
    >
      <label className="suite-label" htmlFor={id}>
        {label}
      </label>
      <div className="suite-tag-field" data-disabled={disabled || undefined}>
        {selected.map((tag) => (
          <span className="suite-tag" key={tag.id}>
            <span className="suite-tag-label">{tag.label}</span>
            <button
              type="button"
              className="suite-tag-remove"
              disabled={disabled}
              aria-label={`Remove ${tag.label}`}
              title={`Remove ${tag.label}`}
              onClick={() => remove(tag)}
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          className="suite-tag-query"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-options` : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-describedby={`${id}-help`}
          autoComplete="off"
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(undefined);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const next =
                activeIndex < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : matches.length - 1
                  : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
                    matches.length;
              setActive(matches[next]?.id);
            } else if (event.key === "Enter" && open && activeIndex >= 0) {
              event.preventDefault();
              const option = matches[activeIndex];
              if (option) add(option);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(undefined);
            } else if (event.key === "Backspace" && !query && selected.length) {
              const last = selected.at(-1);
              if (last) remove(last);
            }
          }}
        />
      </div>
      <p className="suite-hint" id={`${id}-help`}>
        Choose a label. Use arrow keys, then Enter.
      </p>
      {open && (
        <div className="suite-tag-options">
          <div
            id={`${id}-options`}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="suite-tag-list"
          >
            {matches.map((option, index) => (
              // Pointer selection keeps focus on the combobox; arrows and Enter provide the keyboard path.
              // biome-ignore lint/a11y/useFocusableInteractive: Focus stays on combobox via aria-activedescendant.
              // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard interaction is on the controlling combobox.
              <div
                id={`${id}-option-${index}`}
                key={option.id}
                role="option"
                aria-selected={active === option.id}
                className="suite-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(option)}
              >
                {option.label}
              </div>
            ))}
          </div>
          {!matches.length && (
            <p className="suite-hint suite-options-empty">
              {query
                ? `No results for '${query}'`
                : options.length
                  ? "All labels selected"
                  : "No labels yet"}
            </p>
          )}
        </div>
      )}
      <span className="suite-sr-only" role="status" aria-live="polite">
        {announcement || (open ? `${matches.length} suggestions` : "")}
      </span>
    </div>
  );
}
