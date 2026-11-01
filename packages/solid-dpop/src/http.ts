// AUTHORED-BY Codex GPT-6.1-Sol
import type { FetchLike } from "./session.js";

/** Transport policy and budgets for discovery and token exchanges. */
export interface HttpOptions {
  /** Development only: permit HTTP on localhost, 127.0.0.1, and ::1. Default false. */
  readonly allowInsecureLoopback?: boolean;
  /** Whole discovery/token exchange deadline, including nonce retry and body reads. Default 30 s. */
  readonly requestTimeoutMs?: number;
  /** Streamed discovery/token response cap. Default 1 MiB. */
  readonly maxResponseBytes?: number;
}

export function isLoopbackHost(host: string): boolean {
  return new Set(["127.0.0.1", "::1", "[::1]", "localhost"]).has(host.toLowerCase());
}

export function assertTransport(url: string, label: string, allowInsecureLoopback = false): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label} URL.`);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:") {
    if (allowInsecureLoopback && isLoopbackHost(parsed.hostname)) return;
    throw new Error(
      `Insecure ${label}: https required; HTTP loopback requires allowInsecureLoopback: true.`,
    );
  }
  throw new Error(`Unsupported ${label} scheme (expected https).`);
}

/** Validate every advertised destination, including optional metadata not used by this grant. */
export function validateMetadata(
  metadata: Record<string, unknown>,
  issuer: string,
  options: HttpOptions,
): void {
  if (metadata.issuer !== issuer) throw new Error("OIDC issuer mismatch in discovery document.");
  for (const name of [
    "token_endpoint",
    "authorization_endpoint",
    "registration_endpoint",
    "jwks_uri",
  ]) {
    const endpoint = metadata[name];
    if (endpoint !== undefined) {
      if (typeof endpoint !== "string" || !endpoint) throw new Error(`Invalid ${name} URL.`);
      assertTransport(endpoint, name, options.allowInsecureLoopback);
    }
  }
}

/** Cancellation is advisory: a hostile stream's cancel hook must never stall an exchange. */
export function discardBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    /* best effort */
  }
}

interface Exchange {
  signal: AbortSignal;
  wait: <T>(promise: Promise<T>) => Promise<T>;
  fetch: (url: string, init?: Parameters<FetchLike>[1]) => Promise<Response>;
  maxBytes: number;
}

async function withDeadline<T>(
  fetchImpl: FetchLike,
  options: HttpOptions,
  action: (exchange: Exchange) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxBytes = options.maxResponseBytes ?? 1024 * 1024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error("Invalid HTTP response budget.");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("OIDC exchange deadline exceeded.");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const wait = <R>(promise: Promise<R>): Promise<R> => Promise.race([promise, deadline]);
  try {
    return await wait(
      action({
        signal: controller.signal,
        wait,
        maxBytes,
        fetch: (url, init) => {
          controller.signal.throwIfAborted();
          return wait(
            fetchImpl(url, { ...init, redirect: "manual", signal: controller.signal }).then(
              (response) => {
                // Also release responses from custom transports which ignored the aborted signal.
                if (controller.signal.aborted) {
                  discardBody(response);
                  throw controller.signal.reason;
                }
                return response;
              },
            ),
          );
        },
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response, exchange: Exchange): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("OIDC response has no JSON body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await exchange.wait(reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > exchange.maxBytes) throw new Error("OIDC response exceeds byte limit.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // JSON.parse's native error can quote response data (including credentials).
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Invalid OIDC JSON response.");
  }
}

export async function discover(
  issuer: string,
  url: string,
  fetchImpl: FetchLike,
  options: HttpOptions,
): Promise<Record<string, unknown>> {
  assertTransport(issuer, "issuer", options.allowInsecureLoopback);
  return withDeadline(fetchImpl, options, async (exchange) => {
    const response = await exchange.fetch(url);
    if (!response.ok) {
      discardBody(response);
      throw new Error(`OIDC discovery failed (${response.status}).`);
    }
    const metadata = await readJson(response, exchange);
    validateMetadata(metadata, issuer, options);
    return metadata;
  });
}

const OAUTH_ERRORS = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
]);

export async function requestToken<T>(
  endpoint: string,
  fetchImpl: FetchLike,
  options: HttpOptions,
  initFor: (nonce?: string) => Promise<NonNullable<Parameters<FetchLike>[1]>>,
): Promise<{ token: T; nonce?: string }> {
  assertTransport(endpoint, "token_endpoint", options.allowInsecureLoopback);
  let failureStatus: number | undefined;
  return withDeadline(fetchImpl, options, async (exchange) => {
    const attempt = async (nonce?: string) => exchange.fetch(endpoint, await initFor(nonce));
    let response = await attempt();
    let nonce = response.headers.get("DPoP-Nonce") ?? undefined;
    if (response.status === 400 && nonce) {
      discardBody(response);
      response = await attempt(nonce);
      nonce = response.headers.get("DPoP-Nonce") ?? nonce;
    }
    if (!response.ok) {
      failureStatus = response.status;
      let code: unknown;
      if (response.status >= 300 && response.status < 400) discardBody(response);
      else {
        try {
          code = (await readJson(response, exchange)).error;
        } catch {
          /* status only */
        }
      }
      const safeCode =
        typeof code === "string" &&
        code.length <= 64 &&
        /^[\x20-\x21\x23-\x5B\x5D-\x7E]+$/.test(code) &&
        OAUTH_ERRORS.has(code)
          ? `: ${code}`
          : "";
      throw new Error(`Token request failed (${response.status})${safeCode}`);
    }
    const token = await readJson(response, exchange);
    if (typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "dpop") {
      throw new Error("Token response token_type must be DPoP.");
    }
    return { token: token as T, ...(nonce ? { nonce } : {}) };
  }).catch((error: unknown) => {
    // A timeout racing an unfinished error body still reports the received HTTP status.
    if (
      failureStatus !== undefined &&
      error instanceof Error &&
      error.message === "OIDC exchange deadline exceeded."
    ) {
      throw new Error(`Token request failed (${failureStatus})`);
    }
    throw error;
  });
}

/**
 * Read an OIDC discovery or token JSON object, capped at 1 MiB and abortable, for adapters that
 * inspect raw auth responses before handing them to solid-dpop.
 */
export async function readOidcJson(
  response: Response,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("OIDC response has no JSON body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("OIDC response exceeds byte limit.");
      chunks.push(value);
    }
  } catch (error) {
    // Cancellation hooks are advisory and must not stall rejection.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Invalid OIDC JSON response.");
  }
}
