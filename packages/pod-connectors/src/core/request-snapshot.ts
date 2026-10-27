// AUTHORED-BY Codex GPT-6.1-Sol
import { snapshotRequest } from "@jeswr/guarded-fetch";

/** @internal Capture the exact target and native policies before validating a fetch call. */
export function snapshotFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): {
  input: string | Request;
  url: string;
  init: RequestInit | undefined;
} {
  if (typeof input === "string" || input instanceof URL) {
    const url = new URL(String(input)).href;
    return { input: url, url, init };
  }
  const request = snapshotRequest(input, init);
  return { input: request, url: request.url, init: undefined };
}
