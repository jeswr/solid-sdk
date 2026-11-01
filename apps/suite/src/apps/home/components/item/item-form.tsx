// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import type { DatasetCore, Term } from "@rdfjs/types";
import { useId, useState } from "react";
import type { FieldSpec } from "../../lib/forms/field-types";
import {
  FieldValidationError,
  readFieldValue,
  readFieldValues,
  toDatetimeLocal,
  valueToTerm,
} from "../../lib/forms/subject-edit";

/** Raw strings stay in React until submit; typed setters never run on partial keystrokes. */
export function ItemForm({
  fields,
  dataset,
  subject,
  blank = false,
  locked = false,
  online,
  busy,
  error,
  onSave,
  onCancel,
}: {
  fields: readonly FieldSpec[];
  dataset: DatasetCore;
  subject: string | Term;
  blank?: boolean;
  locked?: boolean;
  online: boolean;
  busy: boolean;
  error?: string | undefined;
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.id, blank ? "" : inputValue(dataset, subject, field)]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="hm-item-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const invalid: Record<string, string> = {};
        for (const field of fields) {
          if (field.readOnly) continue;
          const value = values[field.id] ?? "";
          if (field.required && !value.trim())
            invalid[field.id] = `Enter ${field.label.toLowerCase()}.`;
          else
            try {
              valueToTerm(field, value);
            } catch (error) {
              if (error instanceof FieldValidationError) invalid[field.id] = error.message;
            }
        }
        setErrors(invalid);
        if (Object.keys(invalid).length) {
          document
            .getElementById(`${id}-field-${fields.findIndex((field) => invalid[field.id])}`)
            ?.focus();
          return;
        }
        const edits = Object.fromEntries(
          fields
            .filter((field) => blank || values[field.id] !== inputValue(dataset, subject, field))
            .map((field) => [field.id, values[field.id] ?? ""]),
        );
        onSave(edits);
      }}
    >
      {fields.map((field, index) => {
        const inputId = `${id}-field-${index}`;
        const hint = errors[field.id] ?? field.hint;
        const props = {
          id: inputId,
          name: inputId,
          // Read-only text stays focusable so its values and hint can be read.
          disabled:
            busy ||
            locked ||
            (field.readOnly === true && ["boolean", "choice"].includes(field.kind)),
          readOnly: field.readOnly,
          required: field.required,
          "aria-invalid": Boolean(errors[field.id]),
          "aria-describedby": hint ? `${inputId}-hint` : undefined,
        };
        const change = (value: string) =>
          setValues((current) => ({ ...current, [field.id]: value }));
        return (
          <div className="hm-item-field" key={field.id}>
            <label htmlFor={inputId}>
              {field.label}
              {field.required ? " (required)" : ""}
            </label>
            {field.kind === "textarea" ? (
              <textarea
                {...props}
                value={values[field.id]}
                onChange={(event) => change(event.target.value)}
                rows={4}
              />
            ) : field.kind === "choice" && field.options ? (
              <select
                {...props}
                value={values[field.id]}
                onChange={(event) => change(event.target.value)}
              >
                <option value="">Choose…</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "boolean" ? (
              <input
                {...props}
                type="checkbox"
                checked={values[field.id] === "true" || values[field.id] === "1"}
                onChange={(event) => change(String(event.target.checked))}
              />
            ) : (
              <input
                {...props}
                type={
                  field.readOnly
                    ? "text"
                    : field.kind === "datetime"
                      ? "datetime-local"
                      : ["number", "decimal"].includes(field.kind)
                        ? "number"
                        : ["date", "email", "url", "tel"].includes(field.kind)
                          ? field.kind
                          : "text"
                }
                step={field.kind === "decimal" ? "any" : undefined}
                value={values[field.id]}
                onChange={(event) => change(event.target.value)}
              />
            )}
            {hint ? (
              <p id={`${inputId}-hint`} className={errors[field.id] ? "hm-item-error" : "hm-muted"}>
                {hint}
              </p>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p className="hm-item-error" role="alert">
          {error}
        </p>
      ) : null}
      {!online ? <p role="status">Reconnect to save</p> : null}
      <div className="hm-item-form-actions">
        <Button variant="outline" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!online || busy || !fields.length}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** datetime-local holds wall time in the user's time zone, never a sliced UTC string. */
function inputValue(dataset: DatasetCore, subject: string | Term, field: FieldSpec): string {
  // A read-only field shows every value it has (e.g. two emails), as plain text.
  if (field.readOnly) return readFieldValues(dataset, subject, field).join(", ");
  const value = readFieldValue(dataset, subject, field);
  return field.kind === "datetime" && value ? toDatetimeLocal(value) : value;
}
