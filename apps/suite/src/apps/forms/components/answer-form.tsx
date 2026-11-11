// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@jeswr/suite-ui";
import { useId, useState } from "react";
import type {
  FieldDescriptor,
  FormModel,
  FormRuntime,
  FormValues,
  ValidationResult,
} from "../lib/runtime";

function AnswerControl({
  field,
  value,
  change,
  id,
  invalid,
  describedBy,
}: {
  field: FieldDescriptor;
  value: FormValues[string] | undefined;
  change: (value: FormValues[string]) => void;
  id: string;
  invalid: boolean;
  describedBy: string;
}) {
  const common = { id, "aria-invalid": invalid, "aria-describedby": describedBy };
  if (
    field.kind === "node" ||
    (field.maxCount !== undefined && field.maxCount !== 1) ||
    field.minCount > 1
  )
    return <p role="alert">This question needs a control that isn't available yet.</p>;
  if (field.kind === "boolean" || field.kind === "choice") {
    const options =
      field.kind === "boolean"
        ? [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]
        : (field.options ?? []);
    return (
      <Select
        value={value === undefined ? "" : String(value)}
        onValueChange={(next) => change(field.kind === "boolean" ? next === "true" : next)}
      >
        <SelectTrigger {...common}>
          <SelectValue placeholder="Choose an answer" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label ?? option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const text =
    value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (field.kind === "multiline")
    return <Textarea {...common} value={text} onChange={(event) => change(event.target.value)} />;
  const type = {
    decimal: "number",
    integer: "number",
    date: "date",
    dateTime: "datetime-local",
    iri: "url",
    text: "text",
  }[field.kind];
  return (
    <Input
      {...common}
      type={type}
      step={field.kind === "integer" ? "1" : "any"}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        change(
          (field.kind === "integer" || field.kind === "decimal") && raw !== "" ? Number(raw) : raw,
        );
      }}
    />
  );
}

export function AnswerForm({
  form,
  validate,
  onSubmit,
  preview = false,
}: {
  form: FormModel;
  validate: FormRuntime["validate"];
  onSubmit?: (values: FormValues) => void;
  preview?: boolean;
}) {
  const prefix = useId();
  const [values, setValues] = useState<FormValues>({});
  const [result, setResult] = useState<ValidationResult>();
  const groups = [...form.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const unsupported = form.fields.some(
    (field) =>
      field.kind === "node" ||
      (field.maxCount !== undefined && field.maxCount !== 1) ||
      field.minCount > 1,
  );
  const renderFields = (group?: string) =>
    form.fields
      .filter((field) =>
        group
          ? field.group === group
          : !field.group || !groups.some((item) => item.iri === field.group),
      )
      .map((field) => {
        const id = `${prefix}-${field.key}`;
        const issues = result?.issues.filter((issue) => issue.key === field.key) ?? [];
        return (
          <div className="fm-field" key={field.key}>
            <Label htmlFor={id}>
              {field.label ?? field.key}
              {field.minCount > 0 && <span> (required)</span>}
            </Label>
            <AnswerControl
              field={field}
              value={values[field.key]}
              id={id}
              invalid={issues.some((issue) => issue.severity === "violation")}
              describedBy={`${id}-help ${id}-issues`}
              change={(value) => {
                setValues((current) => ({ ...current, [field.key]: value }));
                setResult(undefined);
              }}
            />
            <p id={`${id}-help`} className="fm-muted">
              {field.description}
            </p>
            <div id={`${id}-issues`} className="fm-validation">
              {issues.map((issue) => (
                <p key={issue.message}>{issue.message}</p>
              ))}
            </div>
          </div>
        );
      });
  return (
    <form
      noValidate
      className="fm-answer"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = { ...values };
        // datetime-local omits seconds at minute precision; XSD dateTime needs them.
        for (const field of form.fields) {
          const value = submitted[field.key];
          if (field.kind === "dateTime" && typeof value === "string" && value.length === 16)
            submitted[field.key] = `${value}:00`;
        }
        const checked = validate(form, submitted);
        setResult(checked);
        if (checked.valid && !unsupported) onSubmit?.(submitted);
      }}
    >
      <h2>{form.label ?? "Untitled form"}</h2>
      <p className="fm-muted">{form.description}</p>
      {result && !result.valid && (
        <p role="alert" className="fm-validation">
          Review the highlighted answers before continuing.
        </p>
      )}
      {!form.fields.length && (
        <EmptyState
          title="Your questions will appear here"
          body="Add a question to start building your form."
        />
      )}
      {renderFields()}
      {groups.map((group) => (
        <fieldset key={group.iri}>
          <legend>{group.label ?? "Section"}</legend>
          {renderFields(group.iri)}
        </fieldset>
      ))}
      <Button type="submit" disabled={!form.fields.length || unsupported}>
        {preview ? "Check preview answers" : "Save response to my pod"}
      </Button>
      {preview && <p className="fm-muted">Preview only · These answers won't be saved.</p>}
    </form>
  );
}
