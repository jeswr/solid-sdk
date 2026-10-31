// AUTHORED-BY Codex GPT-6.1-Sol
import { accountId, assertGrant } from "../direct/shared.js";
import { MAX_EMAIL_BYTES } from "../email-mime.js";
import { ChannelParseError } from "../errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import type { AccountRef, TokenProvider } from "../types.js";

// Private immutable source; exported sets are copies and cannot widen credential destinations.
const ORIGIN_LIST = ["https://gmail.googleapis.com", "https://www.googleapis.com"];
export const gmailOrigins = () => new Set(ORIGIN_LIST);
const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_ID = /^[A-Za-z0-9]{1,64}$/;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("malformed Gmail response");
  return value as Record<string, unknown>;
}
export function opaque(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new ChannelParseError("invalid Gmail page token");
  return value;
}
export function historyId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{1,40}$/.test(value))
    throw new ChannelParseError("invalid Gmail history id");
  return value;
}
export function messageId(value: unknown): string {
  if (typeof value !== "string" || !GMAIL_ID.test(value))
    throw new ChannelParseError("invalid Gmail message id");
  return value;
}
export function rawMessage(
  value: unknown,
  id: string,
): { id: string; raw: Uint8Array; historyId: string | undefined } {
  const body = record(value);
  if (
    body.id !== id ||
    typeof body.raw !== "string" ||
    body.raw.length > Math.ceil(MAX_EMAIL_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(body.raw)
  )
    throw new ChannelParseError("invalid Gmail raw message");
  const padding = body.raw.indexOf("=");
  if (padding >= 0 && body.raw.length % 4 !== 0)
    throw new ChannelParseError("invalid Gmail raw encoding");
  const encoded = padding < 0 ? body.raw : body.raw.slice(0, padding);
  const raw = Buffer.from(encoded, "base64url");
  if (raw.toString("base64url") !== encoded || raw.length > MAX_EMAIL_BYTES)
    throw new ChannelParseError("invalid Gmail raw encoding");
  return {
    id,
    raw: new Uint8Array(raw),
    historyId: body.historyId === undefined ? undefined : historyId(body.historyId),
  };
}
export function gmailRest(options: OriginFetchOptions = {}) {
  const scoped = createOriginScopedFetch(gmailOrigins(), options);
  return async (
    path: string,
    account: AccountRef,
    tokens: TokenProvider,
    access: "read" | "send",
    body?: string,
    beforeRequest?: () => Promise<void>,
  ) => {
    const ref = Object.freeze({ id: accountId(account) });
    const grant = access === "read" ? await tokens.read(ref) : await tokens.send(ref);
    assertGrant(grant, access);
    await beforeRequest?.();
    return scoped(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
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
  if (!response.ok) throw new Error(`Gmail read failed: HTTP ${response.status}`);
  try {
    return record(await response.json());
  } catch {
    throw new ChannelParseError("invalid Gmail JSON response");
  }
}
