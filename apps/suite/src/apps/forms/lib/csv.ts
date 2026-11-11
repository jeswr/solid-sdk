// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { FormResponse } from "./data/store";
import type { FormModel, FormValue } from "./runtime";

export function answerText(value: FormValue | FormValue[] | undefined): string {
  if (value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(answerText).join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
/** RFC 4180: always quote, double embedded quotes, and end records with CRLF. */
export function responsesCsv(form: FormModel, responses: readonly FormResponse[]): string {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [
    ["Response URL", ...form.fields.map((field) => field.label ?? field.key)],
    ...responses.map((response) => [
      response.subject,
      ...form.fields.map((field) => answerText(response.values[field.key])),
    ]),
  ];
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
