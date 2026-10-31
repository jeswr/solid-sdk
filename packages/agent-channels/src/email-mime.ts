// AUTHORED-BY Codex GPT-6.1-Sol
import {
  canonicalJson,
  DEFAULT_LIMITS,
  digestBytes,
  parseBoundedJson,
  validateMessage,
} from "@jeswr/agent-model";
import { renderBodies } from "./email/bodies.js";
import { headerValues, leaves, type MimeNode, parseMime, shapeOf } from "./email/mime.js";
import type { EmailMessage } from "./email-message.js";
import { decodeEnvelopeObject } from "./envelope.js";
import { ChannelParseError } from "./errors.js";
import { toBridgeMessage } from "./message.js";
import { AGENT_FOOTER } from "./profiles.js";
import type { RenderableProposal } from "./types.js";

/** Inject legacy-bridge's parseEmail; a reverse dependency would create a cycle. */
export type EmailParser = (raw: string | Uint8Array) => EmailMessage;
export interface EmailConfig {
  readonly parseEmail: EmailParser;
  /** Trusted receiving account, never inferred from an unauthenticated To header. */
  readonly recipient: string;
  readonly ownAccounts: ReadonlySet<string>;
  /** Same deployment footer as the sender; defaults to the J2 wording. */
  readonly footer?: string;
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
function scriptTagEnd(text: string, start: number): number {
  let quote: string | undefined;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}
/** Inspect every carrier in the bounded tree, without the legacy parser's extraction caps. */
function mimeCarriers(root: MimeNode): string[] {
  const blocks: string[] = [];
  for (const part of leaves(root)) {
    const text = part.text as string;
    if (part.type === "application/ld+json") blocks.push(text);
    if (part.type !== "text/html") continue;
    // ASCII folding preserves indices even when body text contains expanding Unicode case folds.
    const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
    let cursor = 0;
    while (cursor < text.length) {
      const start = lower.indexOf("<script", cursor);
      if (start < 0) break;
      const end = scriptTagEnd(lower, start + 7);
      if (end < 0) throw new ChannelParseError("incomplete structured-copy extraction");
      cursor = end + 1;
      if (!lower.slice(start + 7, end).includes("application/ld+json")) continue;
      const close = lower.indexOf("</script", cursor);
      if (close < 0) throw new ChannelParseError("incomplete structured-copy extraction");
      blocks.push(text.slice(cursor, close));
      const closeEnd = lower.indexOf(">", close + 8);
      if (closeEnd < 0 || !/^[\t\n\f\r ]*$/.test(lower.slice(close + 8, closeEnd)))
        throw new ChannelParseError("incomplete structured-copy extraction");
      cursor = closeEnd + 1;
    }
  }
  return blocks;
}
function collectStructuredCopies(
  blocks: readonly string[],
  copies: Set<string>,
  requireComplete = false,
): void {
  for (const block of blocks) {
    let value: unknown;
    try {
      value = parseBoundedJson(block, {
        ...DEFAULT_LIMITS,
        maxStringLength: DEFAULT_LIMITS.maxEnvelopeBytes,
      });
    } catch {
      if (requireComplete || block.includes("SignedMessage"))
        throw new ChannelParseError("malformed structured copy");
      continue;
    }
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>)["@type"] !== "agent:SignedMessage"
    )
      continue;
    try {
      copies.add(decodeEnvelopeObject(value));
    } catch {
      throw new ChannelParseError("invalid structured copy");
    }
  }
}
/** Parse observations and enforce carrier agreement. This never verifies a signature. */
function inspectEmailDetails(raw: string | Uint8Array, config: EmailConfig) {
  if (Buffer.byteLength(raw) > MAX_EMAIL_BYTES)
    throw new ChannelParseError("email exceeds local byte cap");
  const footer = config.footer ?? AGENT_FOOTER;
  assertFooter(footer);
  let email: EmailMessage;
  try {
    email = config.parseEmail(raw);
  } catch {
    throw new ChannelParseError("email parser refused input");
  }
  const message = toBridgeMessage(email);
  const copies = new Set<string>();
  collectStructuredCopies(email.jsonLdBlocks ?? [], copies);
  if (copies.size === 0)
    return { message, root: undefined, proposal: undefined, parity: "none" as const };
  const mime = parseMime(raw);
  if (!mime.ok) throw new ChannelParseError("incomplete structured-copy extraction");
  collectStructuredCopies(mimeCarriers(mime.root), copies, true);
  if (copies.size !== 1) throw new ChannelParseError("conflicting structured copies");
  const proposal = decodeEmailProposal([...copies][0] as string);
  const match = parityMatches(mime.root, proposal, footer);
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
    root: mime.root,
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
