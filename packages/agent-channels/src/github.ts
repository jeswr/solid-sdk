// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, digestBytes, parseBoundedJson } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: the agent layer permits only bare builtin imports
import { execFile } from "child_process";
import type { CarriageProfile, ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { ChannelParseError } from "./errors.js";
import type { AccountRef } from "./types.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const PAGE_SIZE = 50;
const JSON_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxEnvelopeBytes: MAX_OUTPUT_BYTES,
  maxJsonNodes: 20_000,
});
const CURSOR_LIMITS = Object.freeze({ ...DEFAULT_LIMITS, maxEnvelopeBytes: 16 * 1024 });

/** gh owns authentication; this binding never obtains or handles tokens. */
export const ORIGINS: ReadonlySet<string> = new Set(["https://api.github.com"]);
/** No outbound carrier is implemented, so the send byte limit is zero. */
export const GITHUB_READ_ONLY: CarriageProfile = Object.freeze({
  id: "github-read-only/0.1",
  structured: "footer-url-only",
  footer: "none",
  maxBytes: 0,
});

export interface GithubReaderOptions {
  /** Opaque account associated by the daemon with this process's active gh auth context. */
  readonly account: AccountRef;
  readonly now?: () => number;
}

interface Checkpoint {
  account: string;
  since: string | null;
  before: string | null;
  page: number;
  offset: number;
}

function accountId(account: AccountRef): string {
  if (typeof account?.id !== "string" || !account.id.trim() || account.id.length > 2048)
    throw new TypeError("invalid GitHub account reference");
  return account.id;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid GitHub record");
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().replace(".000Z", "Z") === value
  );
}

function json(text: string, limits: typeof DEFAULT_LIMITS = JSON_LIMITS): unknown {
  try {
    return parseBoundedJson(text, limits);
  } catch {
    // Never expose provider content or parser diagnostics through errors.
    throw new ChannelParseError("invalid or oversized GitHub JSON");
  }
}

function threadId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,39}$/.test(value))
    throw new ChannelParseError("invalid GitHub thread id");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new ChannelParseError("invalid GitHub metadata text");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip untrusted metadata controls
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function notification(raw: string) {
  const value = record(json(raw, DEFAULT_LIMITS));
  const id = threadId(value.id);
  if (!timestamp(value.updated_at)) throw new ChannelParseError("invalid GitHub update time");
  const subject = record(value.subject);
  const repository = record(value.repository);
  return {
    id,
    updated: value.updated_at,
    title: text(subject.title),
    type: text(subject.type),
    repository: text(repository.full_name),
    reason: text(value.reason),
  };
}

function checkpoint(cursor: string | undefined, account: string): Checkpoint {
  if (cursor === undefined) return { account, since: null, before: null, page: 1, offset: 0 };
  if (typeof cursor !== "string") throw new TypeError("invalid GitHub cursor");
  const value = record(json(cursor, CURSOR_LIMITS));
  if (
    Object.keys(value).length !== 5 ||
    value.account !== account ||
    !(value.since === null || timestamp(value.since)) ||
    !(value.before === null || timestamp(value.before)) ||
    typeof value.page !== "number" ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    value.offset >= PAGE_SIZE ||
    (value.before === null && (value.page !== 1 || value.offset !== 0)) ||
    (typeof value.before === "string" &&
      typeof value.since === "string" &&
      value.since > value.before)
  )
    throw new TypeError("invalid GitHub cursor");
  return value as unknown as Checkpoint;
}

/** Fixed executable, fixed host and method, argument array, bounded buffers/deadline; no shell. */
async function gh(endpoint: string): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "--header",
          "Accept: application/vnd.github+json",
          endpoint,
        ],
        {
          encoding: "utf8",
          shell: false,
          timeout: 30_000,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });
  } catch {
    // execFile errors can include stdout/stderr. Discard them, including the cause.
    throw new Error("GitHub CLI request failed");
  }
}

