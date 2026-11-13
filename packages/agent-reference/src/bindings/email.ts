// AUTHORED-BY Codex GPT-6
/** Unsigned plain-text mail. This transport stand-in has no agent, key, core or gates. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { id, iso } from "../core/schema.js";
import type { Json } from "../core/types.js";
import type { StateStore } from "../store/state.js";
export const emailAddress = z
  .string()
  .regex(/^mailto:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
export const emailPinSchema = z.strictObject({
  type: z.literal("EmailEndpointPin"),
  issuer: id,
  endpoint: emailAddress,
  purposes: z.array(id).min(1),
  validUntil: iso,
});
export const emailEnvelopeSchema = z.strictObject({
  id,
  from: emailAddress,
  to: emailAddress,
  text: z.string().min(1).max(32768),
  purpose: id,
});
export type EmailEnvelope = z.infer<typeof emailEnvelopeSchema>;
export class ScriptedMailbox {
  constructor(
    readonly address: string,
    private readonly store: StateStore,
    private readonly replies: string[],
  ) {
    emailAddress.parse(address);
  }
  deliver(key: string, input: unknown) {
    const envelope = emailEnvelopeSchema.parse(input);
    if (envelope.to !== this.address) throw new Error("wrong mailbox");
    const state = this.store.load(),
      namespace = `mailbox:${key}`;
    const prior = state.domain[namespace];
    if (prior && digestOf(prior) !== digestOf(envelope))
      throw new Error("mailbox idempotency conflict");
    state.domain[namespace] = envelope as unknown as Json;
    this.store.save(state);
    return { reference: namespace, digest: digestOf(envelope) };
  }
  inbox() {
    return Object.entries(this.store.load().domain)
      .filter(([k]) => k.startsWith("mailbox:"))
      .map(([, v]) => v as unknown as EmailEnvelope);
  }
  reply(index = 0) {
    const text = this.replies[index];
    if (text === undefined) throw new Error("no scripted reply");
    return { from: this.address, text };
  }
}

/** Structured agent-to-agent mail; the prose-only mailbox above remains a separate mode. */
export { readEmail, writeEmail } from "./email-mime.js";
