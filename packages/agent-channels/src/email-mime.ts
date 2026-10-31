// AUTHORED-BY Codex GPT-6.1-Sol
import {
  canonicalJson,
  DEFAULT_LIMITS,
  digestBytes,
  parseBoundedJson,
  validateMessage,
} from "@jeswr/agent-model";
import { envelope } from "./direct/shared.js";
import { renderBodies } from "./email/bodies.js";
import { headerValues, leaves, type MimeNode, parseMime, shapeOf } from "./email/mime.js";
import type { EmailMessage } from "./email-message.js";
import { ChannelParseError } from "./errors.js";
import { toBridgeMessage } from "./message.js";
import type { RenderableProposal } from "./types.js";

/** Inject legacy-bridge's parseEmail; a reverse dependency would create a cycle. */
export type EmailParser = (raw: string | Uint8Array) => EmailMessage;
export interface EmailConfig {
  readonly parseEmail: EmailParser;
  /** Trusted receiving account, never inferred from an unauthenticated To header. */
  readonly recipient: string;
  readonly ownAccounts: ReadonlySet<string>;
  readonly footer: string;
}
export const SUPPORTED_SHAPE =
  "multipart/mixed(multipart/alternative(text/plain,text/html),application/ld+json)";
export const MAX_EMAIL_BYTES = 512 * 1024;

export function assertEmailAddress(value: string): void {
  // Conservative single addr-spec; never display names, lists or quoted local parts.
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)
  )
    throw new ChannelParseError("invalid email address");
}
export function assertFooter(footer: string): void {
  if (
    typeof footer !== "string" ||
    !footer.trim() ||
    footer.length > 2048 ||
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(footer)
  )
    throw new ChannelParseError("invalid agent footer");
}
export function emailMessageIdFor(id: string): string {
  // Preserve the pilot identifier so reconciliation searches remain stable on migration.
  return `<awp-${digestBytes(id).slice(8, 48)}@awp-pilot.invalid>`;
}
/** Decode for parity only. A decoded statement conveys no verified identity or authority. */
export function decodeEmailProposal(compactJws: string): RenderableProposal {
  if (
    typeof compactJws !== "string" ||
    compactJws.length > DEFAULT_LIMITS.maxEnvelopeBytes ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws)
  )
    throw new ChannelParseError("invalid email signed-message carrier");
  try {
    const payload = compactJws.split(".")[1] as string;
    const message = validateMessage(
      parseBoundedJson(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(payload, "base64url")),
      ),
    );
    if (!message.ok) throw new ChannelParseError("invalid email message payload");
    return { message: message.message, compactJws };
  } catch {
    throw new ChannelParseError("invalid email message payload");
  }
}
function normalized(s: string): string {
  const text = s.replace(/\r\n/g, "\n");
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") end--;
  return text.slice(0, end);
}
function parityMatches(root: MimeNode, proposal: RenderableProposal, footer: string): boolean {
  if (shapeOf(root) !== SUPPORTED_SHAPE) return false;
  const { human, html, carrier } = renderBodies(proposal.message, proposal.compactJws, footer);
  const parts = leaves(root);
  return (
    [human, html, carrier].every(
      (text, i) => normalized((parts[i] as MimeNode).text as string) === normalized(text),
    ) &&
    parts.every((part) =>
      part.headers.every(([name]) =>
        ["content-type", "content-transfer-encoding", "content-disposition"].includes(name),
      ),
    )
  );
}
/** Parse observations and enforce carrier agreement. This never verifies a signature. */
function inspectEmailDetails(raw: string | Uint8Array, config: EmailConfig) {
  if (Buffer.byteLength(raw) > MAX_EMAIL_BYTES)
    throw new ChannelParseError("email exceeds local byte cap");
  assertFooter(config.footer);
  let email: EmailMessage;
  try {
    email = config.parseEmail(raw);
  } catch {
    throw new ChannelParseError("email parser refused input");
  }
  const message = toBridgeMessage(email);
  const copies = new Set<string>();
  for (const block of email.jsonLdBlocks ?? []) {
    let value: unknown;
    try {
      value = parseBoundedJson(block, {
        ...DEFAULT_LIMITS,
        maxStringLength: DEFAULT_LIMITS.maxEnvelopeBytes,
      });
    } catch {
      if (block.includes("SignedMessage")) throw new ChannelParseError("malformed structured copy");
      continue;
    }
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>)["@type"] !== "agent:SignedMessage"
    )
      continue;
    const v = value as Record<string, unknown>;
    const jws = v["agent:compactJws"];
    if (typeof jws !== "string" || canonicalJson(value) !== envelope(jws))
      throw new ChannelParseError("invalid structured copy");
    copies.add(jws);
  }
  if (copies.size === 0)
    return { message, root: undefined, proposal: undefined, parity: "none" as const };
  if (copies.size !== 1) throw new ChannelParseError("conflicting structured copies");
  const proposal = decodeEmailProposal([...copies][0] as string);
  const mime = parseMime(raw);
  const match = mime.ok && parityMatches(mime.root, proposal, config.footer);
  const strict = new Set([...config.ownAccounts].map((a) => a.toLowerCase())).has(
    config.recipient.toLowerCase(),
  );
  if (strict && !match) throw new ChannelParseError("human-parity-mismatch");
  return {
    message: {
      ...message,
      warnings: [
        ...message.warnings,
        "signature-unverified",
        ...(match ? [] : ["human-parity-unverified"]),
      ],
    },
    proposal,
    root: mime.ok ? mime.root : undefined,
    parity: match ? ("match" as const) : ("unverified" as const),
  };
}
/** Public observations never expose the decoded HTML MIME tree. */
export function inspectEmail(raw: string | Uint8Array, config: EmailConfig) {
  const { message, proposal, parity } = inspectEmailDetails(raw, config);
  return { message, proposal, parity };
}
/** Positive evidence permits provider-added headers, never changed content or recipients. */
export function verifyProviderCopy(
  raw: Uint8Array,
  expected: { sent: string; config: EmailConfig },
): boolean {
  try {
    const { sent, config } = expected;
    const parsed = inspectEmailDetails(raw, {
      ...config,
      ownAccounts: new Set([config.recipient]),
    });
    const original = inspectEmailDetails(sent, {
      ...config,
      ownAccounts: new Set([config.recipient]),
    });
    if (
      parsed.parity !== "match" ||
      original.parity !== "match" ||
      parsed.proposal.compactJws !== original.proposal.compactJws
    )
      return false;
    const root = parsed.root as MimeNode;
    const sentRoot = original.root as MimeNode;
    if (
      ["cc", "bcc", "resent-to", "resent-cc", "resent-bcc", "reply-to", "sender"].some(
        (name) => headerValues(root, name).length,
      )
    )
      return false;
    return [...new Set(sentRoot.headers.map(([name]) => name))].every(
      (name) =>
        canonicalJson(headerValues(sentRoot, name)) === canonicalJson(headerValues(root, name)),
    );
  } catch {
    return false;
  }
}
