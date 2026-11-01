// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { accountId, assertGrant } from "../direct/shared.js";
import { MAX_EMAIL_BYTES } from "../email-mime.js";
import { ChannelParseError } from "../errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import type { AccountRef, TokenProvider } from "../types.js";

const GRAPH = "https://graph.microsoft.com";
const BASE = `${GRAPH}/v1.0/me`;
const DELTA_PATH = "/v1.0/me/mailFolders/inbox/messages/delta";
export const DELTA_INITIAL = `${GRAPH}${DELTA_PATH}?$select=id`;
// Exported origin sets are copies; mutating them cannot widen credential destinations.
export const graphMailOrigins = () => new Set([GRAPH, "https://login.microsoftonline.com"]);

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("malformed Graph response");
  return value as Record<string, unknown>;
}
export function messageId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(value))
    throw new ChannelParseError("invalid Graph message id");
  return value;
}
/** Without an inbox ID this checks syntax only; the reader pins the folder before use. */
export function deltaLink(
  value: unknown,
  inboxId: string | undefined,
  token?: "$skiptoken" | "$deltatoken",
): string {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    const path = /^\/v1\.0\/me\/mailfolders(?:\/([^/]+)|\('([^']+)'\))\/messages\/delta$/i.exec(
      url.pathname,
    );
    const folder = messageId(decodeURIComponent(path?.[1] ?? path?.[2] ?? ""));
    const params = url.searchParams;
    const selected = token ?? (params.has("$skiptoken") ? "$skiptoken" : "$deltatoken");
    if (
      url.origin !== GRAPH ||
      (inboxId !== undefined && folder.toLowerCase() !== "inbox" && folder !== inboxId) ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== value ||
      !params.get(selected) ||
      [...params.keys()].some(
        (key) => (key !== selected && key !== "$select") || params.getAll(key).length !== 1,
      ) ||
      (params.has("$select") && params.get("$select") !== "id")
    )
      throw new Error();
    return value;
  } catch {
    throw new ChannelParseError("invalid Graph inbox delta link");
  }
}
export function graphMailRest(options: OriginFetchOptions = {}) {
  const scoped = createOriginScopedFetch(graphMailOrigins(), options);
  return async (
    path: string,
    account: AccountRef,
    tokens: TokenProvider,
    access: "read" | "send",
    body?: string,
    beforeRequest?: () => Promise<void>,
  ) => {
    const target =
      path === DELTA_INITIAL
        ? path
        : path.startsWith("/")
          ? `${BASE}${path}`
          : deltaLink(path, undefined);
    const ref = Object.freeze({ id: accountId(account) });
    const grant = access === "read" ? await tokens.read(ref) : await tokens.send(ref);
    assertGrant(grant, access);
    await beforeRequest?.();
    return scoped(target, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${grant.accessToken}`,
        prefer: 'IdType="ImmutableId", odata.maxpagesize=100',
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
    });
  };
}
export async function responseBody(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Graph read failed: HTTP ${response.status}`);
  try {
    return record(
      parseBoundedJson(await response.text(), {
        ...DEFAULT_LIMITS,
        maxEnvelopeBytes: 1024 * 1024,
      }),
    );
  } catch {
    throw new ChannelParseError("invalid Graph JSON response");
  }
}
export async function mimeBody(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Graph MIME read failed: HTTP ${response.status}`);
  const raw = new Uint8Array(await response.arrayBuffer());
  if (!raw.byteLength || raw.byteLength > MAX_EMAIL_BYTES)
    throw new ChannelParseError("invalid Graph MIME byte length");
  return raw;
}
