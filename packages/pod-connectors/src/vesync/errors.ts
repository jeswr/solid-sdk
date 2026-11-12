// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError } from "../core/errors.js";
/** Fixed text only: never wrap provider messages or credential-bearing exceptions. */
export class VeSyncAuthError extends IntegrationSyncError {
  constructor() {
    super("vesync", "VeSync login failed; check your account credentials.");
  }
}
// AUTHORED-BY Claude Opus 5.5
/** A VeSync transport, timeout or answer failure; fixed text, retried by watch mode. */
export class VeSyncSourceError extends IntegrationSyncError {
  constructor(message = "VeSync reading failed.") {
    super("vesync", message);
    this.name = "VeSyncSourceError";
  }
}
