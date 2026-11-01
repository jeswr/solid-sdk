// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { accountId, assertGrant } from "../direct/shared.js";
import { ChannelParseError } from "../errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import type { AccountRef, TokenProvider } from "../types.js";

export const DEFAULT_INSTANCE = "https://mastodon.social";
export const MAX_RECORD_BYTES = 64 * 1024;
export const JSON_LIMITS = { ...DEFAULT_LIMITS, maxEnvelopeBytes: MAX_RECORD_BYTES };
export function instanceOrigin(instance: string): string {
  let url: URL;
  try {
    url = new URL(instance);
  } catch {
    throw new TypeError("invalid Mastodon instance");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin.length > 2048
  )
    throw new TypeError("Mastodon instance must be an HTTPS origin");
  return url.origin;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid Mastodon record");
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{1,40}$/.test(value))
    throw new ChannelParseError("invalid Mastodon id");
  return value;
}
export function handle(value: unknown): string {
  if (typeof value !== "string" || value.length > 256)
    throw new ChannelParseError("invalid Mastodon account handle");
  // Mastodon's USERNAME_RE and Unicode HOST_LABEL_CHAR, with an optional instance port.
  const match =
    /^([a-z0-9_]+(?:[.-]+[a-z0-9_]+)*)(?:@([\p{L}\p{M}\p{N}\p{Pc}ßς۽۾་〇]+(?:[.-]+[\p{L}\p{M}\p{N}\p{Pc}ßς۽۾་〇]+)*)(:[0-9]+)?)?$/iu.exec(
      value,
    );
  if (!match || match[0] !== value) throw new ChannelParseError("invalid Mastodon account handle");
  if (!match[2]) return value;
  try {
    // Match the URL normalization used when qualifying local handles by instance host.
    const host = new URL(`https://${match[2]}${match[3] ?? ""}`).host;
    const normalized = `${match[1]}@${host}`;
    if (normalized.length > 256) throw new Error();
    return normalized;
  } catch {
    throw new ChannelParseError("invalid Mastodon account handle");
  }
}
export function recipientHandle(value: string): string {
  const normalized = handle(value);
  // Account::MENTION_RE, restricted to the ASCII host produced by URL/IDNA normalization.
  // It cannot consume ports, including explicit default ports removed by URL normalization.
  if (
    !/^[a-z0-9_]+(?:[.-]+[a-z0-9_]+)*(?:@[a-z0-9_]+(?:[.-]+[a-z0-9_]+)*)?$/iu.test(normalized) ||
    value.includes(":")
  )
    throw new ChannelParseError("Mastodon recipient cannot be rendered as a complete mention");
  return normalized;
}
export async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Mastodon read failed: HTTP ${response.status}`);
  try {
    return parseBoundedJson(await response.text(), JSON_LIMITS);
  } catch {
    throw new ChannelParseError("invalid Mastodon JSON response");
  }
}
export function mastodonRest(instance: string, options: OriginFetchOptions = {}) {
  const origin = instanceOrigin(instance);
  const scoped = createOriginScopedFetch(new Set([origin]), options);
  return async (
    path: string,
    account: AccountRef,
    tokens: TokenProvider,
    access: "read" | "send",
    send?: { body: string; key: string; beforeRequest: () => Promise<void> },
  ) => {
    const ref = Object.freeze({ id: accountId(account) });
    const grant = access === "read" ? await tokens.read(ref) : await tokens.send(ref);
    assertGrant(grant, access);
    await send?.beforeRequest();
    try {
      return await scoped(`${origin}${path}`, {
        method: send ? "POST" : "GET",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${grant.accessToken}`,
          ...(send ? { "content-type": "application/json", "idempotency-key": send.key } : {}),
        },
        ...(send ? { body: send.body } : {}),
      });
    } catch {
      // Transport errors can echo credentials or hostile response bodies.
      throw new Error("Mastodon request failed; delivery may be uncertain");
    }
  };
}
