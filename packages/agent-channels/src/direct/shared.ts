// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  AGENT,
  canonicalJson,
  DEFAULT_LIMITS,
  digestBytes,
  parseBoundedJson,
} from "@jeswr/agent-model";
import type { InboundRawMessage } from "../channel.js";
import { ChannelParseError } from "../errors.js";
import { DIRECT } from "../profiles.js";
import type { AccountRef, ReadGrant, SendGrant, Wire } from "../types.js";

// The compact JWS encodes the whole payload; its string bound is the carriage byte limit.
const CARRIER_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxEnvelopeBytes: DIRECT.maxBytes,
  maxStringLength: DIRECT.maxBytes,
});

/** Internal loopback storage; exact bytes are retained for positive-evidence lookup. */
export interface DirectMailbox {
  readonly inboxes: Map<string, InboundRawMessage[]>;
  readonly accepted: Map<string, { bytes: string; providerRef: string; account: string }>;
}
/** Inline, context-free carrier from DESIGN §3.2; protected identifiers are untouched. */
export function envelope(compactJws: string): string {
  return canonicalJson({
    "@context": { agent: AGENT },
    "@type": "agent:SignedMessage",
    "agent:wireFormat": "jws-compact",
    "agent:compactJws": compactJws,
  });
}
/** Check a bounded carrier without claiming anything about its signature. */
export function readEnvelope(raw: string | Uint8Array): { text: string; compactJws: string } {
  try {
    if (typeof raw !== "string" && raw.byteLength > DIRECT.maxBytes)
      throw new TypeError("direct carrier exceeds byte limit");
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const parsed = parseBoundedJson(text, CARRIER_LIMITS) as Record<string, unknown>;
    const compactJws = parsed["agent:compactJws"];
    if (
      typeof compactJws !== "string" ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws) ||
      canonicalJson(parsed) !== envelope(compactJws)
    )
      throw new TypeError("invalid carrier");
    return { text, compactJws };
  } catch {
    throw new ChannelParseError("invalid direct signed-message carrier");
  }
}
/** Refuse absent account references before requesting credentials. */
export function accountId(account: AccountRef): string {
  if (typeof account?.id !== "string" || !account.id || account.id.length > 2048)
    throw new TypeError("invalid account reference");
  return account.id;
}
/** Runtime scope separation, even for structurally mistyped provider implementations. */
export function assertGrant(grant: ReadGrant | SendGrant, access: "read" | "send"): void {
  if (
    grant?.access !== access ||
    typeof grant.accessToken !== "string" ||
    !grant.accessToken.trim()
  )
    throw new TypeError("missing or wrong-scope channel grant");
}
/** Check every consequential wire field, including digest and media type. */
export function assertWire(wire: Wire): string {
  if (
    wire?.mediaType !== DIRECT.envelopeMediaType ||
    typeof wire.bytes !== "string" ||
    Buffer.byteLength(wire.bytes) > DIRECT.maxBytes ||
    wire.digest !== digestBytes(wire.bytes)
  )
    throw new ChannelParseError("invalid direct wire");
  return readEnvelope(wire.bytes).compactJws;
}
