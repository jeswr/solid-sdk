// AUTHORED-BY GPT-6.1-Sol
import { CapabilitiesError } from "./errors.js";
import type { ResolveOptions } from "./types.js";

const BODY_LIMIT = 1_048_576;

/** Validate HTTP destinations without replacing the caller's injected SSRF guard. */
export function httpUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    url.hash = "";
    return url;
  } catch {
    throw new CapabilitiesError(
      "description-invalid",
      value,
      "Expected an HTTP URL without credentials",
    );
  }
}

/** Release unused/error responses without hiding the original failure. */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A transport can already have closed or errored the body.
  }
}

/** All requests use the supplied transport, signal and manual redirect policy. */
export async function request(
  url: string,
  options: Pick<ResolveOptions, "fetch" | "signal">,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(url, { ...init, signal: options.signal, redirect: "manual" });
  } catch {
    throw new CapabilitiesError("network", url, "Storage discovery request failed");
  }
  if (
    response.redirected ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400 && response.status !== 304)
  ) {
    await discardBody(response);
    throw new CapabilitiesError(
      "description-unreachable",
      url,
      "Storage discovery refused a redirect",
      response.status,
    );
  }
  return response;
}

/** Count bytes while streaming, including when Content-Length is absent or incorrect. */
export async function readBody(response: Response, url: string): Promise<string> {
  const tooLarge = () =>
    new CapabilitiesError("description-invalid", url, "Description exceeds 1 MiB");
  if (Number(response.headers.get("content-length")) > BODY_LIMIT) {
    await discardBody(response);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) throw tooLarge();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Keep the size or transport error even if cancelling the source fails.
    }
    if (error instanceof CapabilitiesError) throw error;
    throw new CapabilitiesError("network", url, "Failed to read storage description");
  } finally {
    reader.releaseLock();
  }
}
