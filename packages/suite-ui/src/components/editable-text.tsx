// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

export interface EditableTextProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | undefined;
  disabled?: boolean;
}

export function EditableText({
  label,
  value,
  onCommit,
  validate,
  disabled = false,
}: EditableTextProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      button.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const start = () => {
    setDraft(value);
    setError(undefined);
    setEditing(true);
  };
  const finish = () => {
    restoreFocus.current = true;
    setEditing(false);
  };
  return (
    <div className="suite-field">
      <label htmlFor={editing ? id : undefined} className="suite-label">
        {label}
      </label>
      {editing ? (
        <>
          <input
            ref={input}
            id={id}
            className="suite-input"
            value={draft}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                const message = validate?.(draft);
                if (message) {
                  setError(message);
                  return;
                }
                onCommit(draft);
                finish();
              }
            }}
          />
          <p id={`${id}-help`} className="suite-hint">
            Enter to save · Esc to cancel
          </p>
          {error && (
            <p id={`${id}-error`} className="suite-field-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <button
          ref={button}
          type="button"
          className="suite-editable"
          disabled={disabled}
          aria-label={`${label}: ${value || "Untitled"}`}
          onClick={start}
          onKeyDown={(event) => {
            if (event.key === "F2") {
              event.preventDefault();
              start();
            }
          }}
        >
          {value || "Untitled"}
        </button>
      )}
    </div>
  );
}
