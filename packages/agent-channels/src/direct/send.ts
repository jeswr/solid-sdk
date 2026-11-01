// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertJsonBounds, canonicalJson, digestBytes, validateMessage } from "@jeswr/agent-model";
import type { CarriageProfile, ChannelBinding } from "../binding.js";
import { createDirectReader } from "../direct.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import { DIRECT } from "../profiles.js";
import type { RenderableProposal, TokenProvider, Wire } from "../types.js";
import { accountId, assertGrant, assertWire, type DirectMailbox, envelope } from "./shared.js";

/** All senders sharing a mailbox must observe its in-flight attempts before claiming absence. */
const pendingByMailbox = new WeakMap<DirectMailbox, Set<{ readonly bytes: string }>>();

/** Inject a pure local signature verifier, including its key/audience policy. No keys are loaded here. */
export interface DirectOptions {
  readonly tokens: TokenProvider;
  readonly verify: (compactJws: string) => Promise<unknown>;
  readonly now?: () => number;
}
/** Construct the send half around an explicitly supplied local transport. */
export function createDirectSend(
  mailbox: DirectMailbox,
  options: DirectOptions,
): NonNullable<ChannelBinding["send"]> {
  const now = options.now ?? Date.now;
  const pending = pendingByMailbox.get(mailbox) ?? new Set<{ readonly bytes: string }>();
  pendingByMailbox.set(mailbox, pending);
  async function verified(compactJws: string) {
    const decoded = await options.verify(compactJws);
    assertJsonBounds(decoded);
    const result = validateMessage(decoded);
    if (!result.ok) throw new ChannelParseError("unverifiable direct message");
    return result.message;
  }
  function assertCurrent(message: RenderableProposal["message"]): void {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(message.createdAt) > at ||
      Date.parse(message.expiresAt) <= at
    )
      throw new ChannelParseError("direct message is expired or not yet valid");
  }
  async function render(proposal: RenderableProposal, carriage: CarriageProfile): Promise<Wire> {
    if (canonicalJson(carriage) !== canonicalJson(DIRECT))
      throw new ChannelParseError("unsupported direct carriage");
    const bytes = envelope(proposal.compactJws);
    const wire = { bytes, digest: digestBytes(bytes), mediaType: "application/ld+json" };
    const message = await verified(assertWire(wire));
    if (canonicalJson(message) !== canonicalJson(proposal.message))
      throw new ChannelParseError("signed payload differs from proposal");
    return wire;
  }
  return {
    render,
    async validate(wire, proposal) {
      try {
        const expected = await render(proposal, DIRECT);
        assertCurrent(proposal.message);
        return canonicalJson(wire) === canonicalJson(expected)
          ? { ok: true }
          : { ok: false, reason: "terms-digest-mismatch" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    async transmit(wire, io) {
      if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
      const account = accountId(io.account);
      const accountRef = Object.freeze({ id: account });
      // Keep the checked bytes and their identity stable across asynchronous checks.
      const snapshot = { ...wire };
      const compactJws = assertWire(snapshot);
      // Register each attempt before verification or credentials can suspend it.
      const attempt = { bytes: snapshot.bytes };
      pending.add(attempt);
      try {
        const message = await verified(compactJws);
        assertCurrent(message);
        assertGrant(await io.tokens.send(accountRef), "send");
        assertCurrent(message);
        const previous = mailbox.accepted.get(message.id);
        if (previous) {
          if (previous.bytes !== snapshot.bytes || previous.account !== account)
            throw new ProviderRejectedError("direct message id conflicts with accepted bytes");
          return { outcome: "accepted", providerRef: previous.providerRef };
        }
        const providerRef = `direct:${snapshot.digest}`;
        mailbox.accepted.set(message.id, { bytes: snapshot.bytes, providerRef, account });
        const inbox = mailbox.inboxes.get(account) ?? [];
        inbox.push({ id: message.id, raw: snapshot.bytes });
        mailbox.inboxes.set(account, inbox);
        return { outcome: "accepted", providerRef };
      } finally {
        pending.delete(attempt);
      }
    },
    async lookup(wire) {
      const snapshot = { ...wire };
      const message = await verified(assertWire(snapshot));
      const entry = mailbox.accepted.get(message.id);
      if (entry?.bytes === snapshot.bytes)
        return { outcome: "found", providerRef: entry.providerRef };
      if ([...pending].some((attempt) => attempt.bytes === snapshot.bytes))
        return { outcome: "unknown", detail: "direct send is pending" };
      return { outcome: "absent" };
    },
    finalAbsence: true,
  };
}
/** Test-only composition: both halves use this isolated, in-memory loopback. */
export function createInMemoryDirectBinding(
  options: DirectOptions,
): ChannelBinding & { readonly send: NonNullable<ChannelBinding["send"]> } {
  const mailbox: DirectMailbox = { inboxes: new Map(), accepted: new Map() };
  return {
    ...createDirectReader(mailbox, options.tokens),
    send: createDirectSend(mailbox, options),
  };
}
