// AUTHORED-BY Codex GPT-6.1-Sol

import { assertJsonBounds, canonicalJson, digestBytes, validateMessage } from "@jeswr/agent-model";
import type { ChannelBinding } from "../binding.js";
import { accountId } from "../direct/shared.js";
import { summaryLines } from "../email/bodies.js";
import { assertFooter, decodeEmailProposal } from "../email-mime.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import { record } from "../graph-mail/rest.js";
import type { OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, TEAMS_CARD } from "../profiles.js";
import { sendAttempt } from "../provider/attempt.js";
import type { AccountRef, RenderableProposal, Wire } from "../types.js";
import { card, envelopes } from "./card.js";
import { preview } from "./preview.js";
import { BASE, graphTeamsRest, id, json, responseJson } from "./rest.js";

const MEDIA_TYPE = "application/vnd.jeswr.teams-message+json";
export interface GraphTeamsSendOptions {
  readonly account: AccountRef;
  /** Trusted actor -> existing chat. Inbound IDs never select a send destination. */
  readonly recipients: ReadonlyMap<string, string>;
  readonly verify: (compactJws: string) => Promise<unknown>;
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
  /** Pure, stable ID derived from the signed content; injectable for fixtures. */
  readonly attachmentIdFor?: (compactJws: string) => string;
  readonly footer?: string;
  readonly now?: () => number;
  readonly transport?: OriginFetchOptions;
}
/** Executor-only chat sends; the approved wire binds the account, chat and exact request. */
export function createGraphTeamsSend(
  options: GraphTeamsSendOptions,
): NonNullable<ChannelBinding["send"]> {
  const account = Object.freeze({ id: accountId(options.account) });
  const recipients = new Map(options.recipients);
  for (const chat of recipients.values()) id(chat);
  const verify = options.verify;
  const verifyApproval = options.verifyApproval;
  const attachmentIdFor =
    options.attachmentIdFor ?? ((compactJws: string) => digestBytes(compactJws).slice(8, 40));
  const now = options.now ?? Date.now;
  const footer = options.footer ?? AGENT_FOOTER;
  assertFooter(footer);
  const rest = graphTeamsRest(options.transport);
  function current(proposal: RenderableProposal) {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(proposal.message.createdAt) > at ||
      Date.parse(proposal.message.expiresAt) <= at
    )
      throw new ChannelParseError("Teams proposal is expired or not yet valid");
  }
  const render: NonNullable<ChannelBinding["send"]>["render"] = async (proposal, carriage) => {
    if (canonicalJson(carriage) !== canonicalJson(TEAMS_CARD))
      throw new ChannelParseError("unsupported Teams carriage");
    const compactJws = proposal.compactJws;
    const decoded = decodeEmailProposal(compactJws);
    assertJsonBounds(proposal.message);
    const proposed = canonicalJson(proposal.message);
    const payload = await verify(compactJws);
    assertJsonBounds(payload);
    const checked = validateMessage(payload);
    if (
      !checked.ok ||
      canonicalJson(checked.message) !== proposed ||
      canonicalJson(decoded.message) !== proposed
    )
      throw new ChannelParseError("Teams signed payload differs from proposal");
    const message = decoded.message;
    const chat = message.to && recipients.get(message.to.actor);
    if (!chat) throw new ChannelParseError("no pinned Teams recipient");
    const text = ["Sent by a software agent.", ...summaryLines(message), footer].join("\n");
    if (/[\p{Cc}\p{Cf}]/u.test(text.replaceAll("\n", "")))
      throw new ChannelParseError("Teams content contains controls");
    const attachmentId = attachmentIdFor(compactJws);
    if (typeof attachmentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(attachmentId))
      throw new ChannelParseError("invalid Teams attachment id");
    const content = `${text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
      // HTML collapses newlines; <br> keeps the visible lines (ingest maps it back to "\n").
      .replaceAll("\n", "<br>")}<attachment id="${attachmentId}"></attachment>`;
    const bytes = canonicalJson({
      account: account.id,
      chat,
      request: {
        body: { contentType: "html", content },
        attachments: [card(text, compactJws, attachmentId)],
      },
    });
    if (Buffer.byteLength(bytes) > TEAMS_CARD.maxBytes)
      throw new ChannelParseError("Teams wire exceeds byte cap");
    return { bytes, mediaType: MEDIA_TYPE, digest: digestBytes(bytes) };
  };
  function snapshot(input: Wire): Wire {
    const wire = Object.freeze({
      bytes: input.bytes,
      mediaType: input.mediaType,
      digest: input.digest,
    });
    if (
      Reflect.ownKeys(input).length !== 3 ||
      wire.mediaType !== MEDIA_TYPE ||
      typeof wire.bytes !== "string" ||
      Buffer.byteLength(wire.bytes) > TEAMS_CARD.maxBytes ||
      wire.digest !== digestBytes(wire.bytes)
    )
      throw new ChannelParseError("invalid Teams wire");
    return wire;
  }
  async function checked(input: Wire) {
    const wire = snapshot(input);
    const plan = json(wire.bytes);
    const request = record(plan.request);
    const blocks = envelopes(request.attachments);
    if (blocks.length !== 1) throw new ChannelParseError("Teams wire requires one envelope");
    const proposal = decodeEmailProposal(json(blocks[0] as string)["agent:compactJws"] as string);
    if ((await render(proposal, TEAMS_CARD)).bytes !== wire.bytes)
      throw new ChannelParseError("Teams wire differs from signed proposal");
    return { wire, proposal, chat: id(plan.chat), body: canonicalJson(request) };
  }
  return {
    render,
    preview,
    async validate(input, proposal) {
      try {
        const wire = snapshot(input);
        const compactJws = proposal.compactJws;
        const expected = await render({ message: proposal.message, compactJws }, TEAMS_CARD);
        current(decodeEmailProposal(compactJws));
        return wire.bytes === expected.bytes
          ? { ok: true }
          : { ok: false, reason: "terms-digest-mismatch" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    transmit(input, io) {
      return sendAttempt(async (dispatched) => {
        if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
        if (accountId(io.account) !== account.id)
          throw new ProviderRejectedError("Teams account differs from configured sender");
        const { wire, proposal, chat, body } = await checked(input);
        current(proposal);
        const response = await rest(
          `${BASE}/chats/${encodeURIComponent(chat)}/messages`,
          account,
          io.tokens,
          "send",
          body,
          async () => {
            current(proposal);
            if (
              typeof verifyApproval !== "function" ||
              (await verifyApproval(wire, account)) !== true
            )
              throw new ProviderRejectedError("owner approval required");
            current(proposal);
          },
          () => {
            current(proposal);
            io.assertAuthority();
            dispatched();
          },
        );
        if ([400, 401, 403, 404, 405, 413, 429].includes(response.status))
          throw new ProviderRejectedError(`Teams send refused: HTTP ${response.status}`);
        if (!response.ok) throw new Error(`Teams send uncertain: HTTP ${response.status}`);
        try {
          // Only the ID is needed. Teams responseJson permits the existing 64 KiB
          // body/card strings and 1 MiB response cap, retaining JSON depth/node bounds.
          return { outcome: "accepted", providerRef: id((await responseJson(response)).id) };
        } catch {
          throw new Error("Teams send uncertain: invalid acknowledgement");
        }
      });
    },
    // No automatic POST retry, lookup or final-absence claim: Graph offers no idempotency key.
  };
}
