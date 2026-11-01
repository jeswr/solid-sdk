// AUTHORED-BY Codex GPT-6.1-Sol
import {
  assertJsonBounds,
  canonicalJson,
  DEFAULT_LIMITS,
  digestBytes,
  validateMessage,
} from "@jeswr/agent-model";
import type { CarriageProfile, ChannelBinding } from "../binding.js";
import {
  assertEmailAddress,
  assertFooter,
  decodeEmailProposal,
  emailMessageIdFor,
  MAX_EMAIL_BYTES,
} from "../email-mime.js";
import { ChannelParseError } from "../errors.js";
import { EMAIL_MIME } from "../profiles.js";
import type { RenderableProposal, Wire } from "../types.js";
import { renderBodies } from "./bodies.js";

export interface EmailRenderOptions {
  readonly from: string;
  readonly footer: string;
  /** Trusted actor -> single pinned mailbox, snapshotted at construction. */
  readonly recipients: ReadonlyMap<string, string>;
  /** Pure local verifier; must verify the sender key and intended audience. */
  readonly verify: (compactJws: string) => Promise<unknown>;
  readonly now?: () => number;
}
function base64(text: string): string {
  return (
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,76}/g) as string[]
  ).join("\r\n");
}
/** Private implementation shared exclusively by send entry points. */
export function emailRenderer(options: EmailRenderOptions) {
  const from = options.from;
  const footer = options.footer;
  const recipients = new Map(options.recipients);
  const verify = options.verify;
  const now = options.now ?? Date.now;
  assertEmailAddress(from);
  assertFooter(footer);
  for (const recipient of recipients.values()) assertEmailAddress(recipient);
  function current(message: RenderableProposal["message"]) {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(message.createdAt) > at ||
      Date.parse(message.expiresAt) <= at
    )
      throw new ChannelParseError("email message is expired or not yet valid");
  }
  async function render(proposal: RenderableProposal, carriage: CarriageProfile): Promise<Wire> {
    if (canonicalJson(carriage) !== canonicalJson(EMAIL_MIME))
      throw new ChannelParseError("unsupported email carriage");
    const compactJws = proposal.compactJws;
    const decoded = decodeEmailProposal(compactJws);
    const proposedMessage = proposal.message;
    assertJsonBounds(proposedMessage);
    const proposed = canonicalJson(proposedMessage);
    const payload = await verify(compactJws);
    assertJsonBounds(payload);
    const checked = validateMessage(payload);
    if (
      !checked.ok ||
      canonicalJson(checked.message) !== proposed ||
      canonicalJson(decoded.message) !== proposed
    )
      throw new ChannelParseError("signed payload differs from proposal");
    const message = checked.message;
    const to = message.to && recipients.get(message.to.actor);
    if (!to) throw new ChannelParseError("no pinned email recipient");
    const { human, html, carrier } = renderBodies(message, compactJws, footer);
    if (Buffer.byteLength(carrier) > DEFAULT_LIMITS.maxEnvelopeBytes)
      throw new ChannelParseError("email carrier exceeds parser byte cap");
    const suffix = digestBytes(compactJws).slice(8, 40);
    const mixed = `agent-mixed-${suffix}`;
    const alt = `agent-alt-${suffix}`;
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: [Agent] ${message.kind}`,
      `Date: ${new Date(message.createdAt).toUTCString()}`,
      `Message-ID: ${emailMessageIdFor(message.id)}`,
      "MIME-Version: 1.0",
      "Auto-Submitted: auto-generated",
      "X-Agentic-Reply: 1",
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ];
    const body = [
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64(human),
      `--${alt}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64(html),
      `--${alt}--`,
      `--${mixed}`,
      "Content-Type: application/ld+json; charset=utf-8",
      'Content-Disposition: attachment; filename="agent-message.jsonld"',
      "Content-Transfer-Encoding: base64",
      "",
      base64(carrier),
      `--${mixed}--`,
      "",
    ];
    const bytes = [...headers, "", ...body].join("\r\n");
    if (Buffer.byteLength(bytes) > MAX_EMAIL_BYTES)
      throw new ChannelParseError("email exceeds local byte cap");
    return { bytes, mediaType: "message/rfc822", digest: digestBytes(bytes) };
  }
  function assertWire(input: Wire): Wire {
    const wire = { bytes: input.bytes, mediaType: input.mediaType, digest: input.digest };
    if (
      Reflect.ownKeys(input).length !== 3 ||
      wire.mediaType !== "message/rfc822" ||
      typeof wire.bytes !== "string" ||
      Buffer.byteLength(wire.bytes) > MAX_EMAIL_BYTES ||
      wire.digest !== digestBytes(wire.bytes)
    )
      throw new ChannelParseError("invalid email wire");
    return { bytes: wire.bytes, mediaType: wire.mediaType, digest: wire.digest };
  }
  const validate: NonNullable<ChannelBinding["send"]>["validate"] = async (wire, proposal) => {
    try {
      const snapshot = assertWire(wire);
      const compactJws = proposal.compactJws;
      const expected = await render({ message: proposal.message, compactJws }, EMAIL_MIME);
      current(decodeEmailProposal(compactJws).message);
      return snapshot.bytes === expected.bytes
        ? { ok: true }
        : { ok: false, reason: "terms-digest-mismatch" };
    } catch {
      return { ok: false, reason: "malformed" };
    }
  };
  return { render, validate, assertWire, current };
}
