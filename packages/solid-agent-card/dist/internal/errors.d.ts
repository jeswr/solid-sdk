/**
 * Classify a fetch/parse error into the right issue code. An {@link RdfFetchError}
 * carries discriminator fields: an HTTP `status` ⇒ the request reached the server
 * but it answered non-2xx (`fetch-failed`); a `contentType` WITHOUT a status ⇒ we
 * received a response but could not parse that media type (`parse-failed`); neither
 * ⇒ a transport/network failure (`fetch-failed`). A non-RdfFetchError is treated as
 * a parse failure (it surfaced from the parser, not the transport).
 */
export declare function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed";
/**
 * A human-readable message for a fetch/parse failure, kept in lock-step with
 * {@link classifyFetchError}: an HTTP status names the status; otherwise the
 * wording ("fetch" vs "parse") matches the classified code rather than always
 * saying "parse", so the message never contradicts the issue code.
 */
export declare function describeError(err: unknown): string;
//# sourceMappingURL=errors.d.ts.map