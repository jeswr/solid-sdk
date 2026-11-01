// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ChannelBinding } from "../binding.js";
import { accountId } from "../direct/shared.js";
import { type EmailRenderOptions, emailRenderer } from "../email/render.js";
import {
  type EmailParser,
  emailMessageIdFor,
  inspectEmail,
  verifyProviderCopy,
} from "../email-mime.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import type { OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../profiles.js";
import type { AccountRef, TokenProvider, Wire } from "../types.js";
import type { GmailTenant } from "./errors.js";
import { gmailRest, messageId, rawMessage, record, responseBody } from "./rest.js";

export interface GmailSendOptions extends EmailRenderOptions {
  readonly account: AccountRef;
  /** Read grant used exclusively to reconcile uncertain delivery. */
  readonly tokens: TokenProvider;
  readonly parseEmail: EmailParser;
  readonly transport?: OriginFetchOptions;
  /** Workspace account context for setup guidance; omit for personal Gmail. */
  readonly tenant?: GmailTenant;
  /** Executor verifies a current owner approval bound to these bytes and account. */
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
}
/** Executor-only Gmail send half. Every real send needs a verified owner approval. */
export function createGmailSend(options: GmailSendOptions): NonNullable<ChannelBinding["send"]> {
  const renderer = emailRenderer(options);
  const account = Object.freeze({ id: accountId(options.account) });
  const verifyApproval = options.verifyApproval;
  const lookupTokens = options.tokens;
  const recipients = new Map(options.recipients);
  const parseEmail = options.parseEmail;
  const footer = options.footer ?? AGENT_FOOTER;
  const rest = gmailRest(options.transport, options.tenant);
  async function checked(wire: Wire) {
    const snapshot = renderer.assertWire(wire);
    // Strict parity here always: a local outbound entry may never be lenient.
    const parsed = inspectEmail(snapshot.bytes, {
      parseEmail,
      footer,
      recipient: "outbound@agent.invalid",
      ownAccounts: new Set(["outbound@agent.invalid"]),
    });
    if (
      !parsed.proposal ||
      (await renderer.render(parsed.proposal, EMAIL_MIME)).bytes !== snapshot.bytes
    )
      throw new ChannelParseError("email wire differs from signed proposal");
    return { snapshot, proposal: parsed.proposal };
  }
  return {
    render: renderer.render,
    validate: renderer.validate,
    async transmit(wire, io) {
      if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
      if (accountId(io.account) !== account.id)
        throw new ProviderRejectedError("Gmail account differs from configured sender");
      const { snapshot, proposal } = await checked(wire);
      const response = await rest(
        "/messages/send",
        account,
        io.tokens,
        "send",
        JSON.stringify({ raw: Buffer.from(snapshot.bytes).toString("base64url") }),
        async () => {
          renderer.current(proposal.message);
          if (
            typeof verifyApproval !== "function" ||
            (await verifyApproval(Object.freeze({ ...snapshot }), account)) !== true
          )
            throw new ProviderRejectedError("owner approval required");
          renderer.current(proposal.message);
        },
      );
      if (response.status === 400) throw new ProviderRejectedError("Gmail send refused: HTTP 400");
      if (!response.ok) throw new Error(`Gmail send uncertain: HTTP ${response.status}`);
      let id: string;
      try {
        id = messageId(record(await response.json()).id);
      } catch {
        throw new Error("Gmail send uncertain: invalid acknowledgement");
      }
      return { outcome: "accepted", providerRef: id };
    },
    async lookup(wire) {
      try {
        const { snapshot, proposal } = await checked(wire);
        const q = `rfc822msgid:${emailMessageIdFor(proposal.message.id)} in:anywhere`;
        const params = new URLSearchParams({ q, maxResults: "10" });
        const body = await responseBody(
          await rest(`/messages?${params}`, account, lookupTokens, "read"),
        );
        if (body.messages !== undefined && !Array.isArray(body.messages))
          throw new ChannelParseError("invalid Gmail search result");
        const ids = ((body.messages ?? []) as unknown[])
          .map((row) => messageId(record(row).id))
          .slice(0, 10);
        const recipient = recipients.get(proposal.message.to?.actor as string) as string;
        for (const id of ids) {
          try {
            const response = await rest(
              `/messages/${id}?format=raw`,
              account,
              lookupTokens,
              "read",
            );
            if (response.status === 404) continue;
            const copy = rawMessage(await responseBody(response), id);
            if (
              verifyProviderCopy(copy.raw, {
                sent: snapshot.bytes,
                config: { parseEmail, recipient, ownAccounts: new Set([recipient]), footer },
              })
            )
              return { outcome: "found", providerRef: id };
          } catch {
            /* One unreadable candidate cannot prove or disprove delivery. */
          }
        }
        return { outcome: "unknown", detail: "no verified Gmail provider copy" };
      } catch {
        return { outcome: "unknown", detail: "Gmail lookup could not verify a provider copy" };
      }
    },
    // A Gmail search miss is never causally final. No finalAbsence.
  };
}
