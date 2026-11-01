export class ReactiveAuthenticationError extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message);
    this.name = "ReactiveAuthenticationError";
    this.cause = cause;
  }
}
