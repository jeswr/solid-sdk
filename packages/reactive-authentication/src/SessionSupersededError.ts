import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

/** Thrown when logout (or another supersession) happened while credentials were being obtained or used. */
export class SessionSupersededError extends ReactiveAuthenticationError {
  constructor(cause?: unknown) {
    super("Authentication session was superseded (for example by logout)", cause);
    this.name = "SessionSupersededError";
  }
}
