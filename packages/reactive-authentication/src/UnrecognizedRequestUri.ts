import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

export class UnrecognizedRequestUri extends ReactiveAuthenticationError {
  constructor(
    public request: Request,
    cause?: unknown,
  ) {
    super("Unrecognized request URI", cause);
    this.name = "UnrecognizedRequestUri";
  }
}
