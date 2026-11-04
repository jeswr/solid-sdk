// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { accountId, assertGrant } from "../direct/shared.js";
import { ChannelParseError } from "../errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import type { AccountRef, TokenProvider } from "../types.js";

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid Matrix object");
  return value as Record<string, unknown>;
}
export function identifier(value: unknown, prefix: "!" | "$" | "@"): string {
  if (
    typeof value !== "string" ||
    value[0] !== prefix ||
    value.length < 2 ||
    value.length > 255 ||
    /[\s\p{Cc}]/u.test(value)
  )
    throw new ChannelParseError("invalid Matrix identifier");
  return value;
}
export function syncToken(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\p{Cc}]/u.test(value))
    throw new ChannelParseError("invalid Matrix sync token");
  return value;
}
export const MATRIX_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxEnvelopeBytes: 1024 * 1024,
  maxStringLength: 65536,
  maxJsonNodes: 50000,
});
export function json(
  raw: string | Uint8Array,
  maxBytes = MATRIX_LIMITS.maxEnvelopeBytes,
): Record<string, unknown> {
  try {
    if (typeof raw !== "string" && raw.byteLength > maxBytes) throw new Error();
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return record(parseBoundedJson(text, { ...MATRIX_LIMITS, maxEnvelopeBytes: maxBytes }));
  } catch {
    throw new ChannelParseError("invalid bounded Matrix JSON");
  }
}
/** A configured homeserver is the ONLY credential destination; no discovery/redirects. */
export function matrixOrigins(homeserver: string): ReadonlySet<string> {
  if (!URL.canParse(homeserver)) throw new TypeError("invalid Matrix homeserver");
  const url = new URL(homeserver);
  if (url.protocol !== "https:" || url.origin !== homeserver)
    throw new TypeError("Matrix homeserver must be an HTTPS origin");
  return new Set([homeserver]);
}
export function matrixRest(homeserver: string, options?: OriginFetchOptions) {
  const scoped = createOriginScopedFetch(matrixOrigins(homeserver), options);
  return async <Access extends "read" | "send">(
    path: string,
    account: AccountRef,
    tokens: Pick<TokenProvider, Access>,
    access: Access,
    body?: string,
    beforeRequest?: () => Promise<void>,
    assertAuthority?: () => void,
  ) => {
    const ref = Object.freeze({ id: accountId(account) });
    const grant = await tokens[access](ref);
    assertGrant(grant, access);
    await beforeRequest?.();
    return scoped(`${homeserver}/_matrix/client/v3${path}`, {
      beforeDispatch: assertAuthority,
      method: body === undefined ? "GET" : "PUT",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${grant.accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
    });
  };
}
export async function responseBody(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Matrix read failed: HTTP ${response.status}`);
  return json(await response.text());
}
