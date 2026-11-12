// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { FieldDescriptor, FormModel } from "./runtime";

export const questionKinds = {
  text: "Short text",
  multiline: "Paragraph",
  decimal: "Number",
  integer: "Whole number",
  boolean: "Yes / no",
  date: "Date",
  dateTime: "Date and time",
  iri: "Link",
  choice: "Single choice",
} as const;
export type QuestionKind = keyof typeof questionKinds;

export function newForm(shape: string): FormModel {
  return {
    shape,
    targetClass: "https://schema.org/Answer",
    label: "Untitled form",
    description: "",
    fields: [],
    groups: [],
  };
}
export function newQuestion(id: string, kind: QuestionKind = "text"): FieldDescriptor {
  const datatype = {
    text: "string",
    multiline: "string",
    decimal: "decimal",
    integer: "integer",
    boolean: "boolean",
    date: "date",
    dateTime: "dateTime",
    choice: "string",
  };
  return {
    path: `https://jeswr.org/ns/forms/answer/${id}`,
    key: `q_${id}`,
    label: "Untitled question",
    kind,
    minCount: 0,
    maxCount: 1,
    severity: "violation",
    ...(kind !== "iri" ? { datatype: `http://www.w3.org/2001/XMLSchema#${datatype[kind]}` } : {}),
    ...(kind === "choice" ? { options: [{ value: "Option 1", termType: "Literal" }] } : {}),
  };
}
export function moveQuestion(form: FormModel, from: number, to: number): FormModel {
  const field = form.fields[from];
  if (!field || to < 0 || to >= form.fields.length || from === to) return form;
  const fields = [...form.fields];
  fields.splice(from, 1);
  fields.splice(to, 0, field);
  return { ...form, fields: fields.map((item, order) => ({ ...item, order })) };
}
export function duplicateQuestion(form: FormModel, key: string, id: string): FormModel {
  const index = form.fields.findIndex((field) => field.key === key);
  const field = form.fields[index];
  if (!field) return form;
  const copy = {
    ...structuredClone(field),
    path: `https://jeswr.org/ns/forms/answer/${id}`,
    key: `q_${id}`,
    label: `${field.label ?? field.key} (copy)`,
  };
  return {
    ...form,
    fields: [...form.fields.slice(0, index + 1), copy, ...form.fields.slice(index + 1)].map(
      (item, order) => ({ ...item, order }),
    ),
  };
}
export function designerIssues(form: FormModel): string[] {
  const issues: string[] = [];
  if (!form.label?.trim()) issues.push("Give your form a title.");
  if (!form.fields.length) issues.push("Add at least one question.");
  for (const field of form.fields) {
    const label = field.label || "Question";
    if (!field.label?.trim()) issues.push("Give every question a title.");
    if (
      field.kind === "choice" &&
      (!field.options?.length ||
        field.options.some((option) => !option.value.trim()) ||
        new Set(field.options.map((option) => option.value)).size !== field.options.length)
    )
      issues.push(`${label}: add unique, non-empty choices.`);
    for (const [min, max] of [
      [field.minLength, field.maxLength],
      [field.minInclusive, field.maxInclusive],
    ]) {
      if (
        (min !== undefined && !Number.isFinite(min)) ||
        (max !== undefined && !Number.isFinite(max)) ||
        (min !== undefined && max !== undefined && min > max)
      )
        issues.push(`${label}: check the minimum and maximum.`);
    }
    if (
      [field.minLength, field.maxLength].some(
        (value) => value !== undefined && (!Number.isInteger(value) || value < 0),
      )
    )
      issues.push(`${label}: lengths must be whole numbers of zero or more.`);
  }
  return [...new Set(issues)];
}
export function fillLink(origin: string, shape: string): string {
  return `${origin}/forms/f?form=${encodeURIComponent(shape)}`;
}
