// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { assertJsonBounds, canonicalJson, digestBytes, validateMessage } from "@jeswr/agent-model";
import type { CarriageProfile, ChannelBinding } from "../binding.js";
import { accountId, assertGrant } from "../direct/shared.js";
import { summaryLines } from "../email/bodies.js";
import { assertFooter, decodeEmailProposal } from "../email-mime.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, DISCORD_FOOTER } from "../profiles.js";
import { sendAttempt } from "../provider/attempt.js";
import type { AccountRef, RenderableProposal, Wire } from "../types.js";
import { preview } from "./preview.js";
import { readJson, snowflake } from "./shared.js";

export interface DiscordSendOptions {
  readonly account: AccountRef;
  /** Trusted actor -> existing guild/DM channel. Never take a channel from inbound content. */
  readonly recipients: ReadonlyMap<string, string>;
  readonly footer?: string;
  /** Pure local verifier of the pinned signing key and intended audience. */
  readonly verify: (compactJws: string) => Promise<unknown>;
  /** Load the signed proposal from the executor's local outbox, by the approved wire digest.
   * Discord carries no signed envelope, so it cannot be recovered from wire bytes. */
  readonly resolveProposal: (wire: Wire) => Promise<RenderableProposal>;
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
  readonly now?: () => number;
  readonly transport?: OriginFetchOptions;
}
/** Executor-only send half. Nothing is transmitted without exact bytes and current approval. */
export function createDiscordSend(
  options: DiscordSendOptions,
): NonNullable<ChannelBinding["send"]> {
  const account = Object.freeze({ id: accountId(options.account) });
  const recipients = new Map(options.recipients);
  for (const id of recipients.values()) snowflake(id);
  const footer = options.footer ?? AGENT_FOOTER;
  assertFooter(footer);
  const card = footer.match(/https:\/\/[^\s<>"']+/)?.[0];
  if (!card || new URL(card).username || new URL(card).password)
    throw new ChannelParseError("Discord footer requires an HTTPS card URL");
  const verify = options.verify;
  const resolveProposal = options.resolveProposal;
  const verifyApproval = options.verifyApproval;
  const now = options.now ?? Date.now;
  const request = createOriginScopedFetch(new Set(["https://discord.com"]), options.transport);
  function current(message: RenderableProposal["message"]) {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(message.createdAt) > at ||
      Date.parse(message.expiresAt) <= at
    )
      throw new ChannelParseError("Discord message is expired or not yet valid");
  }
  async function prepare(proposal: RenderableProposal) {
    // Snapshot both the signed bytes and proposed content before an async verifier can yield.
    const compactJws = proposal.compactJws;
    const decoded = decodeEmailProposal(compactJws);
    assertJsonBounds(proposal.message);
    const proposed = canonicalJson(proposal.message);
    const payload = await verify(compactJws);
    assertJsonBounds(payload);
    const result = validateMessage(payload);
    if (
      !result.ok ||
      canonicalJson(result.message) !== proposed ||
      canonicalJson(decoded.message) !== proposed
    )
      throw new ChannelParseError("Discord signed payload differs from proposal");
    const message = decoded.message;
    const channel = message.to && recipients.get(message.to.actor);
    if (!channel) throw new ChannelParseError("no pinned Discord recipient");
    const content = ["Sent by a software agent.", ...summaryLines(message)].join("\n");
    if (content.length > 2000 || /[\p{Cc}\p{Cf}]/u.test(content.replaceAll("\n", "")))
      throw new ChannelParseError("Discord content exceeds limit or contains controls");
    const body = {
      content,
      embeds: [{ footer: { text: footer } }],
      allowed_mentions: { parse: [] },
      enforce_nonce: true,
    };
    // Bind all reviewed content as well as the destination and signed message.
    // A changed footer/renderer must not deduplicate against different provider bytes.
    const identity = digestBytes(canonicalJson({ channel, compactJws, body })).slice(
      "sha-256:".length,
    );
    const nonce = Buffer.from(identity, "hex").toString("base64url").slice(0, 25);
    const bytes = canonicalJson({ ...body, nonce });
    if (Buffer.byteLength(bytes) > DISCORD_FOOTER.maxBytes)
      throw new ChannelParseError("Discord message exceeds local byte cap");
    return {
      wire: { bytes, mediaType: "application/json", digest: digestBytes(bytes) },
      message,
      channel,
    };
  }
  function snapshot(input: Wire): Wire {
    const wire = Object.freeze({
      bytes: input.bytes,
      mediaType: input.mediaType,
      digest: input.digest,
    });
    if (
      Reflect.ownKeys(input).length !== 3 ||
      wire.mediaType !== "application/json" ||
      typeof wire.bytes !== "string" ||
      Buffer.byteLength(wire.bytes) > DISCORD_FOOTER.maxBytes ||
      wire.digest !== digestBytes(wire.bytes)
    )
      throw new ChannelParseError("invalid Discord wire");
    return wire;
  }
  async function render(proposal: RenderableProposal, carriage: CarriageProfile) {
    if (canonicalJson(carriage) !== canonicalJson(DISCORD_FOOTER))
      throw new ChannelParseError("unsupported Discord carriage");
    return (await prepare(proposal)).wire;
  }
  return {
    render,
    preview,
    async validate(wire, proposal) {
      try {
        const copy = snapshot(wire);
        const expected = await prepare(proposal);
        current(expected.message);
        return copy.bytes === expected.wire.bytes
          ? { ok: true }
          : { ok: false, reason: "terms-digest-mismatch" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    transmit(wire, io) {
      return sendAttempt(async (dispatched) => {
        if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
        if (accountId(io.account) !== account.id)
          throw new ProviderRejectedError("Discord account differs from configured bot");
        const copy = snapshot(wire);
        const expected = await prepare(await resolveProposal(copy));
        if (expected.wire.bytes !== copy.bytes)
          throw new ChannelParseError("Discord wire differs from signed proposal");
        current(expected.message);
        const grant = await io.tokens.send(account);
        assertGrant(grant, "send");
        current(expected.message);
        if (typeof verifyApproval !== "function" || (await verifyApproval(copy, account)) !== true)
          throw new ProviderRejectedError("owner approval required");
        current(expected.message);
        const response = await request(
          `https://discord.com/api/v10/channels/${expected.channel}/messages`,
          {
            beforeDispatch: () => {
              current(expected.message);
              io.assertAuthority();
              dispatched();
            },
            method: "POST",
            headers: {
              authorization: `Bot ${grant.accessToken}`,
              "content-type": "application/json",
            },
            body: copy.bytes,
          },
        );
        if ([400, 401, 403, 404, 405, 413, 429].includes(response.status))
          throw new ProviderRejectedError(`Discord send refused: HTTP ${response.status}`);
        if (!response.ok) throw new Error(`Discord send uncertain: HTTP ${response.status}`);
        try {
          const { value } = readJson(await response.text());
          if (value.channel_id !== expected.channel) throw new Error("channel mismatch");
          return { outcome: "accepted", providerRef: snowflake(value.id) };
        } catch {
          throw new Error("Discord send uncertain: invalid acknowledgement");
        }
      });
    },
    // No lookup or finalAbsence: absence from a Gateway stream cannot prove non-delivery.
  };
}
