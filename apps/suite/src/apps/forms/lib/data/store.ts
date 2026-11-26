// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import type { FormModel, FormRuntime, FormValues } from "../runtime";

export interface FormResponse {
  subject: string;
  form: string;
  values: FormValues;
}
export interface FormsStore {
  readonly validate: FormRuntime["validate"];
  /** Uses the same storage scope as loadForm's credential boundary. */
  isForeign(url: string): boolean;
  listForms(): Promise<{ forms: FormModel[]; skipped: string[] }>;
  /** Only absolute HTTPS shape URLs (HTTP loopback in development), without
   * userinfo, at most 4096 characters. Shapes outside storage MUST be read via
   * a pristine unauthenticated fetch with credentials omitted and no redirects. */
  loadForm(shape: string): Promise<FormModel>;
  saveForm(form: FormModel): Promise<FormModel>;
  listResponses(form: FormModel): Promise<FormResponse[]>;
  submit(form: FormModel, values: FormValues): Promise<FormResponse>;
}
export class ResponsePrivacyError extends Error {
  constructor() {
    super(
      "Couldn't verify that only you can access the response destination. Your answers are still here.",
    );
    this.name = "ResponsePrivacyError";
  }
}

export class DemoSnapshotConflictError extends Error {
  constructor(readonly latest: FormModel | undefined) {
    super(
      "Demo forms changed in another tab. The latest snapshot is loaded and your draft is still here.",
    );
    this.name = "DemoSnapshotConflictError";
  }
}

/** A response write may have committed, but its saved content cannot be confirmed. */
export class ResponseSaveUncertainError extends Error {
  constructor() {
    super(
      "Your response may already be saved. Your answers are still here; check your pod before trying again.",
    );
    this.name = "ResponseSaveUncertainError";
  }
}
export interface DemoSnapshot {
  version: 1;
  forms: FormModel[];
  responses: FormResponse[];
}
