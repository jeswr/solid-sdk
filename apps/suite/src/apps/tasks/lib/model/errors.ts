// AUTHORED-BY Codex GPT-6.1-Sol
import { classifyError, type ErrorCategory } from "@jeswr/suite-sdk/react";

export { classifyError, type ErrorCategory };

const statusCodes: Record<number, string> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  410: "not-found",
  412: "precondition-failed",
  409: "conflict",
  413: "payload-too-large",
  429: "rate-limited",
  507: "insufficient-storage",
};

export class ModelError extends Error {
  readonly code: string;
  constructor(
    readonly status: number,
    readonly url: string,
    readonly etag: string | null = null,
    options?: ErrorOptions,
  ) {
    super(`Tasks resource request failed (${status}).`, options);
    this.name = "ModelError";
    this.code =
      statusCodes[status] ??
      (status === 0 ? "network" : status >= 500 ? "server" : "invalid-response");
  }
  get category(): ErrorCategory {
    return classifyError(this);
  }
}

export class ProjectMembersSyncError extends Error {
  constructor(cause: unknown) {
    super("Access was saved, but the project's member list wasn't updated.", { cause });
    this.name = "ProjectMembersSyncError";
  }
}

export class InboxAclRecoveryError extends ModelError {
  constructor(url: string, cause: unknown) {
    super(403, url, null, { cause });
    this.name = "InboxAclRecoveryError";
    this.message =
      "Can't restore private access to your Inbox. Check its permissions and try again.";
  }
}
