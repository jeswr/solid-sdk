import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

export class CodeRequestCancelledError extends ReactiveAuthenticationError {
  constructor(
    public authorizationRequest: URL,
    cause?: unknown,
  ) {
    super("Code request cancelled", cause);
    this.name = "CodeRequestCancelledError";
  }
}
