// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { FormModel, FormRuntime, FormValues } from "../runtime";

export interface FormResponse {
  subject: string;
  form: string;
  values: FormValues;
}
export interface FormsStore {
  readonly validate: FormRuntime["validate"];
  listForms(): Promise<FormModel[]>;
  loadForm(shape: string): Promise<FormModel>;
  saveForm(form: FormModel): Promise<FormModel>;
  listResponses(form: FormModel): Promise<FormResponse[]>;
  submit(form: FormModel, values: FormValues): Promise<FormResponse>;
}
export interface DemoSnapshot {
  version: 1;
  forms: FormModel[];
  responses: FormResponse[];
}
