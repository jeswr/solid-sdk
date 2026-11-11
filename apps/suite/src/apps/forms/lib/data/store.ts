// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { FormModel, FormRuntime, FormValues } from "../runtime";

export interface FormResponse {
  subject: string;
  form: string;
  values: FormValues;
}
export interface FormsStore {
  readonly validate: FormRuntime["validate"];
  listForms(): Promise<{ forms: FormModel[]; skipped: string[] }>;
  /** Only absolute HTTPS shape URLs (HTTP loopback in development), without
   * userinfo, at most 4096 characters. Foreign storage origins MUST be read via
   * a pristine unauthenticated fetch with credentials omitted and no redirects. */
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
