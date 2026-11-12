// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@jeswr/fetch-rdf";
import type { Store } from "n3";
import type { PodSession } from "@/lib/session/pod-session";
import type { FormsStore } from "./data/store";

// Contract copied from the sst-ild.4.4 brief. The generic graph parameters let the
// JSON-only demo double implement this contract without pretending to produce RDF.
export interface FormModel {
  shape: string;
  targetClass?: string;
  label?: string;
  description?: string;
  fields: FieldDescriptor[];
  groups: GroupDescriptor[];
}
export interface FieldDescriptor {
  path: string;
  key: string;
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
  maxLength?: number;
  minInclusive?: number;
  maxInclusive?: number;
  severity: "violation" | "warning" | "info";
  form?: FormModel;
}
export interface GroupDescriptor {
  iri: string;
  label?: string;
  order?: number;
}
export type FormValue = string | number | boolean | Date | FormValues;
// The index signature spelling avoids TypeScript's circular Record alias restriction.
export interface FormValues {
  [key: string]: FormValue | FormValue[];
}
export interface ValidationResult {
  valid: boolean;
  issues: { key: string; path: string; message: string; severity: string }[];
}
export interface FormRuntime<Graph = Store, Input = DatasetCore> {
  compileForm(shapes: Input, shapeIri: string): FormModel;
  validate(form: FormModel, values: FormValues): ValidationResult;
  build(form: FormModel, subject: string, values: FormValues): Graph;
  parse(form: FormModel, subject: string, data: Input): FormValues;
  serialize(store: Graph): Promise<string>;
  formToShapes(form: FormModel): Graph;
}

// Single-file installation seam for the imported @jeswr/shacl-forms namespace
// and the host's shared container discovery. Never install the demo double here.
export const formRuntime: {
  current: FormRuntime | null;
  openStore: ((session: PodSession, runtime: FormRuntime) => Promise<FormsStore>) | null;
} = { current: null, openStore: null };
