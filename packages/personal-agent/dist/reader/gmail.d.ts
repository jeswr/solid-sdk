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
import { type ChannelAdapter, type InboundRawMessage } from "@jeswr/agentic-legacy-bridge";
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
/**
 * The Gmail {@link ChannelAdapter}: `parse` is the bridge's `parseEmailInbound`, so a
 * Gmail account plugs into the M2.0 `importInbound` pipeline with zero pipeline changes.
 */
export declare class GmailChannelAdapter implements ChannelAdapter {
    readonly channel = "email";
    private readonly tokenProvider;
    private readonly fetchFn;
    private readonly userId;
    private readonly query;
    private readonly labelIds;
    private readonly maxMessages;
    constructor(options: GmailChannelAdapterOptions);
    parse(item: InboundRawMessage): BridgeMessage;
    /** Pull up to `maxMessages` raw RFC 822 messages. Throws only if the LIST call fails. */
    pullInbound(): Promise<readonly InboundRawMessage[]>;
    private listIds;
    private getRaw;
}
//# sourceMappingURL=gmail.d.ts.map