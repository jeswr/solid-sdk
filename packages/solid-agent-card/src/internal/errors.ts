// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The ONE classify+describe implementation for a fetch/parse failure, shared by
// the two consume-side entry points (verifyDescriptor, discoverAgent). Previously
// each carried its own copy of `describeError`; the discover copy used a truthy
// `err.status` check that mislabelled a pure-transport failure as "parse" — out
// of step with the verify copy AND with the issue CODE (classifyFetchError already
// returns `fetch-failed` for that case). Consolidating to this single module
// removes the duplication and makes the message mirror the code everywhere.
//
// Internal module (under src/internal/**): NOT part of the public API surface.

import { RdfFetchError } from "@jeswr/fetch-rdf";

/**
 * Classify a fetch/parse error into the right issue code. An {@link RdfFetchError}
 * carries discriminator fields: an HTTP `status` ⇒ the request reached the server
 * but it answered non-2xx (`fetch-failed`); a `contentType` WITHOUT a status ⇒ we
 * received a response but could not parse that media type (`parse-failed`); neither
 * ⇒ a transport/network failure (`fetch-failed`). A non-RdfFetchError is treated as
 * a parse failure (it surfaced from the parser, not the transport).
 */
export function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed" {
  if (err instanceof RdfFetchError) {
    if (err.status !== undefined) {
      return "fetch-failed";
    }
    return err.contentType !== undefined ? "parse-failed" : "fetch-failed";
  }
  return "parse-failed";
}

/**
 * A human-readable message for a fetch/parse failure, kept in lock-step with
 * {@link classifyFetchError}: an HTTP status names the status; otherwise the
 * wording ("fetch" vs "parse") matches the classified code rather than always
 * saying "parse", so the message never contradicts the issue code.
 */
export function describeError(err: unknown): string {
  if (err instanceof RdfFetchError) {
    if (err.status !== undefined) {
      return `Failed to fetch agent description (HTTP ${err.status}): ${err.message}`;
    }
    return classifyFetchError(err) === "parse-failed"
      ? `Failed to parse agent description: ${err.message}`
      : `Failed to fetch agent description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
