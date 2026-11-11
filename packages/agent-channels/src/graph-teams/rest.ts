// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { accountId, assertGrant } from "../direct/shared.js";
import { ChannelParseError } from "../errors.js";
import { record } from "../graph-mail/rest.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import { TEAMS_CARD } from "../profiles.js";
import type { AccountRef, TokenProvider } from "../types.js";

const GRAPH = "https://graph.microsoft.com";
export const BASE = `${GRAPH}/v1.0`;
export const graphTeamsOrigins = () => new Set([GRAPH]);
export const JSON_LIMITS = { ...DEFAULT_LIMITS, maxStringLength: TEAMS_CARD.maxBytes };
export const PAGE_LIMITS = { ...JSON_LIMITS, maxEnvelopeBytes: 1024 * 1024 };
export interface GraphTeamsTiming {
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}
/** Graph IDs are opaque single path components, including Teams' ':' and '@'. */
export function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_:@.+/=-]{1,2048}$/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new ChannelParseError("invalid Teams id");
  return value;
}
/** Restrict both cursors and provider links to known Graph collection operations. */
export function collection(value: unknown): URL {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (
      url.origin !== GRAPH ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== value ||
      !/^\/v1\.0\/(?:me\/(?:chats|joinedTeams)|me\/chats\/[^/]+\/messages|teams\/[^/]+\/channels(?:\/[^/]+\/messages)?)$/.test(
        url.pathname,
      )
    )
      throw new Error();
    // Graph can emit raw ':'/'@' or percent-encoded Teams IDs. Compare collections
    // by their validated, encoded components so equivalent links keep the same pin.
    const parts = url.pathname.split("/");
    for (let index = 2; index < parts.length; index++)
      parts[index] = encodeURIComponent(id(decodeURIComponent(parts[index] as string)));
    url.pathname = parts.join("/");
    for (const key of url.searchParams.keys()) {
      if (
        !["$top", "$skip", "$skiptoken"].includes(key) ||
        url.searchParams.getAll(key).length !== 1 ||
        !url.searchParams.get(key)
      )
        throw new Error();
    }
    return url;
  } catch {
    throw new ChannelParseError("invalid Teams collection link");
  }
}
export function nextLink(value: unknown, current: URL): string {
  const url = collection(value);
  if (url.pathname !== current.pathname || url.href === current.href)
    throw new ChannelParseError("invalid Teams continuation");
  return url.href;
}
/** Shared byte/depth/node limits for hostile provider JSON, cards and saved cursors. */
export function json(raw: string | Uint8Array, page = false): Record<string, unknown> {
  try {
    if (Buffer.byteLength(raw) > (page ? PAGE_LIMITS : JSON_LIMITS).maxEnvelopeBytes)
      throw new Error();
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return record(parseBoundedJson(text, page ? PAGE_LIMITS : JSON_LIMITS));
  } catch {
    throw new ChannelParseError("invalid Teams JSON");
  }
}
export async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return json(await response.text(), true);
  } catch {
    throw new ChannelParseError("invalid Teams JSON response");
  }
}
/** Bounded retries apply only to reads: POST has no provider idempotency guarantee. */
export function graphTeamsRest(transport?: OriginFetchOptions, timing: GraphTeamsTiming = {}) {
  const scoped = createOriginScopedFetch(graphTeamsOrigins(), transport);
  const sleep =
    timing.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = timing.now ?? Date.now;
  return async <Access extends "read" | "send">(
    target: string,
    account: AccountRef,
    tokens: Pick<TokenProvider, Access>,
    access: Access,
    body?: string,
    beforeRequest?: () => Promise<void>,
    beforeDispatch?: () => void,
  ): Promise<Response> => {
    const url = body === undefined ? collection(target).href : target;
    if (
      body !== undefined &&
      !/^https:\/\/graph\.microsoft\.com\/v1\.0\/chats\/[^/]+\/messages$/.test(url)
    )
      throw new ChannelParseError("invalid Teams send target");
    const ref = Object.freeze({ id: accountId(account) });
    const started = now();
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const grant = await tokens[access](ref);
      assertGrant(grant, access);
      await beforeRequest?.();
      let response: Response;
      try {
        response = await scoped(url, {
          beforeDispatch,
          method: body === undefined ? "GET" : "POST",
          redirect: "manual",
          headers: {
            authorization: `Bearer ${grant.accessToken}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body }),
        });
      } catch (error) {
        // Guard errors can include the URL, whose opaque paging token is untrusted.
        // Send paths retain their request-local authority refusal identity.
        if (access === "read") throw new Error("Graph Teams read transport failed");
        throw error;
      }
      if (access !== "read" || ![429, 503].includes(response.status) || attempt >= 3)
        return response;
      const retry = response.headers.get("retry-after");
      const delay =
        retry === null
          ? NaN
          : /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Date.parse(retry) - now();
      if (
        !Number.isFinite(delay) ||
        delay < 0 ||
        waited + delay > 30_000 ||
        now() - started + delay > 30_000
      )
        return response;
      waited += delay;
      await Promise.allSettled([response.body?.cancel()]);
      await sleep(delay);
    }
  };
}