/** Read-only notification metadata. The daemon must not switch gh accounts during a pull. */
export function createGithubReader(options: GithubReaderOptions): ChannelBinding {
  const configuredAccount = accountId(options.account);
  const now = options.now ?? Date.now;
  return {
    id: "github",
    carriage: GITHUB_READ_ONLY,
    origins: new Set(ORIGINS),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:github",
        channel: "github",
        binding: "github",
        carriage: GITHUB_READ_ONLY.id,
        structuredPayload: false,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "P0D",
        maxMessageBytes: 0,
        sendSupported: false,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(account, cursor, limits) {
        const id = accountId(account);
        if (id !== configuredAccount) throw new TypeError("GitHub account does not match reader");
        const { maxItems, maxBytes } = limits;
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        const state = checkpoint(cursor, id);
        if (state.before === null)
          state.before = new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
        if (!timestamp(state.before) || (state.since !== null && state.since > state.before))
          throw new TypeError("invalid GitHub polling window");
        const query = new URLSearchParams({
          all: "true",
          per_page: String(PAGE_SIZE),
          page: String(state.page),
          before: state.before,
        });
        // Overlap one second at a completed checkpoint; stable ids deduplicate boundary replays.
        if (state.since !== null)
          query.set(
            "since",
            new Date(Date.parse(state.since) - 1000).toISOString().replace(".000Z", "Z"),
          );
        const response = json(await gh(`/notifications?${query}`));
        if (
          !Array.isArray(response) ||
          response.length > PAGE_SIZE ||
          state.offset > response.length
        )
          throw new ChannelParseError("invalid GitHub notification page");
        // Validate all ids before constructing any endpoint. Never follow provider-supplied URLs.
        const ids = response.map((entry) => threadId(record(entry).id));
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        while (state.offset < ids.length && items.length < maxItems) {
          const expectedId = ids[state.offset];
          const raw = await gh(`/notifications/threads/${expectedId}`);
          const detail = notification(raw);
          if (detail.id !== expectedId) throw new ChannelParseError("GitHub thread id mismatch");
          const size = Buffer.byteLength(raw);
          if (bytes + size > maxBytes) {
            if (items.length === 0) throw new RangeError("next item exceeds byte bound");
            break;
          }
          bytes += size;
          items.push({ id: `github:${detail.id}:${detail.updated}`, raw });
          state.offset++;
        }
        if (state.offset === ids.length) {
          if (ids.length < PAGE_SIZE) {
            state.since = state.before;
            state.before = null;
            state.page = 1;
          } else state.page++;
          state.offset = 0;
        }
        return { items, next: JSON.stringify(state) };
      },
      parse(item) {
        // Check bytes before copying or decoding an untrusted binary input.
        if (Buffer.byteLength(item.raw) > DEFAULT_LIMITS.maxEnvelopeBytes)
          throw new ChannelParseError("invalid or oversized GitHub JSON");
        const raw =
          typeof item.raw === "string" ? item.raw : Buffer.from(item.raw).toString("utf8");
        const detail = notification(raw);
        if (item.id !== `github:${detail.id}:${detail.updated}`)
          throw new ChannelParseError("GitHub message id mismatch");
        const signals: Record<string, string> = Object.create(null);
        signals["github-repository"] = detail.repository;
        signals["github-reason"] = detail.reason;
        signals["github-subject-type"] = detail.type;
        return {
          channel: "github",
          messageId: item.id,
          threadId: `github:${detail.id}`,
          subject: detail.title,
          textBody: detail.title,
          date: detail.updated,
          signals: Object.freeze(signals),
          rawSha256: digestBytes(item.raw).slice("sha-256:".length),
          rawByteLength: Buffer.byteLength(item.raw),
          rawMediaType: "application/json",
          warnings: [],
        };
      },
      threadKey(message) {
        return message.threadId;
      },
    },
  };
}
