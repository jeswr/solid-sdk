import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

export class IssuerRequestCancelledError extends ReactiveAuthenticationError {
  constructor(
    public request: Request,
    cause?: unknown,
  ) {
    super("Issuer request cancelled", cause);
    this.name = "IssuerRequestCancelledError";
  }
}
