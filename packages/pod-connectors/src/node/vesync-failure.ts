// AUTHORED-BY Claude Opus 5.5
import { PreconditionUnsupportedError } from "../core/errors.js";
import { VeSyncAuthError, VeSyncSourceError } from "../vesync/errors.js";
import {
  httpStatus,
  isTransientCause,
  isTransientStatus,
  NodeRuntimeError,
  StateStoreError,
} from "./errors.js";

/** A classified VeSync run failure: fixed text naming the failing side, plus whether to retry. */
export class VeSyncRunFailure extends NodeRuntimeError {
  constructor(
    kind: NodeRuntimeError["kind"],
    message: string,
    readonly retry: boolean,
  ) {
    super(kind, message);
    this.name = "VeSyncRunFailure";
  }
}

/**
 * Classify by cause, wherever the failure happened (source, Pod writes, state checkpoint).
 * Transient: VeSync transport/answer faults, network errors, timeouts, Pod 5xx/408/412 and
 * transient state I/O. Permanent: VeSync login rejection, Pod 401/403 and other
 * 4xx, missing strong ETags, structural state problems and configuration errors. Messages
 * are fixed text (only an HTTP status number is interpolated), never server or exception text.
 */
export function classifyVeSyncFailure(error: unknown): VeSyncRunFailure {
  if (error instanceof VeSyncRunFailure) return error;
  if (error instanceof VeSyncAuthError) return new VeSyncRunFailure("auth", error.message, false);
  if (error instanceof VeSyncSourceError)
    return new VeSyncRunFailure(
      "import",
      "VeSync reading failed; the last successful checkpoint was retained.",
      true,
    );
  if (error instanceof PreconditionUnsupportedError)
    return new VeSyncRunFailure(
      "import",
      "Your pod did not return a strong ETag, so readings cannot be updated safely.",
      false,
    );
  if (error instanceof StateStoreError)
    return new VeSyncRunFailure("import", error.message, error.transient);
  // Configuration, Pod login and other typed CLI refusals stop the command.
  if (error instanceof NodeRuntimeError)
    return new VeSyncRunFailure(error.kind, error.message, false);
  const status = httpStatus(error);
  if (status === 401 || status === 403)
    return new VeSyncRunFailure(
      "auth",
      `Your pod refused access (HTTP ${status}); check the Pod client credentials and grants.`,
      false,
    );
  if (status !== undefined)
    return isTransientStatus(status)
      ? new VeSyncRunFailure("import", `Your pod answered HTTP ${status}; it may recover.`, true)
      : new VeSyncRunFailure("import", `Your pod rejected a request (HTTP ${status}).`, false);
  if (isTransientCause(error))
    return new VeSyncRunFailure("import", "A network or Pod request failed temporarily.", true);
  return new VeSyncRunFailure(
    "import",
    "Import stopped: the readings could not be imported safely.",
    false,
  );
}
