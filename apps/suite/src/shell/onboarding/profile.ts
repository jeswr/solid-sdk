// AUTHORED-BY Claude Opus 5.5
/**
 * Profile editing seam for onboarding's "Make it yours" step (02-suite-shell
 * §8.3). Name and photo are written to the profile only when the account may
 * write its profile document. The suite has no profile writer yet, and the
 * demo session never has one, so today every account reports `writable: false`
 * and the step shows the name read-only with the photo upload hidden.
 */
import type { SuiteAccount } from "../session/types";

export interface ProfileEditor {
  writable: boolean;
  saveName?(name: string): Promise<void>;
  uploadPhoto?(file: File): Promise<void>;
}

const readOnly: ProfileEditor = { writable: false };

export function profileEditorFor(_account: SuiteAccount): ProfileEditor {
  return readOnly;
}
