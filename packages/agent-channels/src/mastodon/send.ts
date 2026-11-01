// AUTHORED-BY Codex GPT-6.1-Sol
import {
  assertJsonBounds,
  canonicalJson,
  DEFAULT_LIMITS,
  digestBytes,
  parseBoundedJson,
  validateMessage,
} from "@jeswr/agent-model";
import type { ChannelBinding } from "../binding.js";
import { accountId } from "../direct/shared.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import type { OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, MASTODON_FOOTER } from "../profiles.js";
import type { AccountRef, RenderableProposal, Wire } from "../types.js";
import {
  DEFAULT_INSTANCE,
  id,
  instanceOrigin,
  mastodonRest,
  recipientHandle,
  record,
  responseJson,
} from "./rest.js";

/** Local wire retains signed evidence; only its exact request is posted to Mastodon. */
const MEDIA_TYPE = "application/vnd.jeswr.mastodon-status+json";
const WIRE_LIMITS = { ...DEFAULT_LIMITS, maxEnvelopeBytes: 96 * 1024, maxStringLength: 64 * 1024 };
export interface MastodonSendOptions {
  readonly instance?: string;
  readonly account: AccountRef;
  /** Trusted actor -> one Mastodon acct; never resolved from inbound or model-supplied mentions. */
  readonly recipients: ReadonlyMap<string, string>;
  /** Pure local verifier checking the pinned sender key and intended audience. */
  readonly verify: (compactJws: string) => Promise<unknown>;
  /** Executor verifies current owner approval bound to the complete wire and sender account. */
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
  readonly now?: () => number;
  readonly transport?: OriginFetchOptions;
}
function decode(compactJws: string): RenderableProposal {
  try {
    if (
      typeof compactJws !== "string" ||
      compactJws.length > DEFAULT_LIMITS.maxEnvelopeBytes ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws)
    )
      throw new Error();
    const payload = Buffer.from(compactJws.split(".")[1] as string, "base64url");
    const checked = validateMessage(
      parseBoundedJson(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
    );
    if (!checked.ok) throw new Error();
    return { message: checked.message, compactJws };
  } catch {
    throw new ChannelParseError("invalid Mastodon signed proposal");
  }
}
/** Executor-only send half. Footer-only carriage never posts the local signed envelope. */
export function createMastodonSend(
  options: MastodonSendOptions,
): NonNullable<ChannelBinding["send"]> {
  const origin = instanceOrigin(options.instance ?? DEFAULT_INSTANCE);
  const account = Object.freeze({ id: accountId(options.account) });
  const recipients = new Map(options.recipients);
  for (const [actor, recipient] of recipients) recipients.set(actor, recipientHandle(recipient));
  const verify = options.verify;
  const verifyApproval = options.verifyApproval;
  const now = options.now ?? Date.now;
  const rest = mastodonRest(origin, options.transport);
  function current(proposal: RenderableProposal) {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(proposal.message.createdAt) > at ||
      Date.parse(proposal.message.expiresAt) <= at
    )
      throw new ChannelParseError("Mastodon proposal is expired or not yet valid");
  }
  const render: NonNullable<ChannelBinding["send"]>["render"] = async (proposal, carriage) => {
    if (canonicalJson(carriage) !== canonicalJson(MASTODON_FOOTER))
      throw new ChannelParseError("unsupported Mastodon carriage");
    const compactJws = proposal.compactJws;
    const decoded = decode(compactJws);
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
      throw new ChannelParseError("Mastodon signed payload differs from proposal");
    const message = checked.message;
    const recipient = message.to && recipients.get(message.to.actor);
    if (!recipient) throw new ChannelParseError("no pinned Mastodon recipient");
    // Only the pinned recipient is a mention. Arbitrary body strings cannot add recipients.
    const summary = `Agent ${message.kind}: ${canonicalJson(message.body).replaceAll("@", "＠")}`;
    const status = `@${recipient}\n${summary}\n${AGENT_FOOTER}`;
    if (Buffer.byteLength(status) > MASTODON_FOOTER.maxBytes)
      throw new ChannelParseError("Mastodon status exceeds byte cap");
    const bytes = canonicalJson({
      instance: origin,
      account: account.id,
      compactJws,
      request: { status, visibility: "direct" },
    });
    // Bounded JWS, origin, account and status together fit below the local wire ceiling.
    return { bytes, mediaType: MEDIA_TYPE, digest: digestBytes(bytes) };
  };
  function snapshot(input: Wire): Wire {
    const wire = { bytes: input.bytes, mediaType: input.mediaType, digest: input.digest };
    if (
      Reflect.ownKeys(input).length !== 3 ||
      wire.mediaType !== MEDIA_TYPE ||
      typeof wire.bytes !== "string" ||
      Buffer.byteLength(wire.bytes) > WIRE_LIMITS.maxEnvelopeBytes ||
      wire.digest !== digestBytes(wire.bytes)
    )
      throw new ChannelParseError("invalid Mastodon wire");
    return Object.freeze(wire);
  }
  async function checked(input: Wire) {
    const wire = snapshot(input);
    const plan = record(parseBoundedJson(wire.bytes, WIRE_LIMITS));
    const proposal = decode(plan.compactJws as string);
    if ((await render(proposal, MASTODON_FOOTER)).bytes !== wire.bytes)
      throw new ChannelParseError("Mastodon wire differs from signed proposal");
    return { wire, proposal, body: canonicalJson(record(plan.request)) };
  }
  return {
    render,
    async validate(wire, proposal) {
      try {
        const actual = snapshot(wire);
        const compactJws = proposal.compactJws;
        const expected = await render({ message: proposal.message, compactJws }, MASTODON_FOOTER);
        current(decode(compactJws));
        return actual.bytes === expected.bytes
          ? { ok: true }
          : { ok: false, reason: "terms-digest-mismatch" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    async transmit(input, io) {
      if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
      if (accountId(io.account) !== account.id)
        throw new ProviderRejectedError("Mastodon account differs from configured sender");
      const { wire, proposal, body } = await checked(input);
      current(proposal);
      const response = await rest("/api/v1/statuses", account, io.tokens, "send", {
        body,
        key: wire.digest,
        async beforeRequest() {
          current(proposal);
          if (
            typeof verifyApproval !== "function" ||
            (await verifyApproval(wire, account)) !== true
          )
            throw new ProviderRejectedError("owner approval required");
          current(proposal);
        },
      });
      if ([400, 401, 403, 404, 422].includes(response.status))
        throw new ProviderRejectedError(`Mastodon send refused: HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Mastodon send uncertain: HTTP ${response.status}`);
      try {
        const accepted = record(await responseJson(response));
        const providerRef = id(accepted.id);
        if (accepted.visibility !== "direct") throw new Error();
        return { outcome: "accepted", providerRef };
      } catch {
        throw new Error("Mastodon send uncertain: invalid acknowledgement");
      }
    },
    // No automatic retry, lookup or final absence claim for footer-only statuses.
  };
}
