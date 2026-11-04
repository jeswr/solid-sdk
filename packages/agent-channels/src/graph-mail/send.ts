// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { canonicalJson } from "@jeswr/agent-model";
import type { ChannelBinding } from "../binding.js";
import { accountId } from "../direct/shared.js";
import { renderBodies } from "../email/bodies.js";
import { headerValues, parseMime } from "../email/mime.js";
import { type EmailRenderOptions, emailRenderer } from "../email/render.js";
import { type EmailParser, emailMessageIdFor, inspectEmail } from "../email-mime.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import type { OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../profiles.js";
import { sendAttempt } from "../provider/attempt.js";
import type { AccountRef, RenderableProposal, TokenProvider, Wire } from "../types.js";
import { graphMailRest, messageId, mimeBody, record, responseBody } from "./rest.js";

export interface GraphMailSendOptions extends EmailRenderOptions {
  readonly account: AccountRef;
  /** Separate read grant used only for uncertain-send reconciliation. */
  readonly tokens: TokenProvider;
  readonly parseEmail: EmailParser;
  readonly transport?: OriginFetchOptions;
  /** Executor verifies a current owner approval bound to these bytes and account. */
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
}
/** Parse one bare addr-spec or name-addr; lists and ambiguous routing syntax fail closed. */
function mailboxMatches(values: readonly string[], expected: string): boolean {
  if (values.length !== 1) return false;
  const value = values[0] as string;
  if (value === expected) return true;
  const mailbox = /^(.*?)<([^<>\s]+)>$/.exec(value);
  return (
    mailbox !== null &&
    mailbox[2] === expected &&
    /^(?:[^()<>[\]:;@\\,"\p{Cc}]*|"(?:[^"\\\p{Cc}]|\\[ -~])*")$/u.test(
      (mailbox[1] as string).trim().replaceAll("\t", " "),
    )
  );
}
/** Graph constructs MIME from JSON, so boundaries and dates cannot match the local wire. */
function verifiedCopy(
  raw: Uint8Array,
  proposal: RenderableProposal,
  config: { from: string; recipient: string; footer: string; parseEmail: EmailParser },
): boolean {
  const tree = parseMime(raw);
  if (!tree.ok) return false;
  // No extra routing or reply destination is implied by the approved JSON projection.
  if (
    tree.root.headers.some(
      ([name]) => ["cc", "bcc", "reply-to", "sender"].includes(name) || name.startsWith("resent-"),
    )
  )
    return false;
  if (
    !mailboxMatches(headerValues(tree.root, "from"), config.from) ||
    !mailboxMatches(headerValues(tree.root, "to"), config.recipient)
  )
    return false;
  const headers = {
    subject: `[Agent] ${proposal.message.kind}`,
    "message-id": emailMessageIdFor(proposal.message.id),
    "x-agentic-reply": "1",
  };
  if (
    !Object.entries(headers).every(
      ([name, value]) => canonicalJson(headerValues(tree.root, name)) === canonicalJson([value]),
    )
  )
    return false;
  // STRICT parity still checks every MIME leaf, human copy and structured carrier.
  const parsed = inspectEmail(raw, { ...config, ownAccounts: new Set([config.recipient]) });
  return parsed.parity === "match" && parsed.proposal?.compactJws === proposal.compactJws;
}
/** Executor-only Graph send half. The owner approves canonical MIME before JSON projection. */
export function createGraphMailSend(
  options: GraphMailSendOptions,
): NonNullable<ChannelBinding["send"]> {
  const renderer = emailRenderer(options);
  const account = Object.freeze({ id: accountId(options.account) });
  const from = options.from;
  const recipients = new Map(options.recipients);
  const verifyApproval = options.verifyApproval;
  const lookupTokens = options.tokens;
  const parseEmail = options.parseEmail;
  const footer = options.footer ?? AGENT_FOOTER;
  const rest = graphMailRest(options.transport);
  async function checked(wire: Wire) {
    const snapshot = renderer.assertWire(wire);
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
    transmit(wire, io) {
      return sendAttempt(async (dispatched) => {
        if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
        if (accountId(io.account) !== account.id)
          throw new ProviderRejectedError("Graph account differs from configured sender");
        const { snapshot, proposal } = await checked(wire);
        const { message, compactJws } = proposal;
        // These are the same deterministic bodies checked against the reviewed MIME above.
        // Graph JSON accepts one HTML body; Exchange generates the text/plain alternative.
        const { html, carrier } = renderBodies(message, compactJws, footer);
        const internetMessageId = emailMessageIdFor(message.id);
        const body = JSON.stringify({
          message: {
            from: { emailAddress: { address: from } },
            toRecipients: [
              { emailAddress: { address: recipients.get(message.to?.actor as string) } },
            ],
            subject: `[Agent] ${message.kind}`,
            internetMessageId,
            body: { contentType: "HTML", content: html },
            internetMessageHeaders: [{ name: "X-Agentic-Reply", value: "1" }],
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: "agent-message.jsonld",
                contentType: "application/ld+json",
                contentBytes: Buffer.from(carrier).toString("base64"),
              },
            ],
          },
          saveToSentItems: true,
        });
        const response = await rest(
          "/sendMail",
          account,
          io.tokens,
          "send",
          body,
          async () => {
            renderer.current(message);
            if (
              typeof verifyApproval !== "function" ||
              (await verifyApproval(Object.freeze({ ...snapshot }), account)) !== true
            )
              throw new ProviderRejectedError("owner approval required");
            renderer.current(message);
          },
          () => {
            renderer.current(message);
            io.assertAuthority();
            dispatched();
          },
        );
        if (response.status === 400)
          throw new ProviderRejectedError("Graph send refused: HTTP 400");
        if (response.status !== 202)
          throw new Error(`Graph send uncertain: HTTP ${response.status}`);
        // sendMail has no response body or provider object ID. Acceptance is not delivery.
        return { outcome: "accepted", providerRef: internetMessageId };
      });
    },
    async lookup(wire) {
      try {
        const { proposal } = await checked(wire);
        const internetMessageId = emailMessageIdFor(proposal.message.id);
        const params = new URLSearchParams([
          ["$filter", `internetMessageId eq '${internetMessageId}'`],
          ["$select", "id,internetMessageId"],
          ["$top", "10"],
        ]);
        const body = await responseBody(
          await rest(`/messages?${params}`, account, lookupTokens, "read"),
        );
        if (!Array.isArray(body.value)) throw new ChannelParseError("invalid Graph search result");
        const recipient = recipients.get(proposal.message.to?.actor as string) as string;
        for (const row of body.value.slice(0, 10)) {
          try {
            const candidate = record(row);
            if (candidate.internetMessageId !== internetMessageId) continue;
            const id = messageId(candidate.id);
            const response = await rest(
              `/messages/${encodeURIComponent(id)}/$value`,
              account,
              lookupTokens,
              "read",
            );
            if (response.status === 404) continue;
            if (
              verifiedCopy(await mimeBody(response), proposal, {
                from,
                parseEmail,
                recipient,
                footer,
              })
            )
              return { outcome: "found", providerRef: id };
          } catch {
            /* A malformed or changed candidate cannot establish delivery. */
          }
        }
        return { outcome: "unknown", detail: "no verified Graph provider copy" };
      } catch {
        return { outcome: "unknown", detail: "Graph lookup could not verify a provider copy" };
      }
    },
    // Search absence and provider-normalized copies are never causally final.
  };
}
