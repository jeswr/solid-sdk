// AUTHORED-BY Claude Opus 5.5
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";

/**
 * Thrown when a request body exceeds `maxReplayBodyBytes`, so it cannot be buffered for replay after a 401.
 * A streamed body is cancelled as soon as more than `maxBytes` bytes have been read, so an over-long stream
 * is never held in memory whole. The request is not sent.
 */
export class ReplayBodyTooLargeError extends ReactiveAuthenticationError {
  /** The configured limit that the body exceeded. */
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(
      `Request body exceeds ${maxBytes} bytes and cannot be buffered for replay; authenticate first with a smaller request or raise maxReplayBodyBytes`,
    );
    this.name = "ReplayBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}
