// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The GMAIL channel adapter (NOW-PERSONAL-AGENT.md §4). A THIN pull adapter:
 * `users.messages.list` + `users.messages.get?format=raw` → the full RFC 822 bytes →
 * the bridge's HARDENED `parseEmailInbound`. It builds no RDF and parses no email itself —
 * the entire hostile-input surface is the bridge's already-exhaustively-tested parser.
 *
 * SECURITY (the `ChannelAdapter` contract + §7):
 *  - Every remote read goes through an INJECTED SSRF-guarded `fetch` (default the
 *    `@jeswr/guarded-fetch` node pinning fetch: https-only, private/loopback/metadata-
 *    blocked, DNS-pinned, redirect-refusing). We ALSO set `redirect: "manual"` and refuse
 *    a 3xx ourselves (defence in depth).
 *  - The API base is FIXED to `gmail.googleapis.com` — the OAuth token can never be sent
 *    to another origin.
 *  - The access token (scope `gmail.readonly`) rides ONLY as an `Authorization` header on
 *    the guarded request — never in a URL, never logged, never in an error message.
 *  - Untrusted message ids are shape-validated before they build a URL and are skipped if
 *    unsafe; the batch is capped; a single failed `get` skips that message (never aborts).
 *
 * This adapter is READ-ONLY — it has no `sendReply`. Sending lives in the outbox executor,
 * which is the only component that holds send-scope tokens.
 */

import type { BridgeMessage } from "@jeswr/agentic-legacy-bridge";
import {
  type ChannelAdapter,
  type InboundRawMessage,
  parseEmailInbound,
} from "@jeswr/agentic-legacy-bridge";
import { nodeGuardedFetch } from "@jeswr/guarded-fetch/node";

/** The Gmail REST API base — FIXED so the token is never sent off-origin. */
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_MAX_MESSAGES = 25;
const MAX_MESSAGES_CEILING = 100;

/** Returns a fresh `gmail.readonly` access token for the account (one token per account). */
export type GmailTokenProvider = () => string | Promise<string>;

/** Options for {@link GmailChannelAdapter}. */
export interface GmailChannelAdapterOptions {
  /** The access-token seam — a fresh `gmail.readonly` token per pull. */
  readonly token: GmailTokenProvider;
  /**
   * The SSRF-guarded `fetch` used for every remote read. Defaults to the
   * `@jeswr/guarded-fetch` node pinning fetch. Injectable so the adapter is mock-tested
   * without a live token or network.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** The Gmail user id — `"me"` (default) or a validated email address. */
  readonly userId?: string;
  /** A Gmail search query (e.g. `"newer_than:1d -in:chats"`), optional. */
  readonly query?: string;
  /** Restrict to these Gmail label ids, optional. */
  readonly labelIds?: readonly string[];
  /** Hard cap on messages pulled per batch (default 25, clamped to 1..100). */
  readonly maxMessages?: number;
}

/** Validate a Gmail user id: `"me"` or a plausible email; else `undefined`. */
function safeUserId(userId: string): string | undefined {
  if (userId === "me") return "me";
  // A conservative addr-spec shape — the id only ever goes into an encoded path segment.
  if (/^[^\s@"'<>]{1,254}@[^\s@"'<>]{1,254}$/.test(userId)) return userId;
  return undefined;
}

/** A Gmail message id is opaque; accept only a bounded url-safe alphabet, else skip it. */
function isSafeGmailId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(id);
}

function clampMax(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_MESSAGES;
  return Math.min(MAX_MESSAGES_CEILING, Math.max(1, Math.trunc(value)));
}

/**
 * The Gmail {@link ChannelAdapter}: `parse` is the bridge's `parseEmailInbound`, so a
 * Gmail account plugs into the M2.0 `importInbound` pipeline with zero pipeline changes.
 */
export class GmailChannelAdapter implements ChannelAdapter {
  readonly channel = "email";
  private readonly tokenProvider: GmailTokenProvider;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly userId: string;
  private readonly query: string | undefined;
  private readonly labelIds: readonly string[];
  private readonly maxMessages: number;

  constructor(options: GmailChannelAdapterOptions) {
    const userId = safeUserId(options.userId ?? "me");
    if (!userId) throw new Error("GmailChannelAdapter: invalid userId");
    this.tokenProvider = options.token;
    this.fetchFn = options.fetch ?? nodeGuardedFetch;
    this.userId = userId;
    this.query = options.query;
    this.labelIds = options.labelIds ?? [];
    this.maxMessages = clampMax(options.maxMessages);
  }

  parse(item: InboundRawMessage): BridgeMessage {
    return parseEmailInbound(item);
  }

  /** Pull up to `maxMessages` raw RFC 822 messages. Throws only if the LIST call fails. */
  async pullInbound(): Promise<readonly InboundRawMessage[]> {
    const token = await this.tokenProvider();
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("GmailChannelAdapter: token provider returned no token");
    }
    const authHeaders: Record<string, string> = { authorization: `Bearer ${token}` };

    const ids = await this.listIds(authHeaders);
    const out: InboundRawMessage[] = [];
    for (const id of ids) {
      if (out.length >= this.maxMessages) break;
      const raw = await this.getRaw(id, authHeaders);
      if (raw) out.push({ id, raw });
    }
    return out;
  }

  private async listIds(authHeaders: Record<string, string>): Promise<string[]> {
    const params = new URLSearchParams({ maxResults: String(this.maxMessages) });
    if (this.query !== undefined && this.query.length > 0) {
      params.set("q", this.query.slice(0, 2_000));
    }
    for (const label of this.labelIds.slice(0, 32)) {
      if (typeof label === "string" && label.length > 0) params.append("labelIds", label);
    }
    const url = `${GMAIL_API_BASE}/users/${encodeURIComponent(this.userId)}/messages?${params}`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: authHeaders,
      redirect: "manual",
    });
    if (res.status >= 300) {
      // Includes a refused 3xx — a credentialed read must never follow a redirect.
      throw new Error(`Gmail messages.list failed: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => ({}))) as { messages?: unknown };
    const rows = Array.isArray(body.messages) ? body.messages : [];
    const ids: string[] = [];
    for (const row of rows) {
      if (ids.length >= this.maxMessages) break;
      const id = (row as { id?: unknown })?.id;
      if (isSafeGmailId(id)) ids.push(id);
    }
    return ids;
  }

  private async getRaw(
    id: string,
    authHeaders: Record<string, string>,
  ): Promise<Uint8Array | undefined> {
    const url = `${GMAIL_API_BASE}/users/${encodeURIComponent(this.userId)}/messages/${encodeURIComponent(
      id,
    )}?format=raw`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: "GET", headers: authHeaders, redirect: "manual" });
    } catch {
      return undefined; // a single unreachable message is skipped, never aborts the batch
    }
    if (res.status >= 300) return undefined; // refused redirect / not-ok → skip
    const body = (await res.json().catch(() => ({}))) as { raw?: unknown };
    if (typeof body.raw !== "string" || body.raw.length === 0) return undefined;
    const bytes = Buffer.from(body.raw, "base64url");
    return bytes.length > 0 ? new Uint8Array(bytes) : undefined;
  }
}
