// AUTHORED-BY Codex GPT-6.1-Sol
import {
  AGENT,
  canonicalJson,
  digestBytes,
  parseBoundedJson,
  resolveLimits,
} from "@jeswr/agent-model";
import type { InboundRawMessage } from "../channel.js";
import { ChannelParseError } from "../errors.js";
import { DIRECT } from "../profiles.js";
import type { AccountRef, ReadGrant, SendGrant, Wire } from "../types.js";

// The compact JWS is a carrier string, not a decoded payload string. The fixed
// carrier shape needs only six JSON values and three levels including scalars.
const CARRIER_LIMITS = resolveLimits({
  maxEnvelopeBytes: DIRECT.maxBytes,
  maxStringLength: DIRECT.maxBytes,
  maxJsonDepth: 3,
  maxJsonNodes: 6,
  maxArrayLength: 1,
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
    if (Buffer.byteLength(raw) > DIRECT.maxBytes) throw new TypeError("carrier exceeds byte bound");
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
  const id = account?.id;
  if (typeof id !== "string" || !id || id.length > 2048)
    throw new TypeError("invalid account reference");
  return id;
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
