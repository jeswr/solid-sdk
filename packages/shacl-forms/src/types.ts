// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
export interface FormModel {
  shape: string;
  targetClass?: string;
  label?: string;
  description?: string;
  fields: FieldDescriptor[];
  groups: GroupDescriptor[];
  /** sh:declare prefix declarations from the shapes graph. DatasetCore has no parser prefixes. */
  prefixes?: Record<string, string>;
}
export interface FieldDescriptor {
  path: string;
  key: string;
  /** Original sh:name, retained independently of display labels and collision suffixes. */
  name?: string;
  label?: string;
  description?: string;
  order?: number;
  group?: string;
  kind:
    | "text"
    | "multiline"
    | "integer"
    | "decimal"
    | "boolean"
    | "date"
    | "dateTime"
    | "iri"
    | "choice"
    | "node";
  datatype?: string;
  options?: { value: string; label?: string; termType: "Literal" | "NamedNode" }[];
  minCount: number;
  maxCount?: number;
  minLength?: number;
  minInclusive?: number;
  maxInclusive?: number;
  severity: "violation" | "warning" | "info";
  form?: FormModel;
  /** Reviewed sh:pattern guard; never compiled as a regular expression. */
  pattern?: "^https?://" | "^https://" | "\\S";
  message?: string;
  /** sh:class, checked against the response data graph. */
  hasClass?: string;
  /** `dash:singleLine true`: text values containing CR or LF are rejected on write and dropped on read. */
  singleLine?: true;
}
export interface GroupDescriptor {
  iri: string;
  label?: string;
  order?: number;
}
export type FormValue = string | number | boolean | Date | FormValues;
export interface FormValues {
  [key: string]: FormValue | FormValue[];
}
export interface FormIssue {
  key: string;
  path: string;
  message: string;
  severity: string;
}
export interface ValidationResult {
  valid: boolean;
  issues: FormIssue[];
}
export class FormAdmissionError extends Error {
  override readonly name = "FormAdmissionError";
  constructor(
    readonly construct: string,
    readonly shape: string,
    reason = "no form runtime projection",
  ) {
    super(`${construct} on shape ${shape}: ${reason}`);
  }
}
