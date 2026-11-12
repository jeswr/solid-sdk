// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError } from "../core/errors.js";
/** Fixed text only: never wrap provider messages or credential-bearing exceptions. */
export class VeSyncAuthError extends IntegrationSyncError {
  constructor() {
    super("vesync", "VeSync login failed; check your account credentials.");
  }
}
